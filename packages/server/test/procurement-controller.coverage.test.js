import test from 'node:test';
import assert from 'node:assert/strict';

import * as ctrl from '../controllers/procurementController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import inventoryService from '../services/inventory.service.js';
import purchaseOrderService from '../domains/procurement/PurchaseOrderService.js';
import supplierReturnService from '../domains/procurement/SupplierReturnService.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) { statusCode = code; return this; },
            json(body) { settled = true; resolve({ status: statusCode, body }); return this; }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try { handler(req, res, next); } catch (error) { next(error); }
    });
}

// rules: ordered list of [substring, response | (statement, params) => response]. First match wins.
function installPool(t, rules = []) {
    const calls = [];
    const lifecycle = [];
    const run = async (sql, params = []) => {
        const statement = norm(sql);
        calls.push({ statement, params });
        for (const [needle, response] of rules) {
            if (statement.includes(needle)) {
                return typeof response === 'function' ? response(statement, params) : response;
            }
        }
        return [[]];
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
    return { calls, lifecycle, connection };
}

function stub(t, target, name, fn) {
    const prev = target[name];
    target[name] = fn;
    t.after(() => { target[name] = prev; });
}

function installAudit(t) {
    const logs = [];
    stub(t, auditService, 'log', async (payload, conn) => { logs.push({ payload, conn }); });
    return logs;
}

const year = new Date().getFullYear();

// ---------- purchase orders ----------

test('getPurchaseOrders and createPurchaseOrder delegate to the domain service', async (t) => {
    const seen = [];
    stub(t, purchaseOrderService, 'getPurchaseOrders', async (q) => { seen.push(['list', q]); return [{ id: 'o1' }]; });
    stub(t, purchaseOrderService, 'createPurchaseOrder', async (...a) => { seen.push(['create', ...a]); return { id: 'o2' }; });
    const list = await runHandler(ctrl.getPurchaseOrders, { query: { status: 'sent' } });
    assert.deepEqual(list.body, [{ id: 'o1' }]);
    assert.deepEqual(seen[0], ['list', { status: 'sent' }]);
    const created = await runHandler(ctrl.createPurchaseOrder, { body: { supplier_id: 's' }, user: { id: 'u1' }, ip: '9.9.9.9' });
    assert.deepEqual(created.body, { id: 'o2' });
    assert.equal(seen[1][1].supplier_id, 's');
    assert.equal(seen[1][2], 'u1');
    assert.equal(typeof seen[1][3], 'string');
});

test('getPurchaseOrder returns 404 when missing', async (t) => {
    installPool(t, [['FROM purchase_orders po', [[]]]]);
    const res = await runHandler(ctrl.getPurchaseOrder, { params: { id: 'x' } });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
});

test('getPurchaseOrder attaches items with pending QC quantity', async (t) => {
    const { calls } = installPool(t, [
        ['FROM purchase_orders po', [[{ id: 'o1', supplier_name: 'S' }]]],
        ['FROM purchase_order_items poi', [[{ id: 'i1', quantity_pending_qc: 3 }]]]
    ]);
    const res = await runHandler(ctrl.getPurchaseOrder, { params: { id: 'o1' } });
    assert.equal(res.body.items[0].quantity_pending_qc, 3);
    assert.deepEqual(calls[1].params, ['o1']);
});

test('updatePurchaseOrderStatus rejects invalid status before touching the DB', async (t) => {
    const { calls } = installPool(t);
    const res = await runHandler(ctrl.updatePurchaseOrderStatus, { params: { id: 'o1' }, body: { status: 'bogus' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_status');
    assert.equal(calls.length, 0);
});

test('updatePurchaseOrderStatus returns 404 for unknown order', async (t) => {
    const { calls } = installPool(t, [['SELECT id, status', [[]]]]);
    const res = await runHandler(ctrl.updatePurchaseOrderStatus, { params: { id: 'o1' }, body: { status: 'sent' } });
    assert.equal(res.status, 404);
    assert.ok(!calls.some((c) => c.statement.startsWith('UPDATE')));
});

test('updatePurchaseOrderStatus updates and audits the transition', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t, [
        ['SELECT id, status', [[{ id: 'o1', status: 'draft' }]]],
        ['SELECT * FROM purchase_orders', [[{ id: 'o1', status: 'sent' }]]]
    ]);
    const res = await runHandler(ctrl.updatePurchaseOrderStatus, { params: { id: 'o1' }, body: { status: 'sent' }, user: { id: 'u1' } });
    assert.deepEqual(res.body, { id: 'o1', status: 'sent' });
    const update = calls.find((c) => c.statement.startsWith('UPDATE purchase_orders'));
    assert.deepEqual(update.params, ['sent', 'o1']);
    assert.equal(logs[0].payload.action, 'UPDATE_PURCHASE_ORDER_STATUS');
    assert.deepEqual(logs[0].payload.old_values, { status: 'draft' });
    assert.deepEqual(logs[0].payload.new_values, { status: 'sent' });
    assert.equal(logs[0].payload.user_id, 'u1');
});

test('updatePurchaseOrderStatus audit falls back to requested status and null user', async (t) => {
    const logs = installAudit(t);
    installPool(t, [
        ['SELECT id, status', [[{ id: 'o1', status: 'draft' }]]],
        ['SELECT * FROM purchase_orders', [[]]]
    ]);
    const res = await runHandler(ctrl.updatePurchaseOrderStatus, { params: { id: 'o1' }, body: { status: 'cancelled' } });
    assert.equal(res.body, undefined);
    assert.equal(logs[0].payload.user_id, null);
    assert.deepEqual(logs[0].payload.new_values, { status: 'cancelled' });
});

// ---------- receptions ----------

test('getReceptions returns empty list without loading items', async (t) => {
    const { calls } = installPool(t, [['FROM receptions r', [[]]]]);
    const res = await runHandler(ctrl.getReceptions);
    assert.deepEqual(res.body, []);
    assert.equal(calls.length, 1);
});

test('getReceptions filters and groups items per reception', async (t) => {
    const { calls } = installPool(t, [
        ['FROM receptions r', [[{ id: 'r1' }, { id: 'r2' }]]],
        ['FROM reception_items ri', [[{ reception_id: 'r1', id: 'a' }, { reception_id: 'r1', id: 'b' }]]]
    ]);
    const res = await runHandler(ctrl.getReceptions, { query: { status: 'pending_qc', supplier_id: 's1' } });
    assert.ok(calls[0].statement.includes('AND r.status = ?'));
    assert.ok(calls[0].statement.includes('AND r.supplier_id = ?'));
    assert.deepEqual(calls[0].params, ['pending_qc', 's1']);
    assert.deepEqual(calls[1].params, [['r1', 'r2']]);
    assert.equal(res.body[0].items.length, 2);
    assert.deepEqual(res.body[1].items, []);
});

function receptionRules(overrides = {}) {
    return [
        ['FROM purchase_orders WHERE id = ? FOR UPDATE', overrides.order ?? [[{ id: 'po1', supplier_id: 'sup1', status: 'sent' }]]],
        ['FROM purchase_order_items', overrides.poItems ?? [[{ id: 'poi1', product_id: 'p1', quantity_ordered: 10, quantity_received: 2, unit_cost: '12.00' }]]],
        ['FROM reception_items ri', overrides.pending ?? [[{ po_item_id: 'poi1', pending_quantity: 3 }]]],
        ['SELECT supplier_id FROM purchase_orders', overrides.poSupplier ?? [[{ supplier_id: 'sup1' }]]],
        ['SELECT id FROM receptions', overrides.dupes ?? [[]]],
        ['MAX(CAST', [[{ max_seq: 6 }]]],
        ['SELECT `last_value`', [[{ last_value: 1 }]]]
    ];
}

async function expectReceptionFailure(t, rules, body, expected) {
    const logs = installAudit(t);
    const { lifecycle, calls } = installPool(t, rules);
    await assert.rejects(
        () => runHandler(ctrl.createReception, { body }),
        (e) => {
            if (expected.statusCode) assert.equal(e.statusCode, expected.statusCode);
            if (expected.errorCode) assert.equal(e.errorCode, expected.errorCode);
            if (expected.message) assert.match(e.message, expected.message);
            return true;
        }
    );
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
    assert.ok(!calls.some((c) => c.statement.startsWith('INSERT INTO receptions')));
    assert.equal(logs.length, 0);
}

test('createReception 404 when purchase order does not exist', async (t) => {
    await expectReceptionFailure(t, receptionRules({ order: [[]] }),
        { purchase_order_id: 'po1', items: [] }, { statusCode: 404, errorCode: 'PURCHASE_ORDER_NOT_FOUND' });
});

test('createReception 409 when purchase order is not receivable', async (t) => {
    await expectReceptionFailure(t, receptionRules({ order: [[{ id: 'po1', status: 'received' }]] }),
        { purchase_order_id: 'po1', items: [] }, { statusCode: 409, errorCode: 'PURCHASE_ORDER_NOT_RECEIVABLE' });
});

test('createReception 400 for item without po_item_id or repeated items', async (t) => {
    const item = { po_item_id: 'poi1', product_id: 'p1', quantity_received: 1 };
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ product_id: 'p1', quantity_received: 1 }] },
        { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [item, item] },
        { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
});

