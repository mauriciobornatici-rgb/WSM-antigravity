import test from 'node:test';
import assert from 'node:assert/strict';

import salesService from '../services/sales.service.js';

test('_decreaseInventoryForOrder throws 409 when total stock is insufficient', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('SELECT id, location, quantity')) {
                return [[
                    { id: 'inv-1', location: 'A-01', quantity: 1 },
                    { id: 'inv-2', location: 'A-02', quantity: 2 }
                ]];
            }
            throw new Error(`Unexpected SQL in insufficient-stock test: ${statement}`);
        }
    };

    await assert.rejects(
        () => salesService._decreaseInventoryForOrder(connection, {
            orderId: 'order-1',
            productId: 'prod-1',
            productName: 'Botin Pro',
            quantity: 5
        }),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'INSUFFICIENT_STOCK');
            return true;
        }
    );

    assert.equal(calls.length, 1);
});

test('_decreaseInventoryForOrder consumes inventory across locations and records movements', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });

            if (statement.includes('SELECT id, location, quantity')) {
                return [[
                    { id: 'inv-1', location: 'A-01', quantity: 3 },
                    { id: 'inv-2', location: 'A-02', quantity: 2 }
                ]];
            }
            if (statement.startsWith('UPDATE inventory SET quantity = quantity - ? WHERE id = ?')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO inventory_movements')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in stock-consumption test: ${statement}`);
        }
    };

    await salesService._decreaseInventoryForOrder(connection, {
        orderId: 'order-1',
        productId: 'prod-1',
        productName: 'Botin Pro',
        quantity: 4
    });

    const updateCalls = calls.filter((entry) =>
        entry.sql.startsWith('UPDATE inventory SET quantity = quantity - ? WHERE id = ?')
    );
    const movementCalls = calls.filter((entry) => entry.sql.includes('INSERT INTO inventory_movements'));

    assert.equal(updateCalls.length, 2);
    assert.deepEqual(updateCalls[0].params, [3, 'inv-1']);
    assert.deepEqual(updateCalls[1].params, [1, 'inv-2']);

    assert.equal(movementCalls.length, 2);
    assert.equal(movementCalls[0].params[1], 'prod-1');
    assert.equal(movementCalls[0].params[2], 'A-01');
    assert.equal(movementCalls[0].params[3], 3);
    assert.equal(movementCalls[0].params[5], 'Order stock deduction');

    assert.equal(movementCalls[1].params[1], 'prod-1');
    assert.equal(movementCalls[1].params[2], 'A-02');
    assert.equal(movementCalls[1].params[3], 1);
    assert.equal(movementCalls[1].params[5], 'Order stock deduction');
});
