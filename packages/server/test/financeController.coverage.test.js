import test from 'node:test';
import assert from 'node:assert/strict';

import * as finance from '../controllers/financeController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import financeService from '../services/finance.service.js';

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    });
}

function createTracked(queryMock) {
    const calls = [];
    const counts = { begin: 0, commit: 0, rollback: 0, release: 0 };
    const connection = {
        async beginTransaction() { counts.begin += 1; },
        async commit() { counts.commit += 1; },
        async rollback() { counts.rollback += 1; },
        release() { counts.release += 1; },
        async query(sql, params = []) {
            const statement = normalizeSql(sql);
            calls.push({ statement, params });
            return queryMock(statement, params);
        }
    };
    return { connection, calls, counts };
}

// Replaces pool.query (single statements) and pool.getConnection (transactions).
function installPool(t, { query, tracked } = {}) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    const poolCalls = [];
    pool.query = async (sql, params = []) => {
        const statement = normalizeSql(sql);
        poolCalls.push({ statement, params });
        if (!query) throw new Error(`Unexpected pool SQL: ${statement}`);
        return query(statement, params);
    };
    pool.getConnection = async () => {
        if (!tracked) throw new Error('Unexpected getConnection');
        return tracked.connection;
    };
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
    });
    return poolCalls;
}

function installAudit(t) {
    const previous = auditService.log;
    const logs = [];
    auditService.log = async (data, executor) => { logs.push({ data, executor }); };
    t.after(() => { auditService.log = previous; });
    return logs;
}

function stubFinanceService(t, name, impl) {
    const previous = financeService[name];
    const calls = [];
    financeService[name] = async (...args) => {
        calls.push(args);
        return impl(...args);
    };
    t.after(() => { financeService[name] = previous; });
    return calls;
}

const unexpected = (statement) => { throw new Error(`Unexpected SQL: ${statement}`); };

// Balance queries used by calculateShiftExpectedBalance.
function balanceRoute(statement, { inflow = 0, outflow = 0, opening = 0 } = {}) {
    if (statement.includes('FROM shift_payments') && statement.includes('COALESCE(SUM(')) return [[{ inflow, outflow }]];
    if (statement.startsWith('SELECT opening_balance')) return [[{ opening_balance: opening }]];
    return null;
}

test('getTransactions without filters runs the base query ordered by date', async (t) => {
    const rows = [{ id: 't1' }];
    const calls = installPool(t, { query: () => [rows] });
    const response = await runHandler(finance.getTransactions, { query: {} });
    assert.deepEqual(response, { status: 200, body: rows });
    assert.deepEqual(calls[0].params, []);
    assert.match(calls[0].statement, /WHERE 1=1 ORDER BY t\.date DESC$/);
});

test('getTransactions applies every filter as a bound parameter, never inline', async (t) => {
    const calls = installPool(t, { query: () => [[]] });
    await runHandler(finance.getTransactions, {
        query: {
            supplier_id: "s'; DROP TABLE x;--", client_id: 'c1', type: 'sale',
            start_date: '2026-01-01', end_date: '2026-01-31'
        }
    });
    assert.deepEqual(calls[0].params, ["s'; DROP TABLE x;--", 'c1', 'sale', '2026-01-01', '2026-01-31']);
    assert.equal(calls[0].statement.includes('DROP TABLE'), false);
    for (const fragment of ['t.supplier_id = ?', 't.client_id = ?', 't.type = ?', 'DATE(t.date) >= DATE(?)', 'DATE(t.date) <= DATE(?)']) {
        assert.ok(calls[0].statement.includes(fragment), fragment);
    }
});

test('getCashRegisters and getCashRegisterTransactions return the rows', async (t) => {
    const calls = installPool(t, {
        query: (statement) => {
            if (statement.includes('FROM cash_registers cr')) return [[{ id: 'r1' }]];
            if (statement.includes('FROM shift_payments sp')) return [[{ id: 'p1' }]];
            return unexpected(statement);
        }
    });
    assert.deepEqual((await runHandler(finance.getCashRegisters)).body, [{ id: 'r1' }]);
    const response = await runHandler(finance.getCashRegisterTransactions, { params: { id: 'r1' } });
    assert.deepEqual(response.body, [{ id: 'p1' }]);
    assert.deepEqual(calls[1].params, ['r1']);
});

