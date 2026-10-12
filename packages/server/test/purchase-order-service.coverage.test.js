import test from 'node:test';
import assert from 'node:assert/strict';

import purchaseOrderService, { PurchaseOrderService } from '../domains/procurement/PurchaseOrderService.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function installPool(t, handler) {
    const calls = [];
    const lifecycle = [];
    const run = async (sql, params = []) => {
        const statement = norm(sql);
        calls.push({ statement, params });
        return handler(statement, params);
    };
    const connection = {
        query: run,
        async beginTransaction() { lifecycle.push('begin'); },
        async commit() { lifecycle.push('commit'); },
        async rollback() { lifecycle.push('rollback'); },
        release() { lifecycle.push('release'); }
    };
    const prev = { query: pool.query, getConnection: pool.getConnection };
    pool.query = run;
    pool.getConnection = async () => connection;
    t.after(() => {
        pool.query = prev.query;
        pool.getConnection = prev.getConnection;
    });
    return { calls, lifecycle };
}

function installAudit(t) {
    const logs = [];
    const prev = auditService.log;
    auditService.log = async (payload) => { logs.push(payload); };
    t.after(() => { auditService.log = prev; });
    return logs;
}

test('getTaxRate uses company setting, falls back to 21% and accepts a connection', async (t) => {
    const rates = [[{ tax_rate: '0.105' }], [], [{ tax_rate: null }]];
    installPool(t, async () => [rates.shift()]);
    assert.equal(await purchaseOrderService.getTaxRate(), 0.105);
    assert.equal(await purchaseOrderService.getTaxRate(), 0.21);
    const conn = { query: async () => [[{ tax_rate: null }]] };
    assert.equal(await purchaseOrderService.getTaxRate(conn), 0.21);
});

test('getPurchaseOrders without filters returns empty list without querying items', async (t) => {
    const { calls } = installPool(t, async () => [[]]);
    const result = await new PurchaseOrderService().getPurchaseOrders();
    assert.deepEqual(result, []);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, []);
    assert.ok(calls[0].statement.endsWith('ORDER BY po.created_at DESC'));
});

test('getPurchaseOrders applies filters and groups items by order', async (t) => {
    const { calls } = installPool(t, async (statement) => {
        if (statement.includes('FROM purchase_orders po')) return [[{ id: 'o1' }, { id: 'o2' }]];
        return [[
            { id: 'i1', purchase_order_id: 'o1' },
            { id: 'i2', purchase_order_id: 'o1' }
        ]];
    });
    const result = await purchaseOrderService.getPurchaseOrders({ supplier_id: 's1', status: 'sent' });
    assert.ok(calls[0].statement.includes('AND po.supplier_id = ?'));
    assert.ok(calls[0].statement.includes('AND po.status = ?'));
    assert.deepEqual(calls[0].params, ['s1', 'sent']);
    assert.deepEqual(calls[1].params, [['o1', 'o2']]);
    assert.equal(result[0].items.length, 2);
    assert.deepEqual(result[1].items, []);
});

test('createPurchaseOrder computes totals, inserts items, commits and audits', async (t) => {
    const logs = installAudit(t);
    const { calls, lifecycle } = installPool(t, async (statement) => {
        if (statement.includes('MAX(CAST')) return [[{ max_seq: 4 }]];
        if (statement.includes('SELECT `last_value`')) return [[{ last_value: 2 }]];
        if (statement.includes('company_settings')) return [[{ tax_rate: '0.10' }]];
        return [[]];
    });
    const result = await purchaseOrderService.createPurchaseOrder({
        supplier_id: 's1',
        order_date: '2026-01-02',
        expected_delivery_date: '2026-01-10',
        notes: 'urgente',
        items: [
            { product_id: 'p1', quantity_ordered: 2, unit_cost: 100 },
            { product_id: 'p2', quantity: 3, unit_cost: 50 }
        ]
    }, 'u1', '10.0.0.1');

    const year = new Date().getFullYear();
    assert.equal(result.po_number, `PO-${year}-005`);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);

    const insertPo = calls.find((c) => c.statement.startsWith('INSERT INTO purchase_orders ('));
    assert.equal(insertPo.params[1], `PO-${year}-005`);
    assert.equal(insertPo.params[5], 350);
    assert.ok(Math.abs(insertPo.params[6] - 35) < 1e-9);
    assert.ok(Math.abs(insertPo.params[7] - 385) < 1e-9);
    assert.equal(insertPo.params[8], 'urgente');

    const itemInserts = calls.filter((c) => c.statement.startsWith('INSERT INTO purchase_order_items'));
    assert.deepEqual(itemInserts.map((c) => [c.params[2], c.params[3], c.params[4]]), [['p1', 2, 100], ['p2', 3, 50]]);

    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, 'CREATE_PURCHASE_ORDER');
    assert.equal(logs[0].user_id, 'u1');
    assert.equal(logs[0].ip_address, '10.0.0.1');
    assert.equal(logs[0].new_values.po_number, `PO-${year}-005`);
});

test('createPurchaseOrder applies defaults (date, null optional fields, null user)', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t, async (statement) => {
        if (statement.includes('MAX(CAST')) return [[{ max_seq: null }]];
        if (statement.includes('SELECT `last_value`')) return [[]];
        if (statement.includes('company_settings')) return [[]];
        return [[]];
    });
    const result = await purchaseOrderService.createPurchaseOrder({
        supplier_id: 's1',
        items: [{ product_id: 'p1' }]
    });
    assert.match(result.po_number, /-001$/);
    const insertPo = calls.find((c) => c.statement.startsWith('INSERT INTO purchase_orders ('));
    assert.match(insertPo.params[3], /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(insertPo.params[4], null);
    assert.equal(insertPo.params[5], 0);
    assert.equal(insertPo.params[8], null);
    assert.equal(logs[0].user_id, null);
    assert.equal(logs[0].ip_address, null);
    assert.equal(logs[0].new_values.notes, null);
});

test('createPurchaseOrder rolls back and releases when an insert fails', async (t) => {
    const logs = installAudit(t);
    const { lifecycle } = installPool(t, async (statement) => {
        if (statement.includes('MAX(CAST')) return [[{ max_seq: 0 }]];
        if (statement.includes('SELECT `last_value`')) return [[{ last_value: 0 }]];
        if (statement.includes('company_settings')) return [[{ tax_rate: 0.21 }]];
        if (statement.startsWith('INSERT INTO purchase_order_items')) throw new Error('db down');
        return [[]];
    });
    await assert.rejects(
        () => purchaseOrderService.createPurchaseOrder({ supplier_id: 's1', items: [{ product_id: 'p1', quantity: 1, unit_cost: 1 }] }, 'u1'),
        /db down/
    );
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
    assert.equal(logs.length, 0);
});
