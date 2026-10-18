import test from 'node:test';
import assert from 'node:assert/strict';

import salesService from '../services/sales.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import financeService from '../services/finance.service.js';
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

test('_restoreInventoryForCancelledOrder ignores empty deductions, restocks at today\'s cost and reverses the cost it left at', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (String(sql).includes('FROM inventory_movements')) return [[
            { product_id: 'skip', from_location: 'A-1', quantity: 0, unit_cost: 10, journal_entry_id: 'je-sale' },
            { product_id: 'p-2', from_location: 'B-2', quantity: 3, unit_cost: 25, journal_entry_id: 'je-sale' },
            // Left with no cost posted (no cost then, or packed before ADR-027): never valued out.
            { product_id: 'p-3', from_location: 'B-3', quantity: 1, unit_cost: 40, journal_entry_id: null }
        ]];
        if (String(sql).replace(/\s+/g, ' ').includes('FROM products WHERE id IN')) return [[{ id: 'p-2', purchase_price: 30 }, { id: 'p-3', purchase_price: 40 }]];
        return [[]];
    } };
    await salesService._restoreInventoryForCancelledOrder(connection, 'o-2', 'packed');
    const order = calls.map(({ sql }) => sql);
    const stockLock = order.findIndex((sql) => sql.startsWith('SELECT id, product_id, location, quantity, reserved_quantity FROM inventory'));
    const costLock = order.findIndex((sql) => sql.includes('FROM products WHERE id IN') && sql.endsWith('FOR SHARE'));
    assert.ok(stockLock >= 0 && stockLock < costLock, 'stock (L3), then cost (L4)');
    assert.deepEqual(calls[stockLock].params, [['p-2', 'p-3']]);
    assert.ok(calls.some(({ sql, params }) => sql.includes("VALUES (?, 'restock'") && params.includes('B-2') && params.includes(30)));
    assert.equal(calls.some(({ params }) => params?.includes('skip')), false);
    // 3 × 30 back in stock, 3 × 25 of cost reversed, 15 of holding result. p-3 comes back too, at
    // today's 40, against the opening adjustment (AUD-016): otherwise the stock grows and the
    // ledger does not.
    const lines = calls.filter(({ sql }) => sql.startsWith('INSERT INTO journal_entry_lines')).map(({ params }) => [params[2], params[3], params[4]]);
    assert.deepEqual(lines, [['1.1.04.01', 130, 0], ['5.1.01.01', 0, 75], ['4.2.02.01', 0, 15], ['3.1.03.01', 0, 40]]);
    const link = calls.find(({ sql }) => sql.startsWith('UPDATE inventory_movements SET journal_entry_id'));
    assert.equal(link.params[1].length, 2, 'both restocks keep the entry');
});

test('_restoreInventoryForCancelledOrder releases what is reserved and never touches other rows', async () => {
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
    // The 2 units no longer reserved anywhere are not "released" from an arbitrary row.
    assert.equal(calls.some((call) => call.sql.includes('GREATEST') || call.sql.includes('LIMIT 1')), false);
});

test('_restoreInventoryForCancelledOrder stops releasing once the reservation is satisfied', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM order_items')) return [[{ product_id: 'p-2', quantity: 2 }]];
        if (String(sql).includes('reserved_quantity > 0')) return [[
            { id: 'reserve-enough', reserved_quantity: 5 },
            { id: 'reserve-untouched', reserved_quantity: 1 }
        ]];
        return [[]];
    } };
    await salesService._restoreInventoryForCancelledOrder(connection, 'o-2', 'pending');
    assert.ok(calls.some(({ params }) => params?.[0] === 2 && params?.[1] === 'reserve-enough'));
    assert.equal(calls.some(({ params }) => params?.includes('reserve-untouched')), false);
    assert.equal(calls.some(({ sql }) => sql.includes('GREATEST(reserved_quantity - ?, 0)')), false);
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

test('getOrders returns populated rows directly when pagination totals are not requested', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM orders o')) return [[{ id: 'o-direct', status: 'pending' }]];
        if (statement.includes('FROM order_items oi')) return [[]];
        if (statement.includes('FROM order_payments')) return [[]];
        return [[]];
    });
    assert.deepEqual(await salesService.getOrders(), [{ id: 'o-direct', status: 'pending', items: [], adjustments: [], payments: [] }]);
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

