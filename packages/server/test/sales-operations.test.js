import test from 'node:test';
import assert from 'node:assert/strict';

import salesService from '../services/sales.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import { mockPool } from './helpers/mockDb.js';

test('order status helpers normalize aliases and reject invalid transitions', () => {
    assert.equal(salesService._sanitizeOrdersSortColumn('TOTAL_AMOUNT'), 'total_amount');
    assert.equal(salesService._sanitizeOrdersSortColumn('DROP TABLE orders'), 'created_at');
    assert.equal(salesService._normalizeOrderStatus(' confirmed '), 'picking');
    assert.equal(salesService._normalizeOrderStatus('paid'), 'packed');
    assert.equal(salesService._assertOrderTransition('confirmed', 'paid'), 'packed');
    assert.throws(
        () => salesService._assertOrderTransition('cancelled', 'pending'),
        (error) => error.statusCode === 409 && error.errorCode === 'INVALID_ORDER_TRANSITION'
    );
    const stockError = salesService._buildStockError('p-1', null, 2, 1);
    assert.equal(stockError.errorCode, 'INSUFFICIENT_STOCK');
});

test('_restoreInventoryForCancelledOrder restocks physically deducted locations', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM inventory_movements')) {
            return [[{ product_id: 'p-1', from_location: null, quantity: 2, unit_cost: null }]];
        }
        return [[]];
    } };
    await salesService._restoreInventoryForCancelledOrder(connection, 'o-1', 'delivered');
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO inventory (')));
    assert.ok(calls.some((call) => call.sql.includes("VALUES (?, 'restock'")));
    assert.ok(calls.some((call) => call.params?.includes('General')));
});

test('_restoreInventoryForCancelledOrder releases reservations across rows and fallback', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM order_items')) return [[{ product_id: 'p-1', quantity: 4 }]];
        if (String(sql).includes('FROM inventory') && String(sql).includes('reserved_quantity > 0')) {
            return [[{ id: 'i-1', reserved_quantity: 2 }]];
        }
        return [[]];
    } };
    await salesService._restoreInventoryForCancelledOrder(connection, 'o-1', 'pending');
    assert.ok(calls.some((call) => call.params?.[0] === 2 && call.params?.[1] === 'i-1'));
    assert.ok(calls.some((call) => call.sql.includes('GREATEST(reserved_quantity - ?, 0)')));
});

test('getOrders supports filters, pagination, totals, items and mixed payments', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('COUNT(*)')) return [[{ total: '3' }]];
        if (statement.includes('FROM orders o') && !statement.includes('COUNT(*)')) {
            return [[{ id: 'o-1', status: 'pending' }]];
        }
        if (statement.includes('FROM order_items oi')) return [[{ id: 'oi-1', order_id: 'o-1' }]];
        if (statement.includes('FROM order_payments')) {
            return [[{ id: 'pay-1', order_id: 'o-1', method: 'cash', amount: '125.50' }]];
        }
        return [[]];
    });
    const result = await salesService.getOrders(
        { client_id: 'c-1', status: 'pending' },
        { includeTotal: true, orderBy: 'status', order: 'ASC', limit: 10, offset: 5 }
    );
    assert.equal(result.total, 3);
    assert.equal(result.rows[0].items[0].id, 'oi-1');
    assert.equal(result.rows[0].payments[0].amount, 125.5);
    assert.ok(calls.some((call) => call.sql.includes('ORDER BY o.status ASC LIMIT ? OFFSET ?')));
});

test('getOrders returns both empty response shapes without loading children', async (t) => {
    let callCount = 0;
    mockPool(t, async (sql) => {
        callCount += 1;
        if (String(sql).includes('COUNT(*)')) return [[{ total: 0 }]];
        return [[]];
    });
    assert.deepEqual(await salesService.getOrders(), []);
    assert.deepEqual(await salesService.getOrders({}, { includeTotal: true }), { rows: [], total: 0 });
    assert.equal(callCount, 3);
});

