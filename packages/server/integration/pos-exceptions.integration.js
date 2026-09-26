import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, stockOf } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import { EXCEPTION_TYPES, PosExceptionsService } from '../domains/sales/PosExceptionsService.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });
const exceptions = new PosExceptionsService();

test.after(async () => {
    await closePool();
});

function offlineSale(productId, { unitPrice = 100, quantity = 1 } = {}) {
    return createOrder.execute({
        external_source: 'pos',
        external_id: crypto.randomUUID(),
        offline_captured_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        items: [{ product_id: productId, quantity, unit_price: unitPrice }],
    }, null, { role: 'cashier' });
}

test('an offline sale at a non-catalog price is recorded and waits for a manager review', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await offlineSale(productId, { unitPrice: 80 });

    const pending = (await exceptions.list({ status: 'pending' })).filter((item) => item.order_id === order.id);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].type, EXCEPTION_TYPES.PRICE);
    assert.deepEqual(pending[0].details.lines, [{ product_id: productId, catalog_price: 100, unit_price: 80 }]);

    await exceptions.review(pending[0].id, { decision: 'approved', notes: 'precio de liquidación' }, null);

    assert.equal((await exceptions.list({ status: 'pending' })).some((item) => item.order_id === order.id), false);
    const reviewed = (await exceptions.list({ status: 'reviewed' })).find((item) => item.order_id === order.id);
    assert.equal(reviewed.review.decision, 'approved');
    await assert.rejects(
        () => exceptions.review(pending[0].id, { decision: 'rejected' }, null),
        (err) => err.errorCode === 'POS_EXCEPTION_ALREADY_REVIEWED' && err.statusCode === 409
    );
});

test('an offline sale at the catalog price creates no exception', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await offlineSale(productId, { unitPrice: 100 });
    assert.equal((await exceptions.list({ status: 'pending' })).some((item) => item.order_id === order.id), false);
    assert.deepEqual(await stockOf(productId), { quantity: 4, reserved: 0 });
});

test('reviewing something that is not an exception is rejected', async () => {
    const [[row]] = await pool.query("SELECT id FROM audit_logs WHERE action <> 'ORDER_PRICE_OVERRIDE' ORDER BY id LIMIT 1");
    await assert.rejects(
        () => exceptions.review(row.id, { decision: 'approved' }, null),
        (err) => err.errorCode === 'POS_EXCEPTION_NOT_FOUND' && err.statusCode === 404
    );
});
