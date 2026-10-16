import test from 'node:test';
import assert from 'node:assert/strict';

import { PurchaseOrderService, canTransitionPurchaseOrder, PURCHASE_ORDER_STATUSES } from '../domains/procurement/PurchaseOrderService.js';
import { GoodsReceptionService } from '../domains/procurement/GoodsReceptionService.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('purchase order status only moves forward (ADR-012)', () => {
    const allowed = [];
    for (const from of PURCHASE_ORDER_STATUSES) {
        for (const to of PURCHASE_ORDER_STATUSES) {
            if (canTransitionPurchaseOrder(from, to)) allowed.push(`${from}->${to}`);
        }
    }
    assert.deepEqual(allowed.sort(), [
        'draft->cancelled', 'draft->sent',
        'partial->received',
        'sent->cancelled', 'sent->partial', 'sent->received',
    ]);
});

function trackedPool(t, currentStatus, blockers = { pending_receptions: 0, received_qty: 0 }) {
    const calls = [];
    const lifecycle = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql).trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT id, status FROM purchase_orders')) return [currentStatus ? [{ id: 'po-1', status: currentStatus }] : []];
        if (statement.startsWith('SELECT * FROM purchase_orders')) return [[{ id: 'po-1', status: currentStatus }]];
        if (statement.includes('AS pending_receptions')) return [[blockers]];
        return [{ affectedRows: 1 }];
    });
    connection.commit = async () => { lifecycle.push('commit'); };
    connection.rollback = async () => { lifecycle.push('rollback'); };
    connection.release = () => { lifecycle.push('release'); };
    return { calls, lifecycle };
}

test('a closed purchase order cannot be reopened: 409, nothing written, rolled back', async (t) => {
    for (const closed of ['received', 'cancelled']) {
        const { calls, lifecycle } = trackedPool(t, closed);
        const audits = [];
        const originalLog = auditService.log;
        auditService.log = async (entry) => { audits.push(entry); };
        t.after(() => { auditService.log = originalLog; });

        await assert.rejects(
            () => new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'draft', 'u-1'),
            (err) => err.statusCode === 409 && err.responseBody.error === 'invalid_transition'
        );
        assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE purchase_orders')), false);
        assert.equal(audits.length, 0);
        assert.deepEqual(lifecycle, ['rollback', 'release']);
    }
});

test('a forward transition locks the row, updates and audits inside the transaction', async (t) => {
    const { calls, lifecycle } = trackedPool(t, 'draft');
    let auditExecutor;
    const originalLog = auditService.log;
    auditService.log = async (_entry, executor) => { auditExecutor = executor; };
    t.after(() => { auditService.log = originalLog; });

    await new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'sent', 'u-1', '10.0.0.1');

    assert.match(calls[0].statement, /FOR UPDATE$/);
    assert.ok(calls.some(({ statement, params }) => statement.startsWith('UPDATE purchase_orders') && params[0] === 'sent'));
    assert.ok(auditExecutor, 'audit runs on the transaction connection');
    assert.deepEqual(lifecycle, ['commit', 'release']);
});

test('setting the same status writes and audits nothing', async (t) => {
    const { calls, lifecycle } = trackedPool(t, 'received');
    const audits = [];
    const originalLog = auditService.log;
    auditService.log = async (entry) => { audits.push(entry); };
    t.after(() => { auditService.log = originalLog; });

    const row = await new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'received', 'u-1');

    assert.equal(row.status, 'received');
    assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE')), false);
    assert.equal(audits.length, 0);
    assert.deepEqual(lifecycle, ['commit', 'release']);
});

test('an order with arrived goods cannot be cancelled', async (t) => {
    for (const blockers of [{ pending_receptions: 1, received_qty: 0 }, { pending_receptions: 0, received_qty: '3' }]) {
        const { calls, lifecycle } = trackedPool(t, 'sent', blockers);
        await assert.rejects(
            () => new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'cancelled', 'u-1'),
            (err) => err.statusCode === 409 && err.responseBody.error === 'purchase_order_has_receptions'
        );
        assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE')), false);
        assert.deepEqual(lifecycle, ['rollback', 'release']);
    }
});