test('getOpenShift returns 404 not_found when the register does not exist', async (t) => {
    installPool(t, { query: () => [[]] });
    const response = await runHandler(finance.getOpenShift, { params: { id: 'nope' } });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'not_found');
});

test('getOpenShift returns 404 no_open_shift when the register is closed or has no shift', async (t) => {
    let register = { id: 'r1', status: 'closed', current_shift_id: null };
    installPool(t, { query: () => [[register]] });
    let response = await runHandler(finance.getOpenShift, { params: { id: 'r1' } });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'no_open_shift');

    register = { id: 'r1', status: 'open', current_shift_id: null };
    response = await runHandler(finance.getOpenShift, { params: { id: 'r1' } });
    assert.equal(response.body.error, 'no_open_shift');

    register = { id: 'r1', status: 'closed', current_shift_id: 's1' };
    response = await runHandler(finance.getOpenShift, { params: { id: 'r1' } });
    assert.equal(response.body.error, 'no_open_shift');
});

test('getOpenShift returns 404 no_open_shift when the referenced shift is not open', async (t) => {
    installPool(t, {
        query: (statement) => {
            if (statement.startsWith('SELECT * FROM cash_registers')) return [[{ id: 'r1', status: 'open', current_shift_id: 's1' }]];
            if (statement.startsWith('SELECT * FROM cash_shifts')) return [[]];
            return unexpected(statement);
        }
    });
    const response = await runHandler(finance.getOpenShift, { params: { id: 'r1' } });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'no_open_shift');
});

test('getOpenShift merges shift and balance summary and persists the expected balance', async (t) => {
    const calls = installPool(t, {
        query: (statement) => {
            if (statement.startsWith('SELECT * FROM cash_registers')) return [[{ id: 'r1', status: 'open', current_shift_id: 's1' }]];
            if (statement.startsWith('SELECT * FROM cash_shifts')) return [[{ id: 's1', status: 'open' }]];
            const balance = balanceRoute(statement, { inflow: 30, outflow: 10, opening: 100 });
            if (balance) return balance;
            if (statement.startsWith('UPDATE cash_shifts SET expected_balance')) return [{ affectedRows: 1 }];
            return unexpected(statement);
        }
    });
    const response = await runHandler(finance.getOpenShift, { params: { id: 'r1' } });
    assert.equal(response.status, 200);
    assert.equal(response.body.id, 's1');
    assert.equal(response.body.expected_balance, 120);
    assert.deepEqual(calls.find((c) => c.statement.startsWith('UPDATE cash_shifts')).params, [120, 's1']);
});

test('openShift defaults the opening balance to 0 and the actor to null without a session user', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT * FROM cash_registers')) return [[{ id: 'r1', status: 'closed' }]];
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    const logs = installAudit(t);
    const response = await runHandler(finance.openShift, { params: { id: 'r1' }, body: {} });
    assert.equal(response.body.success, true);
    const insert = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO cash_shifts'));
    assert.deepEqual(insert.params, [response.body.id, 'r1', null, 0, 0]);
    assert.equal(logs[0].data.user_id, null);
});

test('openShift rolls back, releases, and rethrows when the audit write fails', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT * FROM cash_registers')) return [[{ id: 'r1', status: 'closed' }]];
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    const previous = auditService.log;
    const failure = new Error('audit down');
    auditService.log = async () => { throw failure; };
    t.after(() => { auditService.log = previous; });
    await assert.rejects(runHandler(finance.openShift, { params: { id: 'r1' }, body: { opening_balance: 5 } }), (e) => e === failure);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('closeShift rolls back and releases when a statement fails', async (t) => {
    const failure = new Error('db down');
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT * FROM cash_shifts')) throw failure;
        return unexpected(statement);
    });
    installPool(t, { tracked });
    await assert.rejects(runHandler(finance.closeShift, { params: { id: 's1' }, body: {} }), (e) => e === failure);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('closeShift treats a missing actual balance as 0 and records null notes and actor', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT * FROM cash_shifts')) {
            return [[{ id: 's1', status: 'open', cash_register_id: 'r1', expected_balance: 50, opening_balance: 50 }]];
        }
        const balance = balanceRoute(statement, { opening: 50 });
        if (balance) return balance;
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    installAudit(t);
    const response = await runHandler(finance.closeShift, { params: { id: 's1' }, body: {} });
    assert.deepEqual(response.body, { success: true, expected_balance: 50, actual_balance: 0, difference: -50 });
    const update = tracked.calls.find((c) => c.statement.startsWith("UPDATE cash_shifts SET status = 'closed'"));
    assert.deepEqual(update.params, [null, 50, 0, -50, null, 's1']);
});

