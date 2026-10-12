import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import stockAuditService, { classifyStockByValue } from '../services/stockAudit.service.js';
import { mockPool } from './helpers/mockDb.js';

function stubAudit(t) {
    const original = auditService.log;
    const calls = [];
    auditService.log = async (...args) => { calls.push(args); };
    t.after(() => { auditService.log = original; });
    return calls;
}

function detailSession(overrides = {}) {
    return {
        id: 'audit-1',
        audit_number: 'AUD-1',
        location_code: 'A-01',
        abc_class: 'ALL',
        status: 'in_progress',
        blind_count: 1,
        ...overrides,
    };
}

function detailItem(overrides = {}) {
    return {
        id: 'item-1',
        audit_id: 'audit-1',
        product_id: 'product-1',
        product_name: 'Remera',
        sku: 'REM-1',
        abc_class: 'A',
        expected_quantity: '5',
        counted_quantity: null,
        variance: null,
        is_unexpected: 0,
        count_attempts: '0',
        ...overrides,
    };
}

test('classifyStockByValue mirrors Pareto ABC and handles empty values', () => {
    const classes = classifyStockByValue([
        { product_id: 'a', purchase_price: 100, total_stock: 80 },
        { product_id: 'b', purchase_price: 100, total_stock: 15 },
        { product_id: 'c', purchase_price: 100, total_stock: 5 },
    ]);
    assert.deepEqual([...classes.entries()], [['a', 'A'], ['b', 'B'], ['c', 'C']]);
    assert.deepEqual([...classifyStockByValue([
        { product_id: 'x', purchase_price: null, total_stock: 'bad' },
        { product_id: 'y', purchase_price: -1, total_stock: 3 },
    ]).values()], ['C', 'C']);
});

test('listSessions applies filters and normalizes progress metrics', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[{
            ...detailSession(), total_items: '4', counted_items: '3', exact_items: '2', variance_units: '5.5', blind_count: 1,
        }]];
    });
    const rows = await stockAuditService.listSessions({ status: 'in_progress', abc_class: 'A', location_code: 'A-01' });
    assert.equal(rows[0].pending_items, 1);
    assert.equal(rows[0].accuracy_percent, 66.67);
    assert.equal(rows[0].blind_count, true);
    assert.deepEqual(calls[0].params, ['in_progress', 'A', 'A-01']);

    const emptyMetrics = await stockAuditService.listSessions();
    assert.equal(emptyMetrics[0].pending_items, 1);
});

test('getDashboard aggregates overall and per-class accuracy', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('COUNT(DISTINCT session.id)')) {
            return [[{ total_audits: '3', counted_items: '10', exact_items: '9', variance_units: '2' }]];
        }
        if (statement.includes('GROUP BY item.abc_class')) {
            return [[
                { abc_class: 'A', counted_items: '4', exact_items: '4', variance_units: 0 },
                { abc_class: 'B', counted_items: '6', exact_items: '5', variance_units: 2 },
            ]];
        }
        return [[
            { ...detailSession(), total_items: 2, counted_items: 1, exact_items: 0, variance_units: 0 },
            { ...detailSession({ id: 'audit-2', status: 'completed' }), total_items: 1, counted_items: 1, exact_items: 1, variance_units: 0 },
        ]];
    });
    const dashboard = await stockAuditService.getDashboard();
    assert.equal(dashboard.summary.total_audits, 3);
    assert.equal(dashboard.summary.active_audits, 1);
    assert.equal(dashboard.summary.accuracy_percent, 90);
    assert.equal(dashboard.by_class[0].accuracy_percent, 100);
    assert.equal(dashboard.by_class[1].accuracy_percent, 83.33);
    assert.equal(dashboard.by_class[2].counted_items, 0);
});

test('getDashboard and listSessions fall back for empty aggregates', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('COUNT(DISTINCT session.id)')) return [[]];
        if (statement.includes('GROUP BY item.abc_class')) return [[]];
        return [[]];
    });
    const dashboard = await stockAuditService.getDashboard({ status: 'completed' });
    assert.equal(dashboard.summary.accuracy_percent, 0);
    assert.equal(dashboard.summary.variance_units, 0);
    assert.deepEqual(dashboard.sessions, []);
});

