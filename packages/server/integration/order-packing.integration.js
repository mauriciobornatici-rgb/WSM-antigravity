import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, saleMovementsOf, seedProduct, stockOf } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import salesService from '../services/sales.service.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });

test.after(async () => {
    await closePool();
});

async function deliveryOrder(productId, quantity) {
    // A back-office delivery order reserves stock until it is packed.
    const order = await createOrder.execute({
        shipping_method: 'delivery',
        customer_name: 'Cliente QA',
        items: [{ product_id: productId, quantity }],
    }, null);
    await pool.query('UPDATE order_items SET picked_quantity = quantity WHERE order_id = ?', [order.id]);
    await pool.query("UPDATE order_item_allocations SET picked_quantity = reserved_quantity WHERE order_id = ?", [order.id]);
    await salesService.transitionOrderStatus(order.id, 'picking', null);
    return order.id;
}

test('packing a reserved order deducts the picked units and releases exactly its reservation', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 6 }] });
    const orderId = await deliveryOrder(productId, 2);
    assert.deepEqual(await stockOf(productId), { quantity: 6, reserved: 2 });

    await salesService.transitionOrderStatus(orderId, 'packed', null);

    assert.deepEqual(await stockOf(productId), { quantity: 4, reserved: 0 });
    assert.deepEqual((await saleMovementsOf(productId)).map((movement) => movement.quantity), [2]);
});

test('packing fails with 409 and changes nothing when the stock row no longer holds the reservation', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const orderId = await deliveryOrder(productId, 2);
    // Simulates the drift the old clamps used to hide.
    await pool.query('UPDATE inventory SET reserved_quantity = 0 WHERE product_id = ?', [productId]);

    await assert.rejects(
        () => salesService.transitionOrderStatus(orderId, 'packed', null),
        (err) => err.errorCode === 'STOCK_INVARIANT_VIOLATION' && err.statusCode === 409
    );
    assert.deepEqual(await stockOf(productId), { quantity: 5, reserved: 0 });
    const [[order]] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
    assert.equal(order.status, 'picking');
});

test('paying an invoice does not close an order that has not been delivered', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 3 }] });
    const order = await createOrder.execute({
        shipping_method: 'delivery',
        external_source: 'qa',
        external_id: crypto.randomUUID(),
        payment_status: 'paid',
        items: [{ product_id: productId, quantity: 1 }],
    }, null);

    await salesService.createInvoice(order.id, {
        invoice_type: 'B', point_of_sale: 99, payment_method: 'cash',
        payments: [{ method: 'cash', amount: 121 }],
    }, null);

    const [[row]] = await pool.query('SELECT status, payment_status, invoice_id FROM orders WHERE id = ?', [order.id]);
    assert.equal(row.payment_status, 'paid');
    assert.equal(row.status, 'pending', 'still has to go through picking and packing');
    assert.ok(row.invoice_id);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 1 });
});