test('dispatchOrder preserves all delivery details for home shipping', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FOR UPDATE')) return [[{ id: 'o-delivery', status: 'packed' }]];
        if (String(sql).startsWith('SELECT * FROM orders WHERE id = ?')) {
            return [[{ id: 'o-delivery', status: 'dispatched' }]];
        }
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });

    const result = await salesService.dispatchOrder('o-delivery', {
        shipping_method: 'delivery',
        tracking_number: 'TRK-1',
        estimated_delivery: '2026-08-25',
        shipping_address: 'Calle 1',
        recipient_name: 'Ana',
        recipient_dni: '123',
    }, 'u-1');

    assert.equal(result.status, 'dispatched');
    const update = calls.find((call) => call.sql.includes('UPDATE orders'));
    assert.deepEqual(update.params, [
        'dispatched', 'delivery', 'TRK-1', '2026-08-25', 'Calle 1', 'Ana', '123', 0, 'o-delivery'
    ]);
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

test('deliverOrder accepts an operational delivery without optional recipient data', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FOR UPDATE')) return [[{ id: 'o-2', status: 'dispatched' }]];
        if (String(sql).startsWith('SELECT * FROM orders WHERE id = ?')) return [[{ id: 'o-2', status: 'delivered' }]];
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });

    const result = await salesService.deliverOrder('o-2', {}, null);
    assert.equal(result.status, 'delivered');
    const update = calls.find((call) => call.sql.includes("SET status = 'delivered'"));
    assert.deepEqual(update.params, [null, null, null, 'o-2']);
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

test('pickOrderItem clamps negative input and works without an active session', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM order_items') && String(sql).includes('FOR UPDATE')) {
            return [[{ id: 'oi-2', order_id: 'o-2', product_id: 'p-2', quantity: 3, picked_quantity: null }]];
        }
        if (String(sql).includes('FROM picking_sessions')) return [[]];
        if (String(sql).startsWith('SELECT * FROM order_items')) return [[{ id: 'oi-2', picked_quantity: 0 }]];
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });

    const result = await salesService.pickOrderItem('oi-2', -5, null);
    assert.equal(result.picked_quantity, 0);
    assert.equal(calls.some((call) => call.sql.includes('INSERT INTO picking_session_events')), false);
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

test('getOrderSummary represents an empty order and its active picking session', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM orders')) return [[{ id: 'o-empty' }]];
        if (statement.includes('FROM order_items oi')) return [[]];
        if (statement.includes('FROM order_payments')) return [[{ amount: null, method: 'cash' }]];
        if (statement.includes('FROM picking_sessions')) return [[{ id: 'ps-empty' }]];
        return [[]];
    });

    const result = await salesService.getOrderSummary('o-empty');
    assert.deepEqual(result.summary, { total_items: 0, total_picked: 0, completion_percent: 0 });
    assert.equal(result.order.payments[0].amount, 0);
    assert.equal(result.picking_session.id, 'ps-empty');
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
        if (statement.startsWith('SELECT id, product_id, location')) {
            return [[
                { id: 'inv-1', product_id: 'p-1', location: 'A-1', quantity: 1, reserved_quantity: 0 },
                { id: 'inv-2', product_id: 'p-1', location: 'B-1', quantity: 2, reserved_quantity: 0 }
            ]];
        }
        if (statement.includes('SET quantity = quantity - ?')) return [{ affectedRows: 1 }];
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
    // Legacy order without allocations: the picked units come out of unreserved stock.
    const deductions = calls.filter((call) => call.sql.includes('SET quantity = quantity - ?'));
    assert.deepEqual(deductions.map((call) => call.params), [[2, 'inv-2', 2], [1, 'inv-1', 1]]);
    const movements = calls.filter((call) => call.sql.includes('INSERT INTO inventory_movements'));
    assert.equal(movements.length, 2);
    assert.ok(movements.every((call) => call.params.at(-1) === 'u-1'));
    assert.equal(calls.some((call) => call.sql.includes('GREATEST')), false);
});