test('getSession returns normalized item details and rejects unknown ids', async (t) => {
    let found = true;
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM stock_audit_sessions session')) return [found ? [detailSession()] : []];
        return [[
            detailItem({ counted_quantity: '5', variance: '0', is_unexpected: 1, count_attempts: '2' }),
            detailItem({ id: 'item-2', product_id: 'product-2', counted_quantity: '2', expected_quantity: '4', variance: '-2' }),
        ]];
    });
    const result = await stockAuditService.getSession('audit-1');
    assert.equal(result.total_items, 2);
    assert.equal(result.exact_items, 1);
    assert.equal(result.variance_units, 2);
    assert.equal(result.items[0].is_unexpected, true);
    assert.equal(result.items[0].count_attempts, 2);

    found = false;
    await assert.rejects(() => stockAuditService.getSession('missing'), (error) => error.statusCode === 404);
});

test('createSession snapshots scoped inventory and audits creation', async (t) => {
    const auditCalls = stubAudit(t);
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('FROM warehouse_locations')) return [[{ code: 'A-01', name: 'Pasillo A' }]];
        if (statement.includes("status = 'in_progress'") && statement.includes('LIMIT 1 FOR UPDATE')) return [[]];
        if (statement.includes('GROUP BY p.id, p.purchase_price')) return [[
            { product_id: 'product-1', purchase_price: 80, total_stock: 10 },
            { product_id: 'product-2', purchase_price: 20, total_stock: 10 },
        ]];
        if (statement.includes('MIN(i.id) AS inventory_id')) return [[
            { inventory_id: 'inv-1', product_id: 'product-1', expected_quantity: 10 },
            { inventory_id: 'inv-2', product_id: 'product-2', expected_quantity: 10 },
        ]];
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession({ abc_class: 'A' })]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem()]];
        return [{ affectedRows: 1 }];
    });
    const result = await stockAuditService.createSession({ location_code: 'A-01', abc_class: 'A', notes: 'Semanal' }, 'user-1');
    assert.equal(result.abc_class, 'A');
    assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO stock_audit_items') && params.length === 7));
    assert.equal(auditCalls[0][0].action, 'CREATE_STOCK_AUDIT');
});

test('createSession rejects invalid, duplicate and empty scopes with rollback', async (t) => {
    let mode = 'invalid';
    const connection = mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM warehouse_locations')) return [mode === 'invalid' ? [] : [{ code: 'A-01' }]];
        if (statement.includes("status = 'in_progress'")) return [mode === 'duplicate' ? [{ id: 'open' }] : []];
        if (statement.includes('GROUP BY p.id, p.purchase_price')) return [[{ product_id: 'p', purchase_price: 1, total_stock: 1 }]];
        if (statement.includes('MIN(i.id) AS inventory_id')) return [[]];
        return [[]];
    });
    let rollbacks = 0;
    connection.rollback = async () => { rollbacks += 1; };
    await assert.rejects(() => stockAuditService.createSession({ location_code: 'X', abc_class: 'ALL' }), (error) => error.errorCode === 'WAREHOUSE_LOCATION_NOT_FOUND');
    mode = 'duplicate';
    await assert.rejects(() => stockAuditService.createSession({ location_code: 'A-01', abc_class: 'ALL' }), (error) => error.statusCode === 409);
    mode = 'empty';
    await assert.rejects(() => stockAuditService.createSession({ location_code: 'A-01', abc_class: 'C' }), (error) => error.errorCode === 'STOCK_AUDIT_EMPTY_SCOPE');
    assert.equal(rollbacks, 3);
});

test('countItem updates an existing snapshot and records recount events', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) return [[detailSession()]];
        if (statement.includes('FROM products') && statement.includes('sku = ?')) return [[{ id: 'product-1', sku: 'REM-1' }]];
        if (statement.startsWith('SELECT * FROM stock_audit_items')) return [[detailItem({ counted_quantity: 4 })]];
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession()]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem({ counted_quantity: 7, variance: 2, count_attempts: 2 })]];
        return [{ affectedRows: 1 }];
    });
    const result = await stockAuditService.countItem('audit-1', { code: ' REM-1 ', quantity: 7, notes: 'reconteo' }, 'user-1');
    assert.equal(result.items[0].counted_quantity, 7);
    assert.ok(calls.some(({ sql, params }) => sql.trim().startsWith('UPDATE stock_audit_items') && params[0] === 7 && params[1] === 2));
    assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO stock_audit_count_events') && params[4] === 4));
});

