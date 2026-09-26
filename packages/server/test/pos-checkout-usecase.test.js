import test from 'node:test';
import assert from 'node:assert/strict';

import { PosCheckoutUseCase } from '../domains/sales/PosCheckoutUseCase.js';

/**
 * A tiny in-memory cash_shifts / orders / shift_payments / invoices store so the real
 * lockOpenShift/recordShiftSalePayments (imported directly by PosCheckoutUseCase, not
 * injectable) run against it unmodified, while salesService/createOrderUseCase are
 * injected fakes per the use case's own constructor.
 */
function createState(overrides = {}) {
    return {
        shifts: (overrides.shifts || []).map((s) => ({ ...s })),
        orders: (overrides.orders || []).map((o) => ({ ...o })),
        shiftPayments: [],
        invoices: (overrides.invoices || []).map((i) => ({ ...i })),
    };
}

function createMockConnection(state) {
    const calls = [];
    let committed = false;
    let rolledBack = false;
    let released = false;

    const connection = {
        beginTransaction: async () => {},
        commit: async () => { committed = true; },
        rollback: async () => { rolledBack = true; },
        release: () => { released = true; },
        query: async (sql, params = []) => {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: statement, params });

            if (statement.startsWith('SELECT id, status, cash_register_id FROM cash_shifts')) {
                return [state.shifts.filter((s) => s.id === params[0])];
            }
            if (statement.startsWith('SELECT id FROM cash_shifts WHERE cash_register_id')) {
                return [state.shifts.filter((s) => s.cash_register_id === params[0] && s.status === 'open')];
            }
            if (statement.includes("FROM orders WHERE external_source = 'pos' AND external_id = ?")) {
                return [state.orders.filter((o) => o.external_id === params[0])];
            }
            if (statement === 'SELECT * FROM invoices WHERE id = ?') {
                return [state.invoices.filter((i) => i.id === params[0])];
            }
            if (statement.includes("FROM shift_payments WHERE shift_id = ? AND order_id = ? AND type = 'sale'")) {
                return [state.shiftPayments.filter((p) => p.shift_id === params[0] && p.order_id === params[1])];
            }
            if (statement.startsWith('INSERT INTO shift_payments')) {
                state.shiftPayments.push({
                    id: params[0], shift_id: params[1], order_id: params[2],
                    payment_method: params[3], amount: params[4], type: 'sale',
                });
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('SUM(CASE WHEN payment_method')) {
                const rows = state.shiftPayments.filter((p) => p.shift_id === params[0]);
                const inflow = rows.filter((p) => p.payment_method === 'cash').reduce((sum, p) => sum + Number(p.amount), 0);
                return [[{ inflow, outflow: 0 }]];
            }
            if (statement === 'SELECT opening_balance FROM cash_shifts WHERE id = ? LIMIT 1') {
                const shift = state.shifts.find((s) => s.id === params[0]);
                return [[{ opening_balance: shift?.opening_balance || 0 }]];
            }
            if (statement.startsWith('UPDATE cash_shifts SET expected_balance')) {
                const shift = state.shifts.find((s) => s.id === params[1]);
                if (shift) shift.expected_balance = params[0];
                return [{ affectedRows: 1 }];
            }
            throw new Error(`Unexpected SQL in mock: ${statement}`);
        },
    };

    return {
        connection, calls,
        isCommitted: () => committed,
        isRolledBack: () => rolledBack,
        isReleased: () => released,
    };
}