test('dispatchOrder completes pickup immediately and records an audit', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FOR UPDATE')) return [[{ id: 'o-1', status: 'packed' }]];
        if (String(sql).startsWith('SELECT * FROM orders WHERE id = ?')) return [[{ id: 'o-1', status: 'delivered' }]];
        return [[]];
    });
    const original = auditService.log;
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = original; });
    const result = await salesService.dispatchOrder('o-1', { shipping_method: 'pickup', recipient_name: 'Ana' }, 'u-1');
    assert.equal(result.status, 'delivered');
    assert.equal(audit.action, 'DISPATCH_ORDER');
    assert.ok(calls.some((call) => call.params?.[0] === 'delivered' && call.params?.[7] === 1));
});

test('dispatchOrder rolls back when the order does not exist', async (t) => {
    let rolledBack = false;
    const connection = mockPool(t, async () => [[]]);
    connection.rollback = async () => { rolledBack = true; };
    await assert.rejects(() => salesService.dispatchOrder('missing', { shipping_method: 'delivery' }, 'u-1'), /Order not found/);
    assert.equal(rolledBack, true);
});

test('deliverOrder completes a dispatched order', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('FOR UPDATE')) return [[{ id: 'o-1', status: 'dispatched' }]];
        if (String(sql).startsWith('SELECT * FROM orders WHERE id = ?')) return [[{ id: 'o-1', status: 'delivered' }]];
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });
    const result = await salesService.deliverOrder('o-1', { recipient_name: 'Ana', recipient_dni: '1' }, 'u-1');
    assert.equal(result.status, 'delivered');
});

test('pickOrderItem clamps quantity and traces the active picking session', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM order_items') && String(sql).includes('FOR UPDATE')) {
            return [[{ id: 'oi-1', order_id: 'o-1', product_id: 'p-1', quantity: 3, picked_quantity: 1, location: null }]];
        }
        if (String(sql).includes('FROM picking_sessions')) return [[{ id: 'ps-1' }]];
        if (String(sql).startsWith('SELECT * FROM order_items')) return [[{ id: 'oi-1', picked_quantity: 3 }]];
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });
    const result = await salesService.pickOrderItem('oi-1', 99, 'u-1');
    assert.equal(result.picked_quantity, 3);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO picking_session_events')));
    assert.ok(calls.some((call) => call.params?.includes('General')));
});

test('recordPickingEvent creates a session when needed and reuses an active one', async (t) => {
    let sessionLookups = 0;
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM picking_sessions')) {
            sessionLookups += 1;
            return sessionLookups === 1 ? [[]] : [[{ id: 'existing-session' }]];
        }
        if (String(sql).includes('SUM(quantity)')) return [[{ total_items: 4 }]];
        return [[]];
    });
    const first = await salesService.recordPickingEvent('o-1', { product_id: 'p-1', action_type: 'scan' }, null);
    const second = await salesService.recordPickingEvent('o-1', { product_id: 'p-1', action_type: 'confirm', quantity: 2 }, 'u-1');
    assert.equal(first.success, true);
    assert.equal(second.session_id, 'existing-session');
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO picking_sessions')).length, 1);
});

test('getOrderSummary calculates progress and normalizes payments', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM orders')) return [[{ id: 'o-1' }]];
        if (statement.includes('FROM order_items oi')) return [[
            { quantity: 2, picked_quantity: 2 },
            { quantity: 2, picked_quantity: 1 }
        ]];
        if (statement.includes('FROM order_payments')) return [[{ amount: '20.50', method: 'cash' }]];
        if (statement.includes('FROM picking_sessions')) return [[]];
        return [[]];
    });
    const result = await salesService.getOrderSummary('o-1');
    assert.equal(result.summary.total_items, 4);
    assert.equal(result.summary.total_picked, 3);
    assert.equal(result.summary.completion_percent, 75);
    assert.equal(result.order.payments[0].amount, 20.5);
    assert.equal(result.picking_session, null);
});