test('addShiftPayment inserts a payment with defaults, refreshes the balance, audits, and commits', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT id FROM cash_shifts')) return [[{ id: 's1' }]];
        const balance = balanceRoute(statement, { inflow: 25, opening: 10 });
        if (balance) return balance;
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    const logs = installAudit(t);
    const response = await runHandler(finance.addShiftPayment, {
        params: { id: 's1' }, body: {}, user: { id: 'u1' }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.expected_balance, 35);
    assert.equal(response.body.idempotent_replay, undefined);
    const insert = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO shift_payments'));
    assert.deepEqual(insert.params, [response.body.id, 's1', null, 'cash', 0, 'sale']);
    assert.equal(logs[0].data.action, 'ADD_SHIFT_PAYMENT');
    assert.equal(logs[0].data.user_id, 'u1');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('addShiftPayment with an order but no prior payment inserts it (idempotency lookup misses)', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT id FROM cash_shifts')) return [[{ id: 's1' }]];
        if (statement.startsWith('SELECT id FROM shift_payments')) return [[]];
        const balance = balanceRoute(statement);
        if (balance) return balance;
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    installAudit(t);
    const response = await runHandler(finance.addShiftPayment, {
        params: { id: 's1' }, body: { order_id: 'o1', payment_method: 'card', amount: 80, type: 'sale' }
    });
    assert.equal(response.status, 200);
    const lookup = tracked.calls.find((c) => c.statement.startsWith('SELECT id FROM shift_payments'));
    assert.deepEqual(lookup.params, ['s1', 'o1', 'card', 'sale']);
    const insert = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO shift_payments'));
    assert.deepEqual(insert.params, [response.body.id, 's1', 'o1', 'card', 80, 'sale']);
});

test('addShiftPayment idempotency lookup defaults method to cash and type to sale', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT id FROM cash_shifts')) return [[{ id: 's1' }]];
        if (statement.startsWith('SELECT id FROM shift_payments')) return [[{ id: 'p-old' }]];
        const balance = balanceRoute(statement);
        if (balance) return balance;
        return unexpected(statement);
    });
    installPool(t, { tracked });
    const response = await runHandler(finance.addShiftPayment, { params: { id: 's1' }, body: { order_id: 'o1' } });
    assert.equal(response.body.idempotent_replay, true);
    const lookup = tracked.calls.find((c) => c.statement.startsWith('SELECT id FROM shift_payments'));
    assert.deepEqual(lookup.params, ['s1', 'o1', 'cash', 'sale']);
});

test('createCashTransaction returns 404 when the register is missing', async (t) => {
    const tracked = createTracked(() => [[]]);
    installPool(t, { tracked });
    const response = await runHandler(finance.createCashTransaction, { body: { register_id: 'r?' } });
    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'not_found');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('createCashTransaction returns 409 when the register is closed or has no shift', async (t) => {
    let register = { status: 'closed', current_shift_id: null };
    const tracked = createTracked(() => [[register]]);
    installPool(t, { tracked });
    let response = await runHandler(finance.createCashTransaction, { body: { register_id: 'r1', type: 'income', amount: 5 } });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'closed_register');

    register = { status: 'open', current_shift_id: null };
    response = await runHandler(finance.createCashTransaction, { body: { register_id: 'r1', type: 'income', amount: 5 } });
    assert.equal(response.status, 409);
    assert.equal(tracked.calls.some((c) => c.statement.startsWith('INSERT')), false);
    assert.deepEqual(tracked.counts, { begin: 2, commit: 0, rollback: 2, release: 2 });
});

