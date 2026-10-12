import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, saleMovementsOf, seedProduct, stockOf } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';

const useCase = new CreateOrderUseCase({ onStockChanged: async () => {} });

function counterSale(items, key = crypto.randomUUID()) {
    return useCase.execute({ external_source: 'pos', external_id: key, items }, null);
}

test.after(async () => {
    await closePool();
});

test('a counter sale deducts physical stock, leaves reservations alone and traces a sale movement', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });

    const order = await counterSale([{ product_id: productId, quantity: 2 }]);

    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.deepEqual(await saleMovementsOf(productId), [{ reference_id: order.id, from_location: 'QA-A', quantity: 2 }]);
    const [[row]] = await pool.query('SELECT status FROM orders WHERE id = ?', [order.id]);
    assert.equal(row.status, 'completed');
    const [allocations] = await pool.query('SELECT id FROM order_item_allocations WHERE order_id = ?', [order.id]);
    assert.equal(allocations.length, 0);
});

test('replaying the same idempotency key does not deduct stock twice', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 4 }] });
    const key = crypto.randomUUID();

    const first = await counterSale([{ product_id: productId, quantity: 1 }], key);
    const replay = await counterSale([{ product_id: productId, quantity: 1 }], key);

    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotent_replay, true);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.equal((await saleMovementsOf(productId)).length, 1);
});

test('stock reserved for other orders is not sold at the counter', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 3, reserved: 2 }] });

    await assert.rejects(
        () => counterSale([{ product_id: productId, quantity: 2 }]),
        (err) => err.errorCode === 'INSUFFICIENT_STOCK' && err.statusCode === 409
    );
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 2 }, 'a rejected sale leaves no trace');

    await counterSale([{ product_id: productId, quantity: 1 }]);
    assert.deepEqual(await stockOf(productId), { quantity: 2, reserved: 2 });
});

test('concurrent counter sales never oversell: 10 buyers for 5 units', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 3 }, { location: 'QA-B', quantity: 2 }] });

    const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => counterSale([{ product_id: productId, quantity: 1 }]))
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 5);
    assert.ok(rejected.every((result) => result.reason.errorCode === 'INSUFFICIENT_STOCK'), rejected.map((r) => r.reason.message).join('; '));
    assert.deepEqual(await stockOf(productId), { quantity: 0, reserved: 0 });
    const movements = await saleMovementsOf(productId);
    assert.equal(movements.reduce((sum, movement) => sum + movement.quantity, 0), 5);
});

test('carts with the same products in opposite order do not deadlock', async () => {
    const productA = await seedProduct({ stock: [{ location: 'QA-A', quantity: 50 }] });
    const productB = await seedProduct({ stock: [{ location: 'QA-A', quantity: 50 }] });

    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => counterSale(
        index % 2 === 0
            ? [{ product_id: productA, quantity: 1 }, { product_id: productB, quantity: 1 }]
            : [{ product_id: productB, quantity: 1 }, { product_id: productA, quantity: 1 }]
    )));

    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason.code || result.reason.message);
    assert.deepEqual(failures, []);
    assert.deepEqual(await stockOf(productA), { quantity: 38, reserved: 0 });
    assert.deepEqual(await stockOf(productB), { quantity: 38, reserved: 0 });
});