test('new sale path: creates the order, records shift payments and audits the checkout', async () => {
    const state = createState({ shifts: [{ id: 'shift-1', status: 'open', cash_register_id: 'reg-1', opening_balance: 1000 }] });
    const mock = createMockConnection(state);
    const auditCalls = [];
    let createOrderCalls = 0;
    const useCase = new PosCheckoutUseCase({
        db: { getConnection: async () => mock.connection },
        auditService: { log: async (entry) => { auditCalls.push(entry); } },
        salesService: { createInvoice: async () => { throw new Error('should not be called'); } },
        createOrderUseCase: {
            execute: async (orderData, userId, actor, connection) => {
                createOrderCalls += 1;
                assert.equal(connection, mock.connection);
                assert.equal(orderData.external_source, 'pos');
                assert.equal(orderData.external_id, 'idem-1');
                assert.equal(orderData.shipping_method, undefined);
                return { id: 'order-new', total_amount: 5000, syncStock: () => { state.synced = true; } };
            },
        },
    });

    const result = await useCase.execute({
        idempotency_key: 'idem-1',
        shift_id: 'shift-1',
        shipping_method: 'delivery', // must be stripped: a counter checkout is always take-away
        payments: [{ method: 'cash', amount: 5000 }],
    }, 'user-1');

    assert.equal(createOrderCalls, 1);
    assert.equal(result.order_id, 'order-new');
    assert.equal(result.total_amount, 5000);
    assert.equal(result.invoice, null);
    assert.equal(result.idempotent_replay, false);
    assert.equal(result.shift_id, 'shift-1');
    assert.equal(state.shiftPayments.length, 1);
    assert.equal(state.shiftPayments[0].amount, 5000);
    assert.equal(state.synced, true, 'syncStock callback runs after commit');
    assert.equal(mock.isCommitted(), true);
    assert.equal(mock.isReleased(), true);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, 'POS_CHECKOUT');
    assert.equal(auditCalls[0].new_values.idempotent_replay, false);
});

test('replay path finds the existing order and creates the invoice it is still missing', async () => {
    const state = createState({
        shifts: [{ id: 'shift-1', status: 'open', cash_register_id: 'reg-1' }],
        orders: [{ id: 'order-existing', external_id: 'idem-2', total_amount: 3000, invoice_id: null }],
    });
    const mock = createMockConnection(state);
    let invoiceCreated = false;
    const useCase = new PosCheckoutUseCase({
        db: { getConnection: async () => mock.connection },
        auditService: { log: async () => {} },
        salesService: {
            createInvoice: async (orderId, data, userId, connection) => {
                invoiceCreated = true;
                assert.equal(orderId, 'order-existing');
                assert.equal(connection, mock.connection);
                return { id: 'invoice-1' };
            },
        },
        createOrderUseCase: { execute: async () => { throw new Error('should not create a new order on replay'); } },
    });

    const result = await useCase.execute({
        idempotency_key: 'idem-2',
        shift_id: 'shift-1',
        emit_invoice: true,
        payments: [{ method: 'cash', amount: 3000 }],
    }, 'user-1');

    assert.equal(invoiceCreated, true);
    assert.equal(result.idempotent_replay, true);
    assert.equal(result.order_id, 'order-existing');
    assert.equal(result.invoice.id, 'invoice-1');
});

test('invoice failure rolls back and releases the connection without recording shift payments', async () => {
    const state = createState({ shifts: [{ id: 'shift-1', status: 'open', cash_register_id: 'reg-1' }] });
    const mock = createMockConnection(state);
    const invoiceError = new Error('AFIP down');
    const useCase = new PosCheckoutUseCase({
        db: { getConnection: async () => mock.connection },
        auditService: { log: async () => {} },
        salesService: { createInvoice: async () => { throw invoiceError; } },
        createOrderUseCase: {
            execute: async () => ({ id: 'order-1', total_amount: 100, syncStock: null }),
        },
    });

    await assert.rejects(
        () => useCase.execute({
            idempotency_key: 'idem-3', shift_id: 'shift-1', emit_invoice: true, payments: [{ method: 'cash', amount: 100 }],
        }, 'user-1'),
        (err) => err === invoiceError
    );

    assert.equal(mock.isRolledBack(), true);
    assert.equal(mock.isCommitted(), false);
    assert.equal(mock.isReleased(), true);
    assert.equal(state.shiftPayments.length, 0);
});