test('packing with allocations fails instead of clamping when the stock row no longer holds the reservation', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM orders') && statement.includes('FOR UPDATE')) return [[{ id: 'o-2', status: 'picking' }]];
        if (statement.includes('SUM(picked_quantity)')) return [[{ total_items: 2, total_picked: 2 }]];
        if (statement.includes('FROM order_item_allocations oia')) {
            return [[{ id: 'a-1', product_id: 'p-1', inventory_id: 'inv-1', location_code: 'A-1', reserved_quantity: 2, picked_quantity: 2 }]];
        }
        if (statement.includes('SET reserved_quantity = reserved_quantity - ?, quantity = quantity - ?')) return [{ affectedRows: 0 }];
        return [[]];
    });
    await assert.rejects(
        () => salesService.transitionOrderStatus('o-2', 'packed', 'u-1'),
        (err) => err.statusCode === 409 && err.errorCode === 'STOCK_INVARIANT_VIOLATION'
    );
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

test('transitionOrderStatus cancels an unpaid order by voiding debt without client credit', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM orders') && statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-unpaid', status: 'pending', invoice_id: null }]];
        }
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: null }]];
        if (statement.includes('SELECT * FROM orders') && !statement.includes('FOR UPDATE')) {
            return [[{ id: 'o-unpaid', status: 'cancelled' }]];
        }
        return [[]];
    });
    const originals = { restore: salesService._restoreInventoryForCancelledOrder, audit: auditService.log };
    salesService._restoreInventoryForCancelledOrder = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._restoreInventoryForCancelledOrder = originals.restore;
        auditService.log = originals.audit;
    });

    const result = await salesService.transitionOrderStatus('o-unpaid', 'cancelled', null);
    assert.equal(result.cancellation_credit_amount, 0);
    assert.equal(result.cancellation_financial_status, 'debt_voided');
    assert.ok(calls.some(({ sql, params }) => sql.includes("status = 'cancelled'") && params[0] === 'voided'));
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
    const defaultFallback = await salesService._resolveClientSnapshot({ query: async () => [[]] }, null, '');
    assert.equal(defaultFallback.client_name, 'Consumidor Final');
    // ADR-021: without a stored condition the invoice keeps Consumidor Final, marked as unknown.
    assert.equal(client.client_tax_condition, 'Consumidor Final');
    assert.equal(client.tax_condition_known, false);
    assert.equal(defaultFallback.tax_condition_known, false);
});

test('_resolveClientSnapshot copies the customer VAT condition (ADR-021)', async () => {
    let sql = '';
    const connection = {
        query: async (statement) => {
            sql = String(statement);
            return [[{ id: 'c-1', name: 'Club SA', tax_id: '30712345678', address: 'X', tax_condition_id: 'tc_RespInscripto' }]];
        },
    };
    const client = await salesService._resolveClientSnapshot(connection, 'c-1');
    assert.match(sql, /tax_condition_id FROM clients/);
    assert.equal(sql.includes('tax_conditions'), false, 'names come from the shared list (AUD-009)');
    assert.equal(client.client_tax_condition, 'Responsable Inscripto');
    assert.equal(client.tax_condition_known, true);

    const unknownId = await salesService._resolveClientSnapshot({ query: async () => [[{ id: 'c-2', name: 'Viejo', tax_condition_id: 'otro' }]] }, 'c-2');
    assert.deepEqual([unknownId.client_tax_condition, unknownId.tax_condition_known], ['Consumidor Final', false]);
});

test('_assertInvoiceTypeForClient follows ARCA receiver rules only when the condition is known', () => {
    const known = (condition) => ({ client_tax_condition: condition, tax_condition_known: true });
    const mismatch = (error) => error.statusCode === 422 && error.errorCode === 'invoice_type_mismatch';
    // A only for a Responsable Inscripto: a Monotributista receives B (user, 2026-10-13).
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('A', known('Responsable Inscripto')));
    assert.throws(() => salesService._assertInvoiceTypeForClient('a', known('Monotributista')), mismatch);
    assert.throws(() => salesService._assertInvoiceTypeForClient('A', known('Consumidor Final')), mismatch);
    assert.throws(() => salesService._assertInvoiceTypeForClient('A', known('Exento')), /factura B/);
    // B for everyone else.
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('B', known('Consumidor Final')));
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('B', known('Exento')));
    assert.throws(() => salesService._assertInvoiceTypeForClient('B', known('Responsable Inscripto')), /corresponde una factura A/);
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('B', known('Monotributista')));
    // C, tickets and unknown conditions are not checked.
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('C', known('Consumidor Final')));
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('TK', known('Responsable Inscripto')));
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient(undefined, known('Responsable Inscripto')));
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('A', { client_tax_condition: 'Consumidor Final', tax_condition_known: false }));
    assert.doesNotThrow(() => salesService._assertInvoiceTypeForClient('A', null));
});