test('createCashTransaction records an income as shift payment + adjustment transaction', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT current_shift_id')) return [[{ status: 'open', current_shift_id: 's1' }]];
        const balance = balanceRoute(statement, { inflow: 70, opening: 30 });
        if (balance) return balance;
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    const logs = installAudit(t);
    const response = await runHandler(finance.createCashTransaction, {
        body: { register_id: 'r1', type: 'income', amount: 70, reason: 'Fondo', notes: 'extra' },
        user: { id: 'u1' }
    });
    assert.equal(response.body.success, true);
    assert.equal(response.body.expected_balance, 100);
    const payment = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO shift_payments'));
    assert.deepEqual(payment.params, [response.body.id, 's1', 70, 'income']);
    const tx = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO transactions'));
    assert.equal(tx.params[2], 'Ingreso de caja: Fondo (extra)');
    assert.equal(tx.params[3], response.body.id);
    assert.equal(logs[0].data.new_values.type, 'income');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('createCashTransaction treats any non-income type as an expense, without notes or user', async (t) => {
    const tracked = createTracked((statement) => {
        if (statement.startsWith('SELECT current_shift_id')) return [[{ status: 'open', current_shift_id: 's1' }]];
        const balance = balanceRoute(statement);
        if (balance) return balance;
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    const logs = installAudit(t);
    await runHandler(finance.createCashTransaction, {
        body: { register_id: 'r1', type: 'whatever', amount: 9, reason: 'Libreria' }
    });
    const payment = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO shift_payments'));
    assert.equal(payment.params[3], 'expense');
    const tx = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO transactions'));
    assert.equal(tx.params[2], 'Egreso de caja: Libreria');
    assert.equal(logs[0].data.user_id, null);
    assert.equal(logs[0].data.new_values.notes, null);
});

test('createCashTransaction rolls back and rethrows on SQL failure', async (t) => {
    const failure = new Error('lock timeout');
    const tracked = createTracked(() => { throw failure; });
    installPool(t, { tracked });
    await assert.rejects(runHandler(finance.createCashTransaction, { body: { register_id: 'r1' } }), (e) => e === failure);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('getPendingInvoices merges invoices and orders, computes pending amounts, drops settled, sorts by date', async (t) => {
    const calls = installPool(t, {
        query: (statement, params) => {
            if (statement.includes('FROM invoices i')) {
                return [[
                    { id: 'inv1', total_amount: '100', issue_date: '2026-02-10', cae: '123' },
                    { id: 'inv2', total_amount: '50', issue_date: '2026-02-01', cae: null },
                    { id: 'inv3', total_amount: null, issue_date: '2026-02-02', cae: null }
                ]];
            }
            if (statement.includes('FROM orders o')) {
                return [[
                    { id: 'ord1', total_amount: '200', issue_date: '2026-02-05' },
                    { id: 'ord2', total_amount: '30', issue_date: '2026-02-06' }
                ]];
            }
            if (statement.includes('FROM transactions')) {
                if (params[0].includes('inv1')) {
                    return [[{ reference_id: 'inv1', paid_amount: '40' }, { reference_id: 'inv2', paid_amount: '50' }]];
                }
                return [[{ reference_id: 'ord2', paid_amount: '30' }]];
            }
            return unexpected(statement);
        }
    });
    const response = await runHandler(finance.getPendingInvoices, { query: {} });
    assert.equal(response.status, 200);
    // inv2 is fully paid, inv3 has no amount, ord2 is fully paid.
    assert.deepEqual(response.body.map((row) => row.id), ['ord1', 'inv1']);
    const [order, invoice] = response.body;
    assert.deepEqual(
        { type: order.document_type, fiscal: order.fiscal_status, paid: order.paid_amount, pending: order.pending_amount },
        { type: 'order', fiscal: 'not_invoiced', paid: 0, pending: 200 }
    );
    assert.deepEqual(
        { type: invoice.document_type, fiscal: invoice.fiscal_status, paid: invoice.paid_amount, pending: invoice.pending_amount },
        { type: 'invoice', fiscal: 'authorized', paid: 40, pending: 60 }
    );
    assert.equal(calls.length, 4);
});

test('getPendingInvoices filters both queries by client and skips payment lookups when empty', async (t) => {
    const calls = installPool(t, { query: () => [[]] });
    const response = await runHandler(finance.getPendingInvoices, { query: { client_id: 'c9' } });
    assert.deepEqual(response.body, []);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, ['c9']);
    assert.deepEqual(calls[1].params, ['c9']);
    assert.ok(calls[0].statement.includes('i.client_id = ?'));
    assert.ok(calls[1].statement.includes('o.client_id = ?'));
});

test('getFiscalSalesStatus returns the rows as-is', async (t) => {
    installPool(t, { query: () => [[{ order_id: 'o1', fiscal_status: 'not_invoiced' }]] });
    const response = await runHandler(finance.getFiscalSalesStatus);
    assert.deepEqual(response.body, [{ order_id: 'o1', fiscal_status: 'not_invoiced' }]);
});

test('registerBulkPayments passes the body and the authenticated user to the service', async (t) => {
    const calls = stubFinanceService(t, 'registerBulkInvoicePayments', () => ({ paid: 2 }));
    const body = { payments: [] };
    const response = await runHandler(finance.registerBulkPayments, { body, user: { id: 'u1' } });
    assert.deepEqual(response.body, { paid: 2 });
    assert.deepEqual(calls[0], [body, 'u1']);
    await runHandler(finance.registerBulkPayments, { body });
    assert.equal(calls[1][1], null);
});

test('customer check handlers delegate to the service and map a missing check to 404', async (t) => {
    const listCalls = stubFinanceService(t, 'getCustomerChecks', () => [{ id: 'c1' }]);
    stubFinanceService(t, 'getCustomerCheck', (id) => (id === 'c1' ? { id: 'c1' } : null));
    const updateCalls = stubFinanceService(t, 'updateCustomerCheckStatus', (id, body) => ({ id, ...body }));

    assert.deepEqual((await runHandler(finance.getCustomerChecks, { query: { status: 'x' } })).body, [{ id: 'c1' }]);
    assert.deepEqual(listCalls[0], [{ status: 'x' }]);
    assert.deepEqual((await runHandler(finance.getCustomerChecks, { query: undefined })).body, [{ id: 'c1' }]);
    assert.deepEqual(listCalls[1], [{}]);

    assert.deepEqual((await runHandler(finance.getCustomerCheck, { params: { id: 'c1' } })).body, { id: 'c1' });
    const missing = await runHandler(finance.getCustomerCheck, { params: { id: 'zz' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');

    const updated = await runHandler(finance.updateCustomerCheckStatus, {
        params: { id: 'c1' }, body: { status: 'cashed' }, user: { id: 'u1' }
    });
    assert.deepEqual(updated.body, { id: 'c1', status: 'cashed' });
    assert.deepEqual(updateCalls[0], ['c1', { status: 'cashed' }, 'u1']);
    await runHandler(finance.updateCustomerCheckStatus, { params: { id: 'c1' }, body: {} });
    assert.equal(updateCalls[1][2], null);
});

test('outgoing check handlers delegate to the service and map a missing check to 404', async (t) => {
    const listCalls = stubFinanceService(t, 'getOutgoingChecks', () => [{ id: 'o1' }]);
    stubFinanceService(t, 'getOutgoingCheck', (id) => (id === 'o1' ? { id: 'o1' } : null));
    const updateCalls = stubFinanceService(t, 'updateOutgoingCheckStatus', (id, body) => ({ id, ...body }));

    assert.deepEqual((await runHandler(finance.getOutgoingChecks, { query: { a: 1 } })).body, [{ id: 'o1' }]);
    assert.deepEqual(listCalls[0], [{ a: 1 }]);
    await runHandler(finance.getOutgoingChecks, { query: undefined });
    assert.deepEqual(listCalls[1], [{}]);

    assert.deepEqual((await runHandler(finance.getOutgoingCheck, { params: { id: 'o1' } })).body, { id: 'o1' });
    const missing = await runHandler(finance.getOutgoingCheck, { params: { id: 'zz' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');

    const updated = await runHandler(finance.updateOutgoingCheckStatus, {
        params: { id: 'o1' }, body: { status: 'paid' }, user: { id: 'u2' }
    });
    assert.deepEqual(updated.body, { id: 'o1', status: 'paid' });
    assert.deepEqual(updateCalls[0], ['o1', { status: 'paid' }, 'u2']);
    await runHandler(finance.updateOutgoingCheckStatus, { params: { id: 'o1' }, body: {} });
    assert.equal(updateCalls[1][2], null);
});