test('ER_DUP_ENTRY on the first attempt retries once and completes as a replay', async () => {
    const state = createState({ shifts: [{ id: 'shift-1', status: 'open', cash_register_id: 'reg-1' }] });
    let attempt = 0;
    const connections = [];
    const useCase = new PosCheckoutUseCase({
        db: {
            getConnection: async () => {
                const mock = createMockConnection(state);
                connections.push(mock);
                return mock.connection;
            },
        },
        auditService: { log: async () => {} },
        salesService: { createInvoice: async () => { throw new Error('should not be called'); } },
        createOrderUseCase: {
            execute: async () => {
                attempt += 1;
                if (attempt === 1) {
                    // Simulate the concurrent request that actually won the insert race.
                    state.orders.push({ id: 'order-race', external_id: 'idem-4', total_amount: 200, invoice_id: null });
                    const err = new Error('Duplicate entry');
                    err.code = 'ER_DUP_ENTRY';
                    throw err;
                }
                throw new Error('should not create a second order: the retry must find the replay');
            },
        },
    });

    const result = await useCase.execute({
        idempotency_key: 'idem-4', shift_id: 'shift-1', payments: [{ method: 'cash', amount: 200 }],
    }, 'user-1');

    assert.equal(attempt, 1, 'createOrderUseCase only ran on the first attempt; the retry found the replay');
    assert.equal(connections.length, 2, 'a fresh connection is taken for the retry');
    assert.equal(connections[0].isRolledBack(), true);
    assert.equal(connections[0].isReleased(), true);
    assert.equal(connections[1].isCommitted(), true);
    assert.equal(result.idempotent_replay, true);
    assert.equal(result.order_id, 'order-race');
});

test('a shift that is not open rejects with 409 CASH_SHIFT_NOT_OPEN before any mutation', async () => {
    const state = createState({ shifts: [{ id: 'shift-closed', status: 'closed', cash_register_id: 'reg-1' }] });
    const mock = createMockConnection(state);
    const useCase = new PosCheckoutUseCase({
        db: { getConnection: async () => mock.connection },
        auditService: { log: async () => { throw new Error('should not audit a rejected checkout'); } },
        salesService: { createInvoice: async () => { throw new Error('should not invoice'); } },
        createOrderUseCase: { execute: async () => { throw new Error('should not create an order'); } },
    });

    await assert.rejects(
        () => useCase.execute({
            idempotency_key: 'idem-5', shift_id: 'shift-closed', payments: [{ method: 'cash', amount: 100 }],
        }, 'user-1'),
        (err) => {
            assert.equal(err.statusCode, 409);
            assert.equal(err.errorCode, 'CASH_SHIFT_NOT_OPEN');
            return true;
        }
    );

    assert.equal(mock.isRolledBack(), true);
    assert.equal(mock.isReleased(), true);
    assert.equal(mock.calls.some((c) => /^(INSERT|UPDATE|DELETE)/i.test(c.sql)), false);
});

test('a missing shift with no id rejects with 409 CASH_SHIFT_NOT_OPEN', async () => {
    const state = createState({ shifts: [] });
    const mock = createMockConnection(state);
    const useCase = new PosCheckoutUseCase({
        db: { getConnection: async () => mock.connection },
        auditService: { log: async () => {} },
        salesService: { createInvoice: async () => { throw new Error('should not invoice'); } },
        createOrderUseCase: { execute: async () => { throw new Error('should not create an order'); } },
    });

    await assert.rejects(
        () => useCase.execute({ idempotency_key: 'idem-6', shift_id: 'shift-missing', payments: [] }, 'user-1'),
        (err) => err.statusCode === 409 && err.errorCode === 'CASH_SHIFT_NOT_OPEN'
    );
    assert.equal(mock.isRolledBack(), true);
});