test('_resolveInvoiceLetter: a Factura A always needs a CUIT, and an offline replay is corrected instead of refused (AUD-009)', () => {
    const client = (condition, taxId = '30-71234567-4') => ({
        client_tax_id: taxId, client_tax_condition: condition || 'Consumidor Final', tax_condition_known: Boolean(condition),
    });
    const cuitRequired = (error) => error.statusCode === 422 && error.errorCode === 'invoice_cuit_required';
    // Strict (online): A needs the CUIT even without a loaded condition.
    assert.throws(() => salesService._resolveInvoiceLetter('A', null), cuitRequired);
    assert.throws(() => salesService._resolveInvoiceLetter('A', client(null, '28999000')), cuitRequired);
    assert.throws(() => salesService._resolveInvoiceLetter('A', client('Responsable Inscripto', null)), cuitRequired);
    assert.equal(salesService._resolveInvoiceLetter('a', client(null)), 'A');
    assert.throws(() => salesService._resolveInvoiceLetter('A', client('Monotributista')), /solo se emite a un Responsable Inscripto/);
    assert.equal(salesService._resolveInvoiceLetter('B', client('Monotributista')), 'B');
    assert.throws(() => salesService._resolveInvoiceLetter('A', client('Exento')), /factura B/);
    assert.throws(() => salesService._resolveInvoiceLetter('B', client('Responsable Inscripto')), /corresponde una factura A/);
    assert.equal(salesService._resolveInvoiceLetter(undefined, null), 'B');
    assert.equal(salesService._resolveInvoiceLetter('tk', client('Responsable Inscripto')), 'TK');
    assert.equal(salesService._resolveInvoiceLetter('C', null), 'C');
    // Offline replay: corrected to what ARCA accepts.
    const fix = (letter, customer) => salesService._resolveInvoiceLetter(letter, customer, { correct: true });
    assert.equal(fix('A', null), 'B');
    assert.equal(fix('A', client('Consumidor Final')), 'B');
    assert.equal(fix('A', client(null)), 'A');
    assert.equal(fix('B', client('Responsable Inscripto')), 'A');
    assert.equal(fix('B', client('Responsable Inscripto', '28999000')), 'B', 'no CUIT: B stays (ARCA will report it)');
    assert.equal(fix('A', client('Monotributista')), 'B');
    assert.equal(fix('B', client('Monotributista')), 'B');
    assert.equal(fix('B', client(null)), 'B');
    assert.equal(fix('C', client('Responsable Inscripto')), 'C');
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

test('delivery, picking, picking events and summary expose missing-record failures', async (t) => {
    let mode = 'deliver';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (mode === 'summary' && statement.startsWith('SELECT * FROM orders')) return [[]];
        if (statement.includes('FOR UPDATE')) return [[]];
        if (mode === 'event' && statement.includes('FROM picking_sessions')) return [[]];
        if (mode === 'event' && statement.includes('SUM(quantity)')) throw new Error('picking db failure');
        return [[]];
    });
    await assert.rejects(() => salesService.deliverOrder('missing', {}, 'u'), /Order not found/);
    mode = 'pick';
    await assert.rejects(() => salesService.pickOrderItem('missing', 1, 'u'), /Order item not found/);
    mode = 'event';
    await assert.rejects(() => salesService.recordPickingEvent('o', {}, 'u'), /picking db failure/);
    mode = 'summary';
    await assert.rejects(() => salesService.getOrderSummary('missing'), /Order not found/);
});

test('_normalizePayments covers empty totals and malformed methods and amounts', () => {
    assert.deepEqual(salesService._normalizePayments(undefined, 0), {
        payments: [], paidAmount: 0, paymentStatus: 'pending', primaryMethod: 'cash'
    });
    assert.throws(
        () => salesService._normalizePayments([{ amount: 0, method: 'cash' }], 10),
        (error) => error.errorCode === 'INVALID_PAYMENT_AMOUNT'
    );
    assert.throws(
        () => salesService._normalizePayments([{ amount: 1, method: ' ' }], 10, ''),
        (error) => error.errorCode === 'INVALID_PAYMENT_METHOD'
    );
    assert.deepEqual(salesService._normalizePayments([{ amount: 5, method: 'check', check: { number: '1' } }], 10), {
        payments: [{ amount: 5, method: 'check', check: { number: '1' } }],
        paidAmount: 5,
        paymentStatus: 'partial',
        primaryMethod: 'check'
    });
});