test('createReception 400 when item product is not in the order', async (t) => {
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'other', quantity_received: 1 }] },
        { statusCode: 400, errorCode: 'RECEPTION_ITEM_NOT_IN_ORDER' });
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'ghost', product_id: 'p1', quantity_received: 1 }] },
        { statusCode: 400, errorCode: 'RECEPTION_ITEM_NOT_IN_ORDER' });
});

test('createReception 409 when quantity exceeds pending balance (ordered - received - pending QC)', async (t) => {
    // 10 ordered - 2 received - 3 pending QC = 5 available
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 6 }] },
        { statusCode: 409, errorCode: 'RECEPTION_EXCEEDS_PENDING_QUANTITY', message: /\(5\)/ });
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 0 }] },
        { errorCode: 'RECEPTION_EXCEEDS_PENDING_QUANTITY' });
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 1.5 }] },
        { errorCode: 'RECEPTION_EXCEEDS_PENDING_QUANTITY' });
    // no pending rows and missing quantities fall back to zero
    await expectReceptionFailure(t, receptionRules({ pending: [[]], poItems: [[{ id: 'poi1', product_id: 'p1' }]] }),
        { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 1 }] },
        { errorCode: 'RECEPTION_EXCEEDS_PENDING_QUANTITY', message: /\(0\)/ });
});