test('transitionOrderStatus starts picking only once', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM orders') && statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-1', status: 'pending' }]];
        }
        if (statement.includes('SELECT id FROM picking_sessions')) return [[]];
        if (statement.includes('SUM(quantity)')) return [[{ total_items: 6 }]];
        if (statement.includes('SELECT * FROM orders') && !statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-1', status: 'picking' }]];
        }
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });
    const result = await salesService.transitionOrderStatus('o-1', 'picking', null);
    assert.equal(result.status, 'picking');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO picking_sessions'));
    assert.ok(insert.params.includes('unknown_picker'));
    assert.ok(insert.params.includes(6));
});

test('transitionOrderStatus packs picked inventory and records physical movements', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM orders') && statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-1', status: 'picking' }]];
        }
        if (statement.includes('SUM(picked_quantity)')) return [[{ total_picked: 3 }]];
        if (statement.includes('SELECT product_id, quantity, picked_quantity')) {
            return [[
                { product_id: 'skip', quantity: 0, picked_quantity: 0 },
                { product_id: 'p-1', quantity: 3, picked_quantity: 3 }
            ]];
        }
        if (statement.includes('reserved_quantity > 0')) {
            return [[{ id: 'reserve-1', location: 'A-1', reserved_quantity: 2 }]];
        }
        if (statement.includes('product_id = ? AND location = ?')) {
            return [[{ id: 'inv-1', quantity: 1 }]];
        }
        if (statement.includes('WHERE product_id = ? AND quantity > 0')) {
            return [[{ id: 'fallback-1', location: 'B-1', quantity: 2 }]];
        }
        if (statement.includes('SELECT * FROM orders') && !statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-1', status: 'packed' }]];
        }
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });
    const result = await salesService.transitionOrderStatus('o-1', 'packed', 'u-1');
    assert.equal(result.status, 'packed');
    assert.ok(calls.some((call) => call.sql.includes("status = 'completed'")));
    assert.ok(calls.filter((call) => call.sql.includes('INSERT INTO inventory_movements')).length >= 2);
    assert.ok(calls.some((call) => call.sql.includes('fallback')));
});

test('transitionOrderStatus handles missing and idempotent orders', async (t) => {
    let missing = true;
    mockPool(t, async (sql) => {
        if (String(sql).includes('FOR UPDATE')) {
            if (missing) return [[]];
            return [[{ id: 'o-1', status: 'pending' }]];
        }
        return [[]];
    });
    await assert.rejects(
        () => salesService.transitionOrderStatus('missing', 'picking', 'u'),
        (error) => error.statusCode === 404 && error.errorCode === 'ORDER_NOT_FOUND'
    );
    missing = false;
    const replay = await salesService.transitionOrderStatus('o-1', 'pending', 'u');
    assert.equal(replay.status, 'pending');
});

test('payment helpers validate, normalize and classify split payments', () => {
    assert.equal(salesService._resolvePaymentStatus(100, 0), 'pending');
    assert.equal(salesService._resolvePaymentStatus(100, 50), 'partial');
    assert.equal(salesService._resolvePaymentStatus(100, 100), 'paid');
    assert.throws(() => salesService._normalizePaymentLines([]), (error) => error.errorCode === 'MISSING_PAYMENTS');
    assert.throws(() => salesService._normalizePaymentLines([{ amount: 0 }]), (error) => error.errorCode === 'INVALID_PAYMENT_AMOUNT');
    assert.throws(() => salesService._normalizePaymentLines([{ amount: 1, method: ' ' }], ''), (error) => error.errorCode === 'INVALID_PAYMENT_METHOD');
    assert.deepEqual(
        salesService._normalizePaymentLines([{ amount: '10.50', method: ' Transfer ', check: { number: '1' } }]),
        [{ amount: 10.5, method: 'transfer', check: { number: '1' } }]
    );
    assert.deepEqual(salesService._normalizePayments(null, 20, 'cash'), {
        payments: [{ method: 'cash', amount: 20 }], paidAmount: 20, paymentStatus: 'paid', primaryMethod: 'cash'
    });
    assert.throws(
        () => salesService._normalizePayments([{ amount: 21, method: 'cash' }], 20),
        (error) => error.errorCode === 'PAYMENTS_EXCEED_TOTAL'
    );
});