test('countItem adds physically unexpected products in scope', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) return [[detailSession({ abc_class: 'ALL' })]];
        if (statement.includes('FROM products') && statement.includes('sku = ?')) return [[{ id: 'product-2', sku: 'NEW-2' }]];
        if (statement.startsWith('SELECT * FROM stock_audit_items')) return [[]];
        if (statement.includes('GROUP BY p.id, p.purchase_price')) return [[{ product_id: 'product-2', purchase_price: 1, total_stock: 0 }]];
        if (statement.startsWith('SELECT id, quantity FROM inventory')) return [[]];
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession()]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem({ product_id: 'product-2', expected_quantity: 0, counted_quantity: 3, variance: 3, is_unexpected: 1 })]];
        return [{ affectedRows: 1 }];
    });
    const result = await stockAuditService.countItem('audit-1', { code: 'NEW-2', quantity: 3 }, null);
    assert.equal(result.items[0].variance, 3);
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO stock_audit_items')));
});

test('countItem rejects missing sessions, closed sessions, products and ABC mismatches', async (t) => {
    let mode = 'missing-session';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) {
            if (mode === 'missing-session') return [[]];
            return [[detailSession({ status: mode === 'closed' ? 'completed' : 'in_progress', abc_class: 'A' })]];
        }
        if (statement.includes('FROM products') && statement.includes('sku = ?')) {
            return [mode === 'missing-product' ? [] : [{ id: 'product-2', sku: 'P-2' }]];
        }
        if (statement.startsWith('SELECT * FROM stock_audit_items')) return [[]];
        if (statement.includes('GROUP BY p.id, p.purchase_price')) return [[{ product_id: 'product-2', purchase_price: 0, total_stock: 0 }]];
        return [[]];
    });
    await assert.rejects(() => stockAuditService.countItem('x', { code: 'x', quantity: 1 }), (error) => error.errorCode === 'STOCK_AUDIT_NOT_FOUND');
    mode = 'closed';
    await assert.rejects(() => stockAuditService.countItem('x', { code: 'x', quantity: 1 }), (error) => error.errorCode === 'STOCK_AUDIT_NOT_ACTIVE');
    mode = 'missing-product';
    await assert.rejects(() => stockAuditService.countItem('x', { code: 'x', quantity: 1 }), (error) => error.errorCode === 'STOCK_AUDIT_PRODUCT_NOT_FOUND');
    mode = 'mismatch';
    await assert.rejects(() => stockAuditService.countItem('x', { code: 'x', quantity: 1 }), (error) => error.errorCode === 'STOCK_AUDIT_PRODUCT_OUT_OF_SCOPE');
});

test('completeSession closes only fully counted audits', async (t) => {
    const auditCalls = stubAudit(t);
    let pending = 0;
    const connection = mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) return [[detailSession()]];
        if (statement.includes('COUNT(*) AS total_items')) return [[{ total_items: 2, pending_items: pending }]];
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession({ status: 'completed' })]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem({ counted_quantity: 5, variance: 0 })]];
        return [{ affectedRows: 1 }];
    });
    const result = await stockAuditService.completeSession('audit-1', 'user-1');
    assert.equal(result.status, 'completed');
    assert.equal(auditCalls[0][0].action, 'COMPLETE_STOCK_AUDIT');

    pending = 1;
    await assert.rejects(() => stockAuditService.completeSession('audit-1'), (error) => error.errorCode === 'STOCK_AUDIT_PENDING_ITEMS');
    connection.query = async (sql) => String(sql).startsWith('SELECT * FROM stock_audit_sessions') ? [[detailSession({ status: 'cancelled' })]] : [[]];
    await assert.rejects(() => stockAuditService.completeSession('audit-1'), (error) => error.errorCode === 'STOCK_AUDIT_NOT_ACTIVE');
    connection.query = async () => [[]];
    await assert.rejects(() => stockAuditService.completeSession('missing'), (error) => error.errorCode === 'STOCK_AUDIT_NOT_FOUND');
});

test('cancelSession records active/submitted cancellations and rejects final states', async (t) => {
    const auditCalls = stubAudit(t);
    let mode = 'active';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) {
            if (mode === 'missing') return [[]];
            return [[detailSession({ status: mode === 'active' ? 'in_progress' : mode === 'completed' ? 'completed' : 'adjusted' })]];
        }
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession({ status: 'cancelled' })]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem()]];
        return [{ affectedRows: 1 }];
    });
    assert.equal((await stockAuditService.cancelSession('audit-1', 'user-1')).status, 'cancelled');
    assert.equal(auditCalls[0][0].action, 'CANCEL_STOCK_AUDIT');
    assert.equal(auditCalls[0][0].old_values.status, 'in_progress');
    mode = 'completed';
    assert.equal((await stockAuditService.cancelSession('audit-1', 'user-1')).status, 'cancelled');
    assert.equal(auditCalls[1][0].old_values.status, 'completed');
    mode = 'closed';
    await assert.rejects(() => stockAuditService.cancelSession('audit-1'), (error) => error.errorCode === 'STOCK_AUDIT_NOT_CANCELLABLE');
    mode = 'missing';
    await assert.rejects(() => stockAuditService.cancelSession('audit-1'), (error) => error.statusCode === 404);
});