test('createInvoice uses configured POS, planned mixed payments and order advances', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') return [[{
            id: 'o', status: 'packed', client_id: 'c', customer_name: '', payment_method: 'cash'
        }]];
        if (statement.includes('FROM order_items oi')) return [[
            { product_id: 'p', quantity: 1, picked_quantity: 0, unit_price: 100, vat_rate: null, product_name: null, sku: null },
            { product_id: 'zero', quantity: 0, picked_quantity: 0, unit_price: 1, vat_rate: 21, product_name: 'Zero' }
        ]];
        if (statement.includes('SELECT billing_pos')) return [[{ billing_pos: 4 }]];
        if (statement.includes('MAX(invoice_number)')) return [[{ max_number: 7 }]];
        if (statement.includes('FROM document_sequences')) return [[{ current_value: 7 }]];
        if (statement.includes('SELECT id, name, tax_id, address FROM clients')) return [[{ id: 'c', name: 'Ana', tax_id: null, address: null }]];
        if (statement.includes('FROM order_payments')) return [[
            { method: 'credit_account', amount: 10, check_payload: null },
            { method: 'cash', amount: 50, check_payload: '{"number":"1"}' },
            { method: 'bank', amount: 61, check_payload: { reference: 'TR' } }
        ]];
        return [[]];
    });
    const originals = {
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        transfer: salesService._transferOrderReceivablePayments,
        audit: auditService.log
    };
    let registeredPayments;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async (_connection, payload) => { registeredPayments = payload.payments; };
    salesService._transferOrderReceivablePayments = async () => 10;
    auditService.log = async () => {};
    t.after(() => {
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        salesService._transferOrderReceivablePayments = originals.transfer;
        auditService.log = originals.audit;
    });
    const result = await salesService.createInvoice('o', { point_of_sale: 'bad' }, null);
    assert.equal(result.point_of_sale, 4);
    assert.equal(result.total_amount, 121);
    assert.equal(result.paid_amount, 121);
    assert.equal(result.payment_status, 'paid');
    assert.equal(registeredPayments.length, 2);
    assert.deepEqual(registeredPayments[0].check, { number: '1' });
    assert.ok(calls.some((call) => call.sql.includes('UPDATE invoices SET payment_status')));
});

test('createInvoice records the remaining client debt for a partial payment', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') {
            return [[{ id: 'o-partial', status: 'packed', client_id: 'client-1', customer_name: 'Ana', payment_method: 'cash' }]];
        }
        if (statement.includes('FROM order_items oi')) {
            return [[{ product_id: 'p-1', quantity: 1, picked_quantity: 1, unit_price: 100, vat_rate: 0, product_name: 'Producto' }]];
        }
        if (statement.includes('FROM order_payments')) return [[]];
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        client: salesService._resolveClientSnapshot,
        transfer: salesService._transferOrderReceivablePayments,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        audit: auditService.log,
    };
    salesService._nextInvoiceNumber = async () => 1;
    salesService._resolveClientSnapshot = async () => ({
        client_id: 'client-1', client_name: 'Ana', client_tax_id: null,
        client_address: null, client_tax_condition: 'consumidor_final',
    });
    salesService._transferOrderReceivablePayments = async () => 0;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        salesService._resolveClientSnapshot = originals.client;
        salesService._transferOrderReceivablePayments = originals.transfer;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });

    const result = await salesService.createInvoice('o-partial', {
        invoice_type: 'B', point_of_sale: 1, payments: [{ method: 'cash', amount: 40 }],
    }, 'u-1');
    assert.equal(result.payment_status, 'partial');
    assert.equal(result.paid_amount, 40);
    assert.ok(calls.some(({ sql, params }) => sql.includes('current_account_balance') && params[0] === 60));
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE orders SET invoice_id') && params[1] === 'packed'));
});