test('_resolveClientSnapshot returns registered and fallback customer identities', async () => {
    const connection = { query: async () => [[{ id: 'c-1', name: 'Ana', tax_id: '', address: '' }]] };
    const client = await salesService._resolveClientSnapshot(connection, 'c-1');
    const fallback = await salesService._resolveClientSnapshot({ query: async () => [[]] }, 'missing', 'Mostrador');
    assert.equal(client.client_name, 'Ana');
    assert.equal(client.client_tax_id, null);
    assert.equal(fallback.client_id, null);
    assert.equal(fallback.client_name, 'Mostrador');
});

test('_transferOrderReceivablePayments skips, validates and transfers advances', async (t) => {
    assert.equal(await salesService._transferOrderReceivablePayments({}, { orderId: null }), 0);
    const noPayment = { query: async () => [[{ paid_amount: 0 }]] };
    assert.equal(await salesService._transferOrderReceivablePayments(noPayment, { orderId: 'o', totalAmount: 10 }), 0);
    const excessive = { query: async () => [[{ paid_amount: 11 }]] };
    await assert.rejects(
        () => salesService._transferOrderReceivablePayments(excessive, { orderId: 'o', totalAmount: 10 }),
        (error) => error.errorCode === 'ORDER_PAYMENTS_EXCEED_INVOICE'
    );
    const calls = [];
    const connection = { query: async (sql) => {
        calls.push(String(sql));
        if (String(sql).includes('SUM(amount)')) return [[{ paid_amount: 5 }]];
        return [[]];
    } };
    const original = accountingService.createJournalEntry;
    let journal = false;
    accountingService.createJournalEntry = async () => { journal = true; };
    t.after(() => { accountingService.createJournalEntry = original; });
    assert.equal(await salesService._transferOrderReceivablePayments(connection, {
        orderId: 'o', invoiceId: 'i', invoiceLabel: 'B-1', totalAmount: 10
    }), 5);
    assert.equal(journal, true);
    assert.equal(calls.filter((sql) => sql.startsWith('UPDATE')).length, 2);
});

test('invoice queries apply filters, use item fallback and tolerate legacy tax schema', async (t) => {
    let invoiceItemLookup = 0;
    let taxMode = 'fallback';
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        if (statement.includes('FROM invoices i') && statement.includes('LEFT JOIN clients')) {
            return [[{ id: 'i-1', client_name: '', customer_name: 'Mostrador' }]];
        }
        if (statement.startsWith('SELECT * FROM invoice_items')) {
            invoiceItemLookup += 1;
            return invoiceItemLookup === 1 ? [[]] : [[{ id: 'ii-2' }]];
        }
        if (statement.includes('JOIN order_items')) return [[{ id: 'legacy-item', invoice_id: params[0] }]];
        if (statement.includes('FROM tax_conditions')) {
            if (taxMode === 'fallback') {
                const error = new Error('missing'); error.code = 'ER_NO_SUCH_TABLE'; throw error;
            }
            if (taxMode === 'error') throw new Error('db down');
            return [[{ id: 'tc-1' }]];
        }
        return [[]];
    });
    const invoices = await salesService.getInvoices({ client_id: 'c', status: 'issued', start_date: '2026-01-01', end_date: '2026-12-31' });
    assert.equal(invoices[0].client_name, 'Mostrador');
    assert.equal((await salesService.getInvoiceItems('i-1'))[0].id, 'legacy-item');
    assert.equal((await salesService.getInvoiceItems('i-2'))[0].id, 'ii-2');
    assert.equal((await salesService.getTaxConditions()).length, 4);
    taxMode = 'success';
    assert.equal((await salesService.getTaxConditions())[0].id, 'tc-1');
    taxMode = 'error';
    await assert.rejects(() => salesService.getTaxConditions(), /db down/);
});