test('createReception requires a supplier when none can be derived', async (t) => {
    await expectReceptionFailure(t, receptionRules(),
        { items: [{ product_id: 'p1', quantity_received: 1, unit_cost: 3 }] }, { message: /supplier_id es obligatorio/ });
    await expectReceptionFailure(t, receptionRules({ order: [[{ id: 'po1', status: 'partial' }]], poItems: [[]], poSupplier: [[]] }),
        { purchase_order_id: 'po1', items: [] }, { message: /supplier_id es obligatorio/ });
});

test('createReception 409 on duplicate remito for supplier', async (t) => {
    await expectReceptionFailure(t, receptionRules({ dupes: [[{ id: 'old' }]] }),
        { supplier_id: 'sup1', remito_number: 'R-1', items: [] }, { statusCode: 409, errorCode: 'DUPLICATE_REMITO' });
});

test('createReception from a purchase order inserts reception and items, then audits on the transaction', async (t) => {
    const logs = installAudit(t);
    const { calls, lifecycle, connection } = installPool(t, receptionRules());
    const res = await runHandler(ctrl.createReception, {
        body: {
            purchase_order_id: 'po1',
            remito_number: 'R-9',
            notes: 'n',
            // ADR-027 (D1): with an order the cost is the order's, whatever the screen sends.
            items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 5, quantity_expected: 5, unit_cost: 99, location_assigned: 'A1', batch_number: 'L1', expiration_date: '2027-01-01', notes: 'ok' }]
        },
        user: { id: 'u1' }
    });
    assert.equal(res.body.reception_number, `REC-${year}-007`);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    const header = calls.find((c) => c.statement.startsWith('INSERT INTO receptions'));
    assert.deepEqual(header.params.slice(1), [`REC-${year}-007`, 'po1', 'sup1', 'R-9', 'n']);
    const row = calls.find((c) => c.statement.startsWith('INSERT INTO reception_items'));
    assert.deepEqual([row.params[2], row.params[3], row.params[4], row.params[5], row.params[6], row.params[7], row.params[8], row.params[9], row.params[10]],
        ['p1', 'poi1', 5, 5, 12, 'A1', 'L1', '2027-01-01', 'ok']);
    const dup = calls.find((c) => c.statement.startsWith('SELECT id FROM receptions'));
    assert.deepEqual(dup.params, ['sup1', 'R-9']);
    assert.equal(logs[0].payload.action, 'CREATE_RECEPTION');
    assert.equal(logs[0].conn, connection);
    // ADR-008: reception creation never posts accounting entries.
    assert.ok(!calls.some((c) => /journal|accounting/i.test(c.statement)));
});

test('createReception without purchase order applies defaults and keeps the typed cost in cents', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t, receptionRules());
    const res = await runHandler(ctrl.createReception, {
        body: { supplier_id: 'supX', items: [{ product_id: 'p1', quantity_received: 2, unit_cost: 8.456 }] }
    });
    assert.equal(res.status, 200);
    assert.ok(!calls.some((c) => c.statement.startsWith('SELECT id FROM receptions')));
    const header = calls.find((c) => c.statement.startsWith('INSERT INTO receptions'));
    assert.deepEqual(header.params.slice(2), [null, 'supX', null, null]);
    const row = calls.find((c) => c.statement.startsWith('INSERT INTO reception_items'));
    assert.deepEqual([row.params[3], row.params[4], row.params[6], row.params[7], row.params[8], row.params[9], row.params[10]],
        [null, 0, 8.46, 'General', null, null, null]);
    assert.equal(logs[0].payload.user_id, null);
});