test('createInvoice refuses a letter the customer VAT condition does not take, unless told not to check (ADR-021)', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') {
            return [[{ id: 'o-cf', status: 'packed', client_id: 'client-1', customer_name: 'Ana', payment_method: 'cash' }]];
        }
        if (statement.includes('FROM order_items oi')) {
            return [[{ product_id: 'p-1', quantity: 1, picked_quantity: 1, unit_price: 100, vat_rate: 21, product_name: 'Producto' }]];
        }
        if (statement.includes('tax_condition_id FROM clients')) {
            return [[{ id: 'client-1', name: 'Ana', tax_id: '20123456789', address: null, tax_condition_id: 'tc_ConsFinal' }]];
        }
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        transfer: salesService._transferOrderReceivablePayments,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        audit: auditService.log,
    };
    salesService._nextInvoiceNumber = async () => 1;
    salesService._transferOrderReceivablePayments = async () => 0;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        salesService._transferOrderReceivablePayments = originals.transfer;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });

    await assert.rejects(
        () => salesService.createInvoice('o-cf', { invoice_type: 'A', point_of_sale: 1 }, 'u-1'),
        (error) => error.statusCode === 422 && error.errorCode === 'invoice_type_mismatch'
    );
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO invoices (')), false);
    assert.equal(calls.some(({ sql }) => sql.includes('document_sequences') || sql.includes('MAX(invoice_number)')), false, 'refused before numbering');

    // An offline sale being replayed is invoiced with the letter ARCA accepts (AUD-009).
    const invoice = await salesService.createInvoice('o-cf', { invoice_type: 'A', point_of_sale: 1 }, 'u-1', null, { checkReceiverCondition: false });
    assert.equal(invoice.client_tax_condition, 'Consumidor Final');
    assert.equal(invoice.invoice_type, 'B');
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO invoices (')));
});

test('createInvoice preserves safe defaults for an anonymous unpaid order', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') return [[{
            id: 'o-default', status: 'packed', client_id: null, customer_name: '', payment_method: null
        }]];
        if (statement.includes('FROM order_items oi')) return [[{
            product_id: null, quantity: 2, picked_quantity: 1, unit_price: 100,
            vat_rate: undefined, product_name: '', sku: ''
        }]];
        if (statement.includes('FROM order_payments')) return [[]];
        if (statement.includes('SELECT billing_pos')) return [[]];
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        transfer: salesService._transferOrderReceivablePayments,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        audit: auditService.log,
    };
    salesService._nextInvoiceNumber = async () => 1;
    salesService._transferOrderReceivablePayments = async () => 0;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        salesService._transferOrderReceivablePayments = originals.transfer;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });

    const result = await salesService.createInvoice('o-default', {}, null);
    assert.equal(result.point_of_sale, 1);
    assert.equal(result.total_amount, 121);
    assert.equal(result.paid_amount, 0);
    assert.equal(result.payment_status, 'pending');
    assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO invoice_items') && params.includes('Producto')));
    assert.equal(calls.some(({ sql }) => sql.includes('current_account_balance')), false);
});

test('createInvoice rejects orders with no physically picked quantity', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('SELECT * FROM orders')) return [[{ id: 'o', invoice_id: null }]];
        if (String(sql).includes('FROM order_items oi')) return [[{ product_id: 'p', quantity: 0, picked_quantity: 0 }]];
        return [[]];
    });
    await assert.rejects(() => salesService.createInvoice('o', {}, 'u'), /No picked items found/);
});

test('createManualInvoice rejects missing orders, missing items and rolls back', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('SELECT id, invoice_id, external_source, shipping_method FROM orders')) return [[]];
        return [[]];
    });
    // order_id present but not found: rejected before ever delegating to createInvoice.
    await assert.rejects(() => salesService.createManualInvoice({ order_id: 'missing', items: [{}] }, 'u'), /Order not found/);
    // No order_id: the itemless standalone-document path still requires items (H4 only
    // ignores client-sent items when an order_id is present and delegation happens).
    await assert.rejects(() => salesService.createManualInvoice({ items: [] }, 'u'), /Invoice must contain items/);
});

