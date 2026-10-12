import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import { returnsService } from '../services/warranties.service.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });

test.after(async () => {
    await closePool();
});

async function posCounterSale(productId, quantity) {
    return createOrder.execute({
        external_source: 'pos',
        external_id: crypto.randomUUID(),
        items: [{ product_id: productId, quantity }],
    }, null);
}

test('createReturn prices a return from what the order was actually sold at, not the client-sent unit_price', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 10 }] });
    const order = await posCounterSale(productId, 2);

    const created = await returnsService.createReturn({
        order_id: order.id,
        customer_name: 'Cliente QA',
        reason: 'Talle incorrecto',
        // The client tries to send a bogus unit_price (1): the service must ignore it
        // and use the price the order was actually sold at (100, net, per ADR-008).
        items: [{ product_id: productId, quantity: 1, unit_price: 1 }],
    });

    const [[item]] = await pool.query(
        'SELECT unit_price FROM client_return_items WHERE return_id = ?',
        [created.id]
    );
    assert.equal(Number(item.unit_price), 100, 'stored unit_price must come from order_items, not the client');
});

test('createReturn rejects a second return once the sold quantity for the order has been exhausted', async () => {
    const productId = await seedProduct({ salePrice: 50, stock: [{ location: 'QA-A', quantity: 10 }] });
    const order = await posCounterSale(productId, 2);

    // First return takes 1 of the 2 sold units.
    await returnsService.createReturn({
        order_id: order.id,
        customer_name: 'Cliente QA',
        reason: 'Cambio de talle',
        items: [{ product_id: productId, quantity: 1 }],
    });

    // A second return requesting 2 more units exceeds what remains (1).
    await assert.rejects(
        () => returnsService.createReturn({
            order_id: order.id,
            customer_name: 'Cliente QA',
            reason: 'Cambio de talle',
            items: [{ product_id: productId, quantity: 2 }],
        }),
        (err) => err.errorCode === 'RETURN_EXCEEDS_SOLD' && err.statusCode === 409
    );
});

test('approving a return refunds gross (net + VAT) and creates a credit note for the full amount', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 10 }] });
    const order = await posCounterSale(productId, 2);

    const created = await returnsService.createReturn({
        order_id: order.id,
        customer_name: 'Cliente QA',
        reason: 'Producto defectuoso',
        items: [{ product_id: productId, quantity: 1, unit_price: 1 }],
    });

    const approved = await returnsService.approveReturn(created.id, null);
    assert.equal(approved.success, true);
    // net 100 + 21% VAT = 121.00 gross refund.
    assert.equal(approved.total_amount, 121);

    const [[creditNote]] = await pool.query(
        'SELECT amount, status FROM credit_notes WHERE reference_id = ?',
        [created.id]
    );
    assert.equal(Number(creditNote.amount), 121);
    assert.equal(creditNote.status, 'issued');

    const [[returnRow]] = await pool.query(
        'SELECT status, total_amount FROM client_returns WHERE id = ?',
        [created.id]
    );
    assert.equal(returnRow.status, 'approved');
    assert.equal(Number(returnRow.total_amount), 121);
});