test('a partial or received order says why it cannot be cancelled (the goods), not just "invalid transition"', async (t) => {
    for (const current of ['partial', 'received']) {
        const { calls } = trackedPool(t, current, { pending_receptions: 0, received_qty: '4' });
        await assert.rejects(
            () => new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'cancelled', 'u-1'),
            (err) => err.statusCode === 409 && err.responseBody.error === 'purchase_order_has_receptions'
        );
        assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE')), false);
    }
    // Closed by hand with nothing received: still a forbidden transition.
    trackedPool(t, 'received');
    await assert.rejects(
        () => new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'cancelled', 'u-1'),
        (err) => err.responseBody.error === 'invalid_transition'
    );
});

test('an order with nothing received can be cancelled', async (t) => {
    const { calls, lifecycle } = trackedPool(t, 'sent');
    const originalLog = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalLog; });

    await new PurchaseOrderService().updatePurchaseOrderStatus('po-1', 'cancelled', 'u-1');

    assert.ok(calls.some(({ statement, params }) => statement.startsWith('UPDATE purchase_orders') && params[0] === 'cancelled'));
    assert.deepEqual(lifecycle, ['commit', 'release']);
});

function receptionApprovalPool(t, orderStatus) {
    const calls = [];
    const lifecycle = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT * FROM receptions')) return [[{ id: 'r-1', status: 'pending_qc', purchase_order_id: 'po-1', supplier_id: 's-1' }]];
        if (statement.startsWith('SELECT id, status FROM purchase_orders')) return [[{ id: 'po-1', status: orderStatus }]];
        if (statement.startsWith('SELECT * FROM reception_items')) return [[{ id: 'ri-1', product_id: 'p-1', po_item_id: 'poi-1', quantity_received: 2 }]];
        if (statement.includes('FROM quality_checks')) return [[{ quantity_checked: 2, quantity_passed: 2, quantity_failed: 0 }]];
        if (statement.startsWith('SELECT id FROM inventory')) return [[{ id: 'inv-1' }]];
        if (statement.startsWith('SELECT quantity_ordered, quantity_received FROM purchase_order_items')) return [[{ quantity_ordered: 10, quantity_received: 0 }]];
        if (statement.includes('AS ordered_qty')) return [[{ ordered_qty: 10, received_qty: 2 }]];
        return [{ affectedRows: 1 }];
    });
    connection.commit = async () => { lifecycle.push('commit'); };
    connection.rollback = async () => { lifecycle.push('rollback'); };
    connection.release = () => { lifecycle.push('release'); };
    const originalLog = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalLog; });
    return { calls, lifecycle };
}

test('reception approval locks the order before its items and refuses a cancelled order', async (t) => {
    const { calls, lifecycle } = receptionApprovalPool(t, 'cancelled');
    await assert.rejects(
        () => new GoodsReceptionService().processReceptionApproval('r-1'),
        (err) => err.statusCode === 409 && err.errorCode === 'RECEPTION_PURCHASE_ORDER_CANCELLED'
    );
    assert.match(calls[1].statement, /^SELECT id, status FROM purchase_orders WHERE id = \? FOR UPDATE$/);
    assert.equal(calls.some(({ statement }) => /^(INSERT|UPDATE)/.test(statement)), false);
    assert.deepEqual(lifecycle, ['rollback', 'release']);
});

test('reception approval never moves an order back from received', async (t) => {
    const { calls } = receptionApprovalPool(t, 'received');
    await new GoodsReceptionService().processReceptionApproval('r-1');
    assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE purchase_orders')), false);
});

test('reception approval advances a sent order to partial', async (t) => {
    const { calls } = receptionApprovalPool(t, 'sent');
    await new GoodsReceptionService().processReceptionApproval('r-1');
    const update = calls.find(({ statement }) => statement.startsWith('UPDATE purchase_orders'));
    assert.deepEqual(update.params, ['partial', 'po-1']);
});