test('createManualInvoice links its order, applies advances and records the outstanding balance', async (t) => {
    // Since order_id present now delegates entirely to createInvoice (H4: client-sent
    // items/prices/VAT for an order invoice are ignored), the mock must also satisfy
    // createInvoice's own query shape (order lookup, order_items, order_payments, billing_pos).
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, invoice_id, external_source, shipping_method FROM orders')) return [[{ id: 'o-manual', invoice_id: null }]];
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') return [[{
            id: 'o-manual', status: 'packed', client_id: 'client-1', customer_name: 'Ana', payment_method: null
        }]];
        if (statement.includes('FROM order_items oi')) return [[{
            product_id: 'p-1', quantity: 1, picked_quantity: 1, unit_price: 100,
            vat_rate: 21, product_name: 'Producto', sku: null
        }]];
        if (statement.includes('FROM order_payments')) return [[]];
        if (statement.includes('SELECT billing_pos')) return [[]];
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        client: salesService._resolveClientSnapshot,
        transfer: salesService._transferOrderReceivablePayments,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        audit: auditService.log,
    };
    salesService._nextInvoiceNumber = async () => 9;
    salesService._resolveClientSnapshot = async () => ({
        client_id: 'client-1', client_name: 'Ana', client_tax_id: null,
        client_address: null, client_tax_condition: 'consumidor_final',
    });
    salesService._transferOrderReceivablePayments = async () => 20;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        salesService._resolveClientSnapshot = originals.client;
        salesService._transferOrderReceivablePayments = originals.transfer;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });

    // Client-sent items/prices/VAT below are ignored: the order's own items (mocked above,
    // net 100 + 21% VAT = 121) are what get billed, per H4.
    const result = await salesService.createManualInvoice({
        order_id: 'o-manual', client_id: 'client-1', invoice_type: 'B', point_of_sale: 1,
        items: [{ product_id: 'p-1', product_name: 'Producto', quantity: 999, unit_price: 1, vat_rate: 0 }],
    }, 'u-1');
    assert.equal(result.total_amount, 121);
    assert.equal(result.paid_amount, 20);
    assert.equal(result.payment_status, 'partial');
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE invoices SET payment_status') && params[0] === 'partial'));
    assert.ok(calls.some(({ sql, params }) => sql.includes('current_account_balance') && params[0] === 101));
    assert.ok(calls.some(({ sql, params }) => sql.includes('UPDATE orders') && params.at(-1) === 'o-manual'));
});

test('AUD-009: the old offline queue invoicing a POS order gets its letter corrected and audited, not refused forever', async (t) => {
    let externalSource = 'pos';
    let shippingMethod = null;
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id, invoice_id, external_source, shipping_method FROM orders')) {
            return [[{ id: 'o-off', invoice_id: null, external_source: externalSource, shipping_method: shippingMethod }]];
        }
        if (statement === 'SELECT * FROM orders WHERE id = ? FOR UPDATE') return [[{ id: 'o-off', status: 'completed', client_id: null, customer_name: 'Consumidor final' }]];
        if (statement.includes('FROM order_items oi')) return [[{ product_id: 'p-1', quantity: 1, unit_price: 100, vat_rate: 21, product_name: 'Producto' }]];
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        transfer: salesService._transferOrderReceivablePayments,
        audit: auditService.log,
    };
    const audits = [];
    salesService._nextInvoiceNumber = async () => 5;
    salesService._transferOrderReceivablePayments = async () => 0;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async (payload) => { audits.push(payload); };
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        salesService._transferOrderReceivablePayments = originals.transfer;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });
    const capturedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // A sale made offline asked for an A without a customer: it is issued as B and audited.
    const corrected = await salesService.createManualInvoice({ order_id: 'o-off', invoice_type: 'A', offline_captured_at: capturedAt, items: [{ product_id: 'p-1' }] }, 'u');
    assert.equal(corrected.invoice_type, 'B');
    const generated = audits.find(({ action }) => action === 'GENERATE_INVOICE');
    assert.deepEqual([generated.new_values.invoiceType, generated.new_values.invoice_type_requested], ['B', 'A']);
    // The declaration itself is on record, not only its effect (security review).
    assert.deepEqual([generated.new_values.offline_replay, generated.new_values.offline_captured_at], [true, capturedAt]);

    // Not offline, a POS order with shipping, or not a POS order: the strict control stays.
    await assert.rejects(
        () => salesService.createManualInvoice({ order_id: 'o-off', invoice_type: 'A', items: [{ product_id: 'p-1' }] }, 'u'),
        (error) => error.errorCode === 'invoice_cuit_required'
    );
    shippingMethod = 'delivery';
    await assert.rejects(
        () => salesService.createManualInvoice({ order_id: 'o-off', invoice_type: 'A', offline_captured_at: capturedAt, items: [{ product_id: 'p-1' }] }, 'u'),
        (error) => error.errorCode === 'invoice_cuit_required'
    );
    shippingMethod = null;
    externalSource = 'tiendanube';
    await assert.rejects(
        () => salesService.createManualInvoice({ order_id: 'o-off', invoice_type: 'A', offline_captured_at: capturedAt, items: [{ product_id: 'p-1' }] }, 'u'),
        (error) => error.errorCode === 'invoice_cuit_required'
    );
});

