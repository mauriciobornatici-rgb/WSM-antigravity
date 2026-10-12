import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, stockOf } from './helpers/qaDb.js';
import purchaseOrderService from '../domains/procurement/PurchaseOrderService.js';
import receptionService from '../domains/procurement/ReceptionService.js';
import qualityCheckService from '../domains/procurement/QualityCheckService.js';
import goodsReceptionService from '../domains/procurement/GoodsReceptionService.js';

test.after(async () => {
    await closePool();
});

// A sent order for 10 units with a reception of 4 waiting for (and already through) QC.
async function seedOrderWithPendingReception() {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const productId = await seedProduct({ name: 'Producto OC QA' });

    const order = await purchaseOrderService.createPurchaseOrder({
        supplier_id: supplierId,
        items: [{ product_id: productId, quantity_ordered: 10, unit_cost: 100 }],
    }, null);
    await purchaseOrderService.updatePurchaseOrderStatus(order.id, 'sent', null);
    const [[poItem]] = await pool.query('SELECT id FROM purchase_order_items WHERE purchase_order_id = ?', [order.id]);

    const reception = await receptionService.createReception({
        purchase_order_id: order.id,
        items: [{ po_item_id: poItem.id, product_id: productId, quantity_received: 4 }],
    }, null);
    await qualityCheckService.createQualityCheck({
        reception_id: reception.id,
        product_id: productId,
        result: 'passed',
        quantity_checked: 4,
        quantity_passed: 4,
        quantity_failed: 0,
    }, null);

    return { orderId: order.id, receptionId: reception.id, productId };
}

async function orderStatus(orderId) {
    const [[row]] = await pool.query('SELECT status FROM purchase_orders WHERE id = ?', [orderId]);
    return row.status;
}

test('an order with goods in quality control cannot be cancelled (ADR-012)', async () => {
    const { orderId } = await seedOrderWithPendingReception();

    await assert.rejects(
        () => purchaseOrderService.updatePurchaseOrderStatus(orderId, 'cancelled', null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'purchase_order_has_receptions'
    );
    assert.equal(await orderStatus(orderId), 'sent');
});

test('approving a reception never reopens an order closed by hand as received', async () => {
    const { orderId, receptionId, productId } = await seedOrderWithPendingReception();
    await purchaseOrderService.updatePurchaseOrderStatus(orderId, 'received', null);

    await goodsReceptionService.processReceptionApproval(receptionId);

    assert.equal(await orderStatus(orderId), 'received');
    assert.equal((await stockOf(productId)).quantity, 4);
});

test('a reception cannot bring stock in against a cancelled order', async () => {
    const { orderId, receptionId, productId } = await seedOrderWithPendingReception();
    // Legacy state from before the guard: cancelled while a reception was pending.
    await pool.query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [orderId]);

    await assert.rejects(
        () => goodsReceptionService.processReceptionApproval(receptionId),
        (err) => err.statusCode === 409 && err.errorCode === 'RECEPTION_PURCHASE_ORDER_CANCELLED'
    );
    assert.equal(await orderStatus(orderId), 'cancelled');
    assert.equal((await stockOf(productId)).quantity, 0);
    const [[reception]] = await pool.query('SELECT status FROM receptions WHERE id = ?', [receptionId]);
    assert.equal(reception.status, 'pending_qc');
});

test('cancel racing an approval: the goods win and the order is never cancelled', async () => {
    const { orderId, receptionId, productId } = await seedOrderWithPendingReception();

    const [approval, cancellation] = await Promise.allSettled([
        goodsReceptionService.processReceptionApproval(receptionId),
        purchaseOrderService.updatePurchaseOrderStatus(orderId, 'cancelled', null),
    ]);

    assert.equal(approval.status, 'fulfilled');
    assert.equal(cancellation.status, 'rejected');
    assert.equal(cancellation.reason.responseBody?.error, 'purchase_order_has_receptions');
    assert.equal(await orderStatus(orderId), 'partial');
    assert.equal((await stockOf(productId)).quantity, 4);
});