test('createReception without purchase order needs a cost, whole quantities and one line per product (ADR-027)', async (t) => {
    await expectReceptionFailure(t, receptionRules(),
        { supplier_id: 'supX', items: [{ product_id: 'p1', quantity_received: 2 }] },
        { statusCode: 400, errorCode: 'RECEPTION_COST_REQUIRED' });
    await expectReceptionFailure(t, receptionRules(),
        { supplier_id: 'supX', items: [{ product_id: 'p1', quantity_received: 1.5, unit_cost: 3 }] },
        { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
    await expectReceptionFailure(t, receptionRules(),
        { supplier_id: 'supX', items: [{ product_id: 'p1', quantity_received: 1, unit_cost: 3 }, { product_id: 'p1', quantity_received: 1, unit_cost: 3 }] },
        { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
});

test('createReception without an order: a cost other than the product\'s needs PRODUCTS_COST_EDIT (D5, AUD-016)', async (t) => {
    const product = (cost) => ['FROM products WHERE id IN', [[{ id: 'p1', name: 'Pelota', purchase_price: cost, cost_price: 0 }]]];
    const body = (unitCost) => ({ supplier_id: 'supX', items: [{ product_id: 'p1', quantity_received: 2, unit_cost: unitCost }] });
    const lineCost = (calls) => calls.find((c) => c.statement.startsWith('INSERT INTO reception_items')).params[6];

    // Depósito: the product's cost goes through; another one is refused before saving anything.
    installAudit(t);
    let db = installPool(t, [product(10), ...receptionRules()]);
    await runHandler(ctrl.createReception, { body: body(10), user: { id: 'w', role: 'warehouse' } });
    assert.equal(lineCost(db.calls), 10);
    db = installPool(t, [product(10), ...receptionRules()]);
    const refused = await runHandler(ctrl.createReception, { body: body(0.01), user: { id: 'w', role: 'warehouse' } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'cost_edit_not_allowed');
    assert.match(refused.body.message, /Pelota \(\$10\).*la factura/);
    assert.deepEqual(db.lifecycle, ['begin', 'rollback', 'release']);
    // A product without a cost takes the typed one from anyone (D6).
    db = installPool(t, [product(0), ...receptionRules()]);
    await runHandler(ctrl.createReception, { body: body(7), user: { id: 'w', role: 'warehouse' } });
    assert.equal(lineCost(db.calls), 7);
    // A manager types the delivery note's cost.
    db = installPool(t, [product(10), ...receptionRules()]);
    await runHandler(ctrl.createReception, { body: body(12.5), user: { id: 'm', role: 'manager' } });
    assert.equal(lineCost(db.calls), 12.5);
});

test('createReception without an order refuses order lines; with one, the supplier is the order\'s and a line without cost takes the product\'s', async (t) => {
    await expectReceptionFailure(t, receptionRules(),
        { supplier_id: 'supX', items: [{ product_id: 'p1', po_item_id: 'poi1', quantity_received: 1, unit_cost: 3 }] },
        { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
    await expectReceptionFailure(t, receptionRules(),
        { purchase_order_id: 'po1', supplier_id: 'other', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 1 }] },
        { statusCode: 400, errorCode: 'RECEPTION_SUPPLIER_MISMATCH' });

    installAudit(t);
    const { calls } = installPool(t, [
        ['FROM products WHERE id IN', [[{ id: 'p1', name: 'Pelota', purchase_price: 9, cost_price: 0 }]]],
        ...receptionRules({ poItems: [[{ id: 'poi1', product_id: 'p1', quantity_ordered: 10, quantity_received: 0, unit_cost: 0 }]] }),
    ]);
    await runHandler(ctrl.createReception, {
        body: { purchase_order_id: 'po1', supplier_id: 'sup1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 1 }] },
    });
    const row = calls.find((c) => c.statement.startsWith('INSERT INTO reception_items'));
    assert.equal(row.params[6], 9, 'an order typed without a price does not leave the delivery note stuck');
});

test('createReception derives the supplier from the purchase order', async (t) => {
    installAudit(t);
    const { calls } = installPool(t, receptionRules());
    await runHandler(ctrl.createReception, {
        body: { purchase_order_id: 'po1', items: [{ po_item_id: 'poi1', product_id: 'p1', quantity_received: 1 }] }
    });
    const header = calls.find((c) => c.statement.startsWith('INSERT INTO receptions'));
    assert.equal(header.params[3], 'sup1');
});

// ---------- approveReception ----------

test('approveReception uses the authenticated user as approver and ignores client approved_by', async (t) => {
    const seen = [];
    stub(t, inventoryService, 'processReceptionApproval', async (...a) => { seen.push(a); });
    const res = await runHandler(ctrl.approveReception, { params: { id: 'r1' }, body: { approved_by: 'spoof' }, user: { id: 'u1' } });
    assert.equal(res.body.success, true);
    assert.equal(seen[0][0], 'r1');
    assert.equal(seen[0][1].approvedBy, 'u1');
    assert.equal(seen[0][1].actorUserId, 'u1');
    await runHandler(ctrl.approveReception, { params: { id: 'r2' } });
    assert.equal(seen[1][1].approvedBy, null);
    assert.equal(seen[1][1].actorUserId, null);
});

test('approveReception maps domain errors to HTTP responses', async (t) => {
    const cases = [
        ['RECEPTION_NOT_FOUND', 404, 'not_found'],
        ['RECEPTION_ALREADY_APPROVED', 400, 'reception_already_approved'],
        ['RECEPTION_HAS_NO_ITEMS', 400, 'reception_without_items'],
        ['RECEPTION_QC_INCOMPLETE', 409, 'quality_check_incomplete'],
        ['RECEPTION_QC_INVALID', 409, 'quality_check_incomplete'],
        ['RECEPTION_DUPLICATE_PRODUCT_ITEMS', 409, 'duplicate_reception_product'],
        ['RECEPTION_PURCHASE_ORDER_CANCELLED', 409, 'purchase_order_cancelled']
    ];
    let current;
    stub(t, inventoryService, 'processReceptionApproval', async () => {
        const err = new Error('detalle');
        err.errorCode = current;
        throw err;
    });
    for (const [code, status, error] of cases) {
        current = code;
        const res = await runHandler(ctrl.approveReception, { params: { id: 'r1' } });
        assert.equal(res.status, status, code);
        assert.equal(res.body.error, error, code);
    }
    current = 'RECEPTION_QC_INCOMPLETE';
    assert.equal((await runHandler(ctrl.approveReception, { params: { id: 'r1' } })).body.message, 'detalle');
    current = 'SOMETHING_ELSE';
    await assert.rejects(() => runHandler(ctrl.approveReception, { params: { id: 'r1' } }), /detalle/);
});

// ---------- supplier returns ----------

test('getReturns returns empty list without loading items', async (t) => {
    const { calls } = installPool(t, [['FROM supplier_returns sr', [[]]]]);
    const res = await runHandler(ctrl.getReturns);
    assert.deepEqual(res.body, []);
    assert.equal(calls.length, 1);
});

test('getReturns filters and attaches items; getSupplierReturns is an alias', async (t) => {
    const { calls } = installPool(t, [
        ['FROM supplier_returns sr', [[{ id: 'a' }, { id: 'b' }]]],
        ['FROM supplier_return_items sri', [[{ return_id: 'a', id: 'i1' }]]]
    ]);
    const res = await runHandler(ctrl.getSupplierReturns, { query: { supplier_id: 's1', status: 'draft' } });
    assert.equal(ctrl.getSupplierReturns, ctrl.getReturns);
    assert.deepEqual(calls[0].params, ['s1', 'draft']);
    assert.deepEqual(res.body.map((r) => r.items.length), [1, 0]);
});

test('getReturns tolerates a missing table but propagates other errors', async (t) => {
    let failure = Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' });
    installPool(t, [['FROM supplier_returns sr', () => { throw failure; }]]);
    const res = await runHandler(ctrl.getReturns);
    assert.deepEqual(res.body, []);
    failure = Object.assign(new Error('other'), { code: 'ER_X' });
    await assert.rejects(() => runHandler(ctrl.getReturns), /other/);
});

test('createReturn inserts draft return with items and audits', async (t) => {
    const logs = installAudit(t);
    const { calls, lifecycle, connection } = installPool(t, [
        ['MAX(CAST', [[{ max_seq: 11 }]]],
        ['SELECT `last_value`', [[{ last_value: 3 }]]]
    ]);
    // A manager may type the credit cost (ADR-028); without one, the last invoiced (here none: 0).
    const res = await runHandler(ctrl.createReturn, {
        body: { supplier_id: 's1', notes: 'roto', items: [{ product_id: 'p1', quantity: 2, unit_cost: 10, reason: 'dañado' }, { product_id: 'p2', quantity: 1 }] },
        user: { id: 'u1', role: 'manager' }
    });
    assert.equal(res.body.return_number, `SR-${year}-0012`);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    const header = calls.find((c) => c.statement.startsWith('INSERT INTO supplier_returns'));
    assert.ok(header.statement.includes("'draft'"));
    assert.deepEqual(header.params.slice(1), [`SR-${year}-0012`, 's1', 'roto', null]);
    const rows = calls.filter((c) => c.statement.startsWith('INSERT INTO supplier_return_items'));
    assert.deepEqual(rows.map((c) => c.params.slice(2)), [['p1', 2, 10, 'dañado'], ['p2', 1, 0, null]]);
    assert.equal(logs[0].payload.action, 'CREATE_SUPPLIER_RETURN');
    assert.equal(logs[0].conn, connection);
});

test('createReturn takes the last invoiced cost; only purchasing may change it (ADR-028)', async (t) => {
    installAudit(t);
    const rules = () => [
        // The supplier's last invoice charged p1 at 12.50 net; p2 was never invoiced: its delivery note.
        ['FROM supplier_invoice_items sii JOIN supplier_invoices si', [[{ product_id: 'p1', unit_cost: '12.50' }, { product_id: 'p1', unit_cost: '9.00' }]]],
        ['FROM reception_items ri JOIN receptions r', [[{ product_id: 'p2', unit_cost: '7.00' }]]],
        ['MAX(CAST', [[{ max_seq: 1 }]]],
        ['SELECT `last_value`', [[{ last_value: 1 }]]],
    ];
    const items = (p1Cost) => [{ product_id: 'p1', quantity: 1, ...(p1Cost === undefined ? {} : { unit_cost: p1Cost }) }, { product_id: 'p2', quantity: 1 }];
    const savedCosts = (calls) => calls.filter((c) => c.statement.startsWith('INSERT INTO supplier_return_items')).map((c) => c.params[4]);

    let db = installPool(t, rules());
    await runHandler(ctrl.createReturn, { body: { supplier_id: 's1', items: items() }, user: { id: 'w', role: 'warehouse' } });
    assert.deepEqual(savedCosts(db.calls), [12.5, 7]);
    // The same cost typed is fine; another one, only for purchasing.
    db = installPool(t, rules());
    await runHandler(ctrl.createReturn, { body: { supplier_id: 's1', items: items(12.5) }, user: { id: 'w', role: 'warehouse' } });
    assert.deepEqual(savedCosts(db.calls), [12.5, 7]);
    db = installPool(t, rules());
    const refused = await runHandler(ctrl.createReturn, { body: { supplier_id: 's1', items: items(5) }, user: { id: 'w', role: 'warehouse' } });
    assert.deepEqual([refused.status, refused.body.error], [403, 'return_cost_not_allowed']);
    assert.match(refused.body.message, /\$12\.50/);
    assert.deepEqual(db.lifecycle, ['begin', 'rollback', 'release']);
    db = installPool(t, rules());
    await runHandler(ctrl.createReturn, { body: { supplier_id: 's1', items: items(5) }, user: { id: 'm', role: 'manager' } });
    assert.deepEqual(savedCosts(db.calls), [5, 7]);
});

test('getReturnSuggestedCosts answers per product, falling back to the product cost', async (t) => {
    installPool(t, [
        ['FROM supplier_invoice_items sii JOIN supplier_invoices si', [[]]],
        ['FROM reception_items ri JOIN receptions r', [[]]],
        ['FROM products WHERE id IN', [[{ id: 'p1', purchase_price: '0', cost_price: '4.5' }]]],
    ]);
    const res = await runHandler(ctrl.getReturnSuggestedCosts, { query: { supplier_id: 's1', product_ids: ['p1', 'p1'] } });
    assert.deepEqual(res.body, [{ product_id: 'p1', unit_cost: 4.5, source: 'product' }]);
});

test('createReturn against a delivery note checks it is this supplier\'s, approved, and brought the products (D7)', async (t) => {
    installAudit(t);
    const rules = (reception, lines) => [
        ['FROM receptions WHERE id = ?', [reception]],
        ['FROM reception_items WHERE reception_id = ?', [lines]],
        ['MAX(CAST', [[{ max_seq: 1 }]]],
        ['SELECT `last_value`', [[{ last_value: 1 }]]],
    ];
    const body = { supplier_id: 's1', reception_id: '11111111-1111-4111-8111-111111111111', items: [{ product_id: 'p1', quantity: 1 }] };
    const ok = installPool(t, rules([{ id: 'rec', supplier_id: 's1', status: 'approved' }], [{ product_id: 'p1' }]));
    await runHandler(ctrl.createReturn, { body });
    assert.equal(ok.calls.find((c) => c.statement.startsWith('INSERT INTO supplier_returns')).params[4], body.reception_id);

    installPool(t, rules([{ id: 'rec', supplier_id: 'other', status: 'approved' }], [{ product_id: 'p1' }]));
    const foreign = await runHandler(ctrl.createReturn, { body });
    assert.deepEqual([foreign.status, foreign.body.error], [400, 'invalid_reception']);
    installPool(t, rules([{ id: 'rec', supplier_id: 's1', status: 'approved' }], [{ product_id: 'p2' }]));
    const missing = await runHandler(ctrl.createReturn, { body });
    assert.deepEqual([missing.status, missing.body.error], [400, 'product_not_in_reception']);
});

test('createReturn without items or notes still creates the draft', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t);
    const res = await runHandler(ctrl.createReturn, { body: { supplier_id: 's1' } });
    assert.match(res.body.return_number, /-0001$/);
    assert.equal(calls.find((c) => c.statement.startsWith('INSERT INTO supplier_returns')).params[3], null);
    assert.deepEqual(logs[0].payload.new_values.items, []);
    assert.equal(logs[0].payload.user_id, null);
});

test('createReturn rolls back on failure', async (t) => {
    installAudit(t);
    const { lifecycle } = installPool(t, [['INSERT INTO supplier_return_items', () => { throw new Error('fk'); }]]);
    await assert.rejects(
        () => runHandler(ctrl.createReturn, { body: { supplier_id: 's1', items: [{ product_id: 'p', quantity: 1 }] } }),
        /fk/
    );
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
});

test('approveReturn returns service result and maps domain errors', async (t) => {
    let behaviour = async () => ({ success: true });
    const seen = [];
    stub(t, supplierReturnService, 'approveSupplierReturn', async (...a) => { seen.push(a); return behaviour(); });
    assert.deepEqual((await runHandler(ctrl.approveReturn, { params: { id: 'sr1' }, user: { id: 'u1' } })).body, { success: true });
    assert.equal(seen[0][0], 'sr1');
    assert.equal(seen[0][1], 'u1');

    behaviour = async () => { throw Object.assign(new Error('x'), { errorCode: 'RETURN_NOT_FOUND' }); };
    const nf = await runHandler(ctrl.approveReturn, { params: { id: 'sr1' } });
    assert.equal(nf.status, 404);
    behaviour = async () => { throw Object.assign(new Error('x'), { errorCode: 'RETURN_ALREADY_APPROVED' }); };
    const done = await runHandler(ctrl.approveReturn, { params: { id: 'sr1' } });
    assert.equal(done.status, 400);
    assert.equal(done.body.error, 'already_approved');
    behaviour = async () => { throw new Error('inesperado'); };
    await assert.rejects(() => runHandler(ctrl.approveReturn, { params: { id: 'sr1' } }), /inesperado/);
});

// ---------- supplier payments ----------

test('getSupplierPayments delegates with supplier filter', async (t) => {
    const seen = [];
    stub(t, supplierPaymentService, 'getSupplierPayments', async (id) => { seen.push(id); return [{ id: 'p' }]; });
    const res = await runHandler(ctrl.getSupplierPayments, { query: { supplier_id: 's1' } });
    assert.deepEqual(res.body, [{ id: 'p' }]);
    assert.deepEqual(seen, ['s1']);
});

test('createSupplierPayment returns result and maps validation errors to 400', async (t) => {
    let behaviour = async () => ({ total: 5 });
    stub(t, supplierPaymentService, 'createSupplierPayment', async () => behaviour());
    assert.deepEqual((await runHandler(ctrl.createSupplierPayment, { body: {}, user: { id: 'u' } })).body, { total: 5 });
    behaviour = async () => { throw Object.assign(new Error('falta proveedor'), { errorCode: 'MISSING_SUPPLIER' }); };
    const a = await runHandler(ctrl.createSupplierPayment);
    assert.equal(a.status, 400);
    assert.equal(a.body.error, 'missing_supplier');
    assert.equal(a.body.message, 'falta proveedor');
    behaviour = async () => { throw Object.assign(new Error('faltan pagos'), { errorCode: 'MISSING_PAYMENTS' }); };
    const b = await runHandler(ctrl.createSupplierPayment);
    assert.equal(b.body.error, 'missing_payments');
    behaviour = async () => { throw new Error('otro'); };
    await assert.rejects(() => runHandler(ctrl.createSupplierPayment), /otro/);
});

// ---------- quality check ----------

const qcBody = { reception_id: 'r1', product_id: 'p1', result: 'passed', quantity_checked: 10, quantity_passed: 8, quantity_failed: 2 };

function qcRules(overrides = {}) {
    return [
        ['FROM receptions WHERE id = ? FOR UPDATE', overrides.reception ?? [[{ id: 'r1', status: 'pending_qc' }]]],
        ['FROM reception_items', overrides.items ?? [[{ id: 'ri1', quantity_received: 10 }]]],
        ['SELECT * FROM quality_checks', overrides.existing ?? [[]]]
    ];
}

async function expectQcFailure(t, rules, body, status, message) {
    const logs = installAudit(t);
    const { lifecycle, calls } = installPool(t, rules);
    await assert.rejects(
        () => runHandler(ctrl.createQualityCheck, { body }),
        (e) => { assert.equal(e.statusCode, status); assert.match(e.message, message); return true; }
    );
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
    assert.ok(!calls.some((c) => /^(INSERT|UPDATE)/.test(c.statement)));
    assert.equal(logs.length, 0);
}

test('createQualityCheck rejects missing reception, non-pending reception and bad item counts', async (t) => {
    await expectQcFailure(t, qcRules({ reception: [[]] }), qcBody, 404, /no encontrada/);
    await expectQcFailure(t, qcRules({ reception: [[{ id: 'r1', status: 'approved' }]] }), qcBody, 409, /pendiente/);
    await expectQcFailure(t, qcRules({ items: [[]] }), qcBody, 409, /no pertenece/);
    await expectQcFailure(t, qcRules({ items: [[{ quantity_received: 5 }, { quantity_received: 5 }]] }), qcBody, 409, /repetido/);
});

test('createQualityCheck requires the check to cover exactly the received quantity', async (t) => {
    await expectQcFailure(t, qcRules(), { ...qcBody, quantity_checked: 9 }, 409, /exactamente/);
    await expectQcFailure(t, qcRules(), { ...qcBody, quantity_passed: 5, quantity_failed: 2 }, 409, /exactamente/);
    await expectQcFailure(t, qcRules({ items: [[{ id: 'ri1', quantity_received: null }]] }), qcBody, 409, /exactamente/);
});

test('createQualityCheck inserts a new check using the authenticated inspector', async (t) => {
    const logs = installAudit(t);
    const { calls, lifecycle, connection } = installPool(t, qcRules());
    const res = await runHandler(ctrl.createQualityCheck, { body: { ...qcBody, inspector_id: 'spoof', defect_description: 'rayado', action_taken: 'return', notes: 'n' }, user: { id: 'insp' } });
    assert.equal(res.body.success, true);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    const insert = calls.find((c) => c.statement.startsWith('INSERT INTO quality_checks'));
    assert.equal(insert.params[0], res.body.id);
    assert.deepEqual(insert.params.slice(1), ['r1', 'p1', 'insp', 'passed', 10, 8, 2, 'rayado', 'return', 'n']);
    assert.equal(logs[0].payload.action, 'CREATE_QUALITY_CHECK');
    assert.equal(logs[0].payload.old_values, null);
    assert.equal(logs[0].conn, connection);
});

test('createQualityCheck inserts with defaults when optional fields are absent', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t, qcRules());
    await runHandler(ctrl.createQualityCheck, { body: qcBody });
    const insert = calls.find((c) => c.statement.startsWith('INSERT INTO quality_checks'));
    assert.deepEqual([insert.params[3], insert.params[8], insert.params[9], insert.params[10]], [null, null, 'approve', null]);
    assert.equal(logs[0].payload.user_id, null);
});

test('createQualityCheck updates the existing check instead of creating a duplicate', async (t) => {
    const logs = installAudit(t);
    const { calls } = installPool(t, qcRules({ existing: [[{ id: 'qc-old', result: 'failed' }]] }));
    const res = await runHandler(ctrl.createQualityCheck, { body: qcBody, user: { id: 'insp' } });
    assert.equal(res.body.id, 'qc-old');
    assert.ok(!calls.some((c) => c.statement.startsWith('INSERT INTO quality_checks')));
    const update = calls.find((c) => c.statement.startsWith('UPDATE quality_checks'));
    assert.equal(update.params.at(-1), 'qc-old');
    assert.equal(update.params[0], 'insp');
    assert.equal(logs[0].payload.action, 'UPDATE_QUALITY_CHECK');
    assert.deepEqual(logs[0].payload.old_values, { id: 'qc-old', result: 'failed' });
});

// ---------- IVA compras export ----------

test('exportIVACompras merges invoices and returns (negative) sorted by date desc', async (t) => {
    installPool(t, [
        ['FROM supplier_invoices si', [[
            { invoice_number: 'F1', invoice_type: 'A', issue_date: '2026-01-10', supplier_name: 'S1', supplier_tax_id: '30', net_amount: '100', vat_amount: '21', other_taxes: '4', total_amount: '125' },
            { invoice_number: 'F2', invoice_type: 'B', issue_date: '2026-03-10', supplier_name: 'S2', supplier_tax_id: null, net_amount: '10', vat_amount: '2', other_taxes: null, total_amount: null }
        ]]],
        ['FROM supplier_returns sr', [[
            { return_number: 'SR1', created_at: '2026-02-10', supplier_name: 'S1', supplier_tax_id: null, subtotal: '100' },
            { return_number: 'SR2', created_at: '2026-02-11', supplier_name: 'S3', supplier_tax_id: '33', subtotal: null }
        ]]],
        ['company_settings', [[{ tax_rate: '0.10' }]]]
    ]);
    const res = await runHandler(ctrl.exportIVACompras);
    assert.deepEqual(res.body.map((r) => r.number), ['F2', 'SR2', 'SR1', 'F1']);
    const [f2, sr2, sr1, f1] = res.body;
    assert.equal(f1.type, 'Factura A');
    assert.deepEqual([f1.subtotal, f1.iva, f1.total, f1.tax_id], [100, 21, 125, '30']);
    // total falls back to net + iva + taxes
    assert.deepEqual([f2.total, f2.tax_id], [12, '-']);
    assert.equal(sr1.type, 'Devolución (Egreso/Ajuste)');
    assert.ok(Math.abs(sr1.subtotal + 100) < 1e-9);
    assert.ok(Math.abs(sr1.iva + 10) < 1e-9);
    assert.ok(Math.abs(sr1.total + 110) < 1e-9);
    assert.equal(sr1.tax_id, '-');
    assert.equal(sr2.total, -0);
    assert.equal(sr2.tax_id, '33');
});

test('exportIVACompras falls back to 21% when company settings are missing', async (t) => {
    installPool(t, [
        ['FROM supplier_returns sr', [[{ return_number: 'SR1', created_at: '2026-02-10', supplier_name: 'S', subtotal: 100 }]]]
    ]);
    const res = await runHandler(ctrl.exportIVACompras);
    assert.ok(Math.abs(res.body[0].iva + 21) < 1e-9);
});