test('createManualInvoice supports a standalone anonymous document with item defaults', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[]];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        accounting: accountingService.postInvoiceAccountingEntries,
        finance: financeService._registerInvoicePayments,
        audit: auditService.log,
    };
    salesService._nextInvoiceNumber = async () => 3;
    accountingService.postInvoiceAccountingEntries = async () => {};
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        salesService._nextInvoiceNumber = originals.next;
        accountingService.postInvoiceAccountingEntries = originals.accounting;
        financeService._registerInvoicePayments = originals.finance;
        auditService.log = originals.audit;
    });

    const result = await salesService.createManualInvoice({
        payment_method: 'bank',
        created_by: 'creator-fallback',
        items: [{ quantity: 1, unit_price: 100, description: 'Servicio técnico' }]
    }, null);
    assert.equal(result.invoice_type, 'B');
    assert.equal(result.point_of_sale, 1);
    assert.equal(result.total_amount, 121);
    assert.equal(result.paid_amount, 0);
    assert.equal(result.payment_status, 'pending');
    assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO invoice_items') && params.includes('Servicio técnico')));
    assert.equal(calls.some(({ sql }) => sql.includes('UPDATE orders')), false);
    assert.equal(calls.some(({ sql }) => sql.includes('current_account_balance')), false);
});

test('external status walks the real transitions, consumes reservations and never moves backwards', async (t) => {
    const originalFind = salesService.findById;
    const originalTransition = salesService.transitionOrderStatus;
    t.after(() => {
        salesService.findById = originalFind;
        salesService.transitionOrderStatus = originalTransition;
    });
    let status;
    const steps = [];
    salesService.findById = async (id) => ({ id, status });
    salesService.transitionOrderStatus = async (id, next, _user, options) => {
        steps.push([next, Boolean(options?.assumeFullyPicked)]);
        return { id, status: next };
    };

    status = 'pending';
    await salesService.applyExternalStatus('o', 'completed');
    assert.deepEqual(steps.splice(0), [['picking', false], ['packed', true], ['delivered', false], ['completed', false]]);

    status = 'dispatched';
    await salesService.applyExternalStatus('o', 'delivered');
    assert.deepEqual(steps.splice(0), [['delivered', false]]);

    status = 'packed';
    await salesService.applyExternalStatus('o', 'cancelled');
    assert.deepEqual(steps.splice(0), [['cancelled', false]]);

    // Remote 'dispatched' walks pending -> picking -> packed(assumeFullyPicked) -> dispatched.
    status = 'pending';
    await salesService.applyExternalStatus('o', 'dispatched');
    assert.deepEqual(steps.splice(0), [['picking', false], ['packed', true], ['dispatched', false]]);

    status = 'picking';
    await salesService.applyExternalStatus('o', 'dispatched');
    assert.deepEqual(steps.splice(0), [['packed', true], ['dispatched', false]]);

    status = 'packed';
    await salesService.applyExternalStatus('o', 'dispatched');
    assert.deepEqual(steps.splice(0), [['dispatched', false]]);

    // Never backwards: already dispatched/delivered/completed, remote 'dispatched' is a no-op.
    for (const current of ['dispatched', 'delivered', 'completed']) {
        status = current;
        await salesService.applyExternalStatus('o', 'dispatched');
        assert.deepEqual(steps, []);
    }

    for (const [current, remote] of [['completed', 'cancelled'], ['delivered', 'cancelled'], ['completed', 'delivered'], ['pending', 'packed']]) {
        status = current;
        await salesService.applyExternalStatus('o', remote);
    }
    assert.deepEqual(steps, []);
});
