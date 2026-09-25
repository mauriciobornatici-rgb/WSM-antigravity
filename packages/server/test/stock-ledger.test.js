import test from 'node:test';
import assert from 'node:assert/strict';

import { StockLedger, NON_SELLABLE_LOCATIONS } from '../domains/inventory/StockLedger.js';

function recordingConnection(respond = () => [[]]) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            calls.push({ sql: String(sql), params });
            return respond(String(sql), params);
        },
    };
}

test('lockSellableRows locks sorted unique products and excludes non-sellable locations', async () => {
    const ledger = new StockLedger();
    const connection = recordingConnection(() => [[
        { id: 'r1', product_id: 'b', quantity: 2, reserved_quantity: 0 },
        { id: 'r2', product_id: 'b', quantity: 9, reserved_quantity: 1 },
        { id: 'r3', product_id: 'unknown', quantity: 1, reserved_quantity: 0 },
    ]]);

    const rows = await ledger.lockSellableRows(connection, ['b', 'a', 'b']);

    assert.deepEqual(connection.calls[0].params, [['a', 'b'], NON_SELLABLE_LOCATIONS]);
    assert.match(connection.calls[0].sql, /ORDER BY product_id, id\s+FOR UPDATE/);
    assert.deepEqual(rows.get('a'), []);
    assert.deepEqual(rows.get('b').map((row) => row.id), ['r2', 'r1'], 'most available row first');
    assert.equal(rows.has('unknown'), false);
});

test('lockSellableRows skips the query for an empty cart', async () => {
    const connection = recordingConnection();
    const rows = await new StockLedger().lockSellableRows(connection, []);
    assert.equal(rows.size, 0);
    assert.equal(connection.calls.length, 0);
});

test('consumeAvailable rejects invalid quantities and insufficient unreserved stock', async () => {
    const ledger = new StockLedger();
    const connection = recordingConnection();
    await assert.rejects(
        () => ledger.consumeAvailable(connection, [], { productId: 'p', quantity: 0 }),
        (err) => err.errorCode === 'INVALID_QUANTITY' && err.statusCode === 400
    );
    // 3 on hand but 2 reserved for other orders: only 1 is sellable.
    const rows = [{ id: 'r', quantity: 3, reserved_quantity: 2 }];
    await assert.rejects(
        () => ledger.consumeAvailable(connection, rows, { productId: 'p', productName: 'Pelota', quantity: 2 }),
        (err) => err.errorCode === 'INSUFFICIENT_STOCK' && err.statusCode === 409 && /Disponible: 1/.test(err.message)
    );
    assert.equal(connection.calls.length, 0, 'nothing is written when stock is insufficient');
});

test('consumeAvailable never clamps: a row changed under the lock aborts the sale', async () => {
    const ledger = new StockLedger();
    const connection = recordingConnection((sql) => (sql.includes('UPDATE inventory') ? [{ affectedRows: 0 }] : [[]]));
    await assert.rejects(
        () => ledger.consumeAvailable(connection, [{ id: 'r', quantity: 5, reserved_quantity: 0 }], {
            productId: 'p', quantity: 2, orderId: 'o',
        }),
        (err) => err.errorCode === 'INSUFFICIENT_STOCK'
    );
    assert.equal(connection.calls.some((call) => call.sql.includes('inventory_movements')), false);
});

test('consumeAvailable spreads across rows, updates them in place and traces every row', async () => {
    const ledger = new StockLedger();
    const connection = recordingConnection((sql) => (sql.includes('UPDATE inventory') ? [{ affectedRows: 1 }] : [[]]));
    const rows = [
        { id: 'r1', location: null, quantity: 2, reserved_quantity: 0 },
        { id: 'r2', location: 'B-2', quantity: 5, reserved_quantity: 5 },
        { id: 'r3', location: 'C-3', quantity: 4, reserved_quantity: 0 },
    ];

    await ledger.consumeAvailable(connection, rows, {
        productId: 'p', productName: 'Pelota', quantity: 3, orderId: 'o-1', userId: 'u-1', reason: 'Venta',
    });

    const updates = connection.calls.filter((call) => call.sql.includes('UPDATE inventory'));
    assert.deepEqual(updates.map((call) => call.params), [[2, 'r1', 2], [1, 'r3', 1]]);
    assert.match(updates[0].sql, /WHERE id = \? AND quantity - reserved_quantity >= \?/);
    const movements = connection.calls.filter((call) => call.sql.includes('inventory_movements'));
    assert.deepEqual(movements.map((call) => [call.params[1], call.params[2], call.params[3], call.params[4], call.params[5], call.params[6]]), [
        ['p', 'General', 2, 'Venta', 'o-1', 'u-1'],
        ['p', 'C-3', 1, 'Venta', 'o-1', 'u-1'],
    ]);
    assert.deepEqual(rows.map((row) => row.quantity), [0, 5, 3]);

    // A second line of the same product sees the stock left by the first one.
    await assert.rejects(
        () => ledger.consumeAvailable(connection, rows, { productId: 'p', quantity: 4, orderId: 'o-1' }),
        (err) => /Disponible: 3/.test(err.message)
    );
});