test('applyAdjustments reconciles positive and negative differences atomically', async (t) => {
    const auditCalls = stubAudit(t);
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) return [[detailSession({ status: 'completed' })]];
        if (statement.includes('SELECT item.*, product.name')) return [[
            detailItem({ product_id: 'product-1', expected_quantity: 5, counted_quantity: 3, variance: -2, purchase_price: 10 }),
            detailItem({ id: 'item-2', product_id: 'product-2', expected_quantity: 0, counted_quantity: 4, variance: 4, purchase_price: 20, sku: 'NEW-2' }),
            detailItem({ id: 'item-3', product_id: 'product-3', expected_quantity: 2, counted_quantity: 2, variance: 0, sku: 'OK-3' }),
        ]];
        if (statement.startsWith('SELECT id, quantity, reserved_quantity')) {
            if (params[0] === 'product-1') return [[{ id: 'inv-1', quantity: 5, reserved_quantity: 1 }]];
            if (params[0] === 'product-3') return [[{ id: 'inv-3', quantity: 2, reserved_quantity: 0 }]];
            return [[]];
        }
        if (statement.includes('FROM stock_audit_sessions session')) return [[detailSession({ status: 'adjusted' })]];
        if (statement.includes('FROM stock_audit_items item')) return [[detailItem({ counted_quantity: 3, variance: -2 })]];
        return [{ affectedRows: 1 }];
    });
    const result = await stockAuditService.applyAdjustments('audit-1', 'manager-1');
    assert.equal(result.status, 'adjusted');
    assert.ok(calls.some(({ sql }) => sql.startsWith('UPDATE inventory SET quantity = ?')));
    assert.ok(calls.some(({ sql }) => sql.startsWith('INSERT INTO inventory (id, product_id')));
    assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO inventory_movements')).length, 2);
    assert.equal(auditCalls[0][0].new_values.adjusted_items, 2);
});

test('applyAdjustments blocks stale, reserved, missing and non-completed audits', async (t) => {
    let mode = 'stale';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM stock_audit_sessions')) {
            if (mode === 'missing') return [[]];
            return [[detailSession({ status: mode === 'closed' ? 'in_progress' : mode === 'already' ? 'adjusted' : 'completed' })]];
        }
        if (statement.includes('SELECT item.*, product.name')) return [[detailItem({ expected_quantity: 5, counted_quantity: mode === 'reserved' ? 1 : 5, variance: 0 })]];
        if (statement.startsWith('SELECT id, quantity, reserved_quantity')) {
            return [[{ id: 'inv-1', quantity: mode === 'stale' ? 6 : 5, reserved_quantity: mode === 'reserved' ? 2 : 0 }]];
        }
        return [[]];
    });
    await assert.rejects(() => stockAuditService.applyAdjustments('audit-1'), (error) => error.errorCode === 'STOCK_AUDIT_STALE_SNAPSHOT');
    mode = 'reserved';
    await assert.rejects(() => stockAuditService.applyAdjustments('audit-1'), (error) => error.message.includes('reservas'));
    mode = 'closed';
    await assert.rejects(() => stockAuditService.applyAdjustments('audit-1'), (error) => error.errorCode === 'STOCK_AUDIT_NOT_ADJUSTABLE');
    mode = 'already';
    await assert.rejects(() => stockAuditService.applyAdjustments('audit-1'), (error) => error.statusCode === 409);
    mode = 'missing';
    await assert.rejects(() => stockAuditService.applyAdjustments('audit-1'), (error) => error.statusCode === 404);
});

test('getAbcMap accepts an explicit executor', async () => {
    const executor = { query: async () => [[{ product_id: 'p', purchase_price: 2, total_stock: 3 }]] };
    assert.equal((await stockAuditService.getAbcMap(executor)).get('p'), 'A');
    assert.equal(typeof pool.query, 'function');
});
