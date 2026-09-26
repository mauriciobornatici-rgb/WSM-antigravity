import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import salesService from '../services/sales.service.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';

test('CreateOrderUseCase persists order_item_allocations for each reserved inventory row', async () => {
    const useCase = new CreateOrderUseCase();
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('FROM inventory') && statement.includes('FOR UPDATE')) {
                return [[
                    { id: 'inv-loc-1', location: 'Estante-A1', quantity: 10, reserved_quantity: 2, available_quantity: 8 },
                    { id: 'inv-loc-2', location: 'Estante-B2', quantity: 5, reserved_quantity: 0, available_quantity: 5 }
                ]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    await useCase._decreaseInventoryForOrder(connection, {
        orderId: 'order-test-1',
        orderItemId: 'item-test-1',
        productId: 'prod-test-1',
        productName: 'Pelota Futbol Pro',
        quantity: 10
    });

    // 8 consumed from inv-loc-1, 2 consumed from inv-loc-2
    const updateCalls = calls.filter((c) => c.sql.startsWith('UPDATE inventory SET reserved_quantity'));
    assert.equal(updateCalls.length, 2);
    assert.deepEqual(updateCalls[0].params, [8, 'inv-loc-1']);
    assert.deepEqual(updateCalls[1].params, [2, 'inv-loc-2']);

    const allocCalls = calls.filter((c) => c.sql.includes('INSERT INTO order_item_allocations'));
    assert.equal(allocCalls.length, 2);

    // First allocation: 8 units in Estante-A1
    assert.equal(allocCalls[0].params[1], 'order-test-1');
    assert.equal(allocCalls[0].params[2], 'item-test-1');
    assert.equal(allocCalls[0].params[3], 'prod-test-1');
    assert.equal(allocCalls[0].params[4], 'inv-loc-1');
    assert.equal(allocCalls[0].params[5], 'Estante-A1');
    assert.equal(allocCalls[0].params[6], 8);

    // Second allocation: 2 units in Estante-B2
    assert.equal(allocCalls[1].params[4], 'inv-loc-2');
    assert.equal(allocCalls[1].params[5], 'Estante-B2');
    assert.equal(allocCalls[1].params[6], 2);
});

test('_restoreInventoryForCancelledOrder releases exact allocations and updates their status', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('FROM order_item_allocations') && statement.includes("status = 'reserved'")) {
                return [[
                    { id: 'alloc-1', inventory_id: 'inv-loc-1', reserved_quantity: 5 },
                    { id: 'alloc-2', inventory_id: 'inv-loc-2', reserved_quantity: 3 }
                ]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    await salesService._restoreInventoryForCancelledOrder(connection, 'order-c-1', 'pending');

    const updateInvCalls = calls.filter((c) => c.sql.includes('UPDATE inventory SET reserved_quantity = reserved_quantity - ? WHERE id = ? AND reserved_quantity >= ?'));
    assert.equal(updateInvCalls.length, 2);
    assert.deepEqual(updateInvCalls[0].params, [5, 'inv-loc-1', 5]);
    assert.deepEqual(updateInvCalls[1].params, [3, 'inv-loc-2', 3]);
    assert.equal(calls.some((c) => c.sql.includes('GREATEST')), false);

    const updateAllocCalls = calls.filter((c) => c.sql.includes("UPDATE order_item_allocations SET status = 'cancelled'"));
    assert.equal(updateAllocCalls.length, 2);
    assert.deepEqual(updateAllocCalls[0].params, ['alloc-1']);
    assert.deepEqual(updateAllocCalls[1].params, ['alloc-2']);
});

test('_restoreInventoryForCancelledOrder refuses to clamp a reservation that is no longer there', async () => {
    const connection = {
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('FROM order_item_allocations')) {
                return [[{ id: 'alloc-1', product_id: 'p-1', inventory_id: 'inv-1', reserved_quantity: 5 }]];
            }
            return [{ affectedRows: 0 }];
        }
    };
    await assert.rejects(
        () => salesService._restoreInventoryForCancelledOrder(connection, 'order-c-2', 'pending'),
        (err) => err.statusCode === 409 && err.errorCode === 'STOCK_INVARIANT_VIOLATION'
    );
});

test('pickOrderItem updates order_item_allocations and attaches allocation_id to picking event', async () => {
    const calls = [];
    const connection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('FROM order_items WHERE id = ? FOR UPDATE')) {
                return [[{ id: 'item-1', order_id: 'order-1', product_id: 'prod-1', quantity: 5, picked_quantity: 0, location: 'A-01' }]];
            }
            if (statement.includes('FROM order_item_allocations WHERE order_item_id = ?')) {
                return [[
                    { id: 'alloc-1', order_item_id: 'item-1', reserved_quantity: 5, picked_quantity: 0 }
                ]];
            }
            if (statement.includes('FROM picking_sessions WHERE order_id = ?')) {
                return [[{ id: 'session-1', status: 'in_progress' }]];
            }
            if (statement.includes('SELECT * FROM order_items WHERE id = ?')) {
                return [[{ id: 'item-1', order_id: 'order-1', picked_quantity: 4 }]];
            }
            return [{ affectedRows: 1 }];
        }
    };

    const originalGetConnection = pool.getConnection;
    const originalAudit = auditService.log;
    pool.getConnection = async () => connection;
    auditService.log = async () => {};

    try {
        const updated = await salesService.pickOrderItem('item-1', 4, 'picker-user-1');
        assert.equal(updated.picked_quantity, 4);

        // Verify allocation updated with picked=4 and shortage=1
        const allocUpdate = calls.find((c) => c.sql.includes('UPDATE order_item_allocations SET picked_quantity = ?'));
        assert.ok(allocUpdate);
        assert.deepEqual(allocUpdate.params, [4, 1, 'alloc-1']);

        // Verify event includes allocation_id and picker_id
        const eventInsert = calls.find((c) => c.sql.includes('INSERT INTO picking_session_events'));
        assert.ok(eventInsert);
        assert.equal(eventInsert.params[3], 'item-1'); // order_item_id
        assert.equal(eventInsert.params[4], 'alloc-1'); // allocation_id
        assert.equal(eventInsert.params[5], 'picker-user-1'); // picker_id
    } finally {
        pool.getConnection = originalGetConnection;
        auditService.log = originalAudit;
    }
});

test('getOrderSummary includes order_item_allocations in the response payload', async () => {
    const originalQuery = pool.query;
    pool.query = async (sql, params) => {
        const statement = String(sql);
        if (statement.includes('FROM orders WHERE id = ?')) {
            return [[{ id: 'order-summary-1', status: 'picking', total_amount: 100 }]];
        }
        if (statement.includes('FROM order_items oi')) {
            return [[{ id: 'item-1', product_id: 'p1', quantity: 2, picked_quantity: 1, product_name: 'Botin' }]];
        }
        if (statement.includes('FROM order_payments')) {
            return [[{ id: 'pay-1', method: 'cash', amount: 100 }]];
        }
        if (statement.includes('FROM picking_sessions ps')) {
            return [[{ id: 'session-1', status: 'in_progress', picker_name: 'Juan Picker' }]];
        }
        if (statement.includes('FROM order_item_allocations oia')) {
            return [[{
                id: 'alloc-1',
                order_id: 'order-summary-1',
                order_item_id: 'item-1',
                location_code: 'Estante-A1',
                reserved_quantity: 2,
                picked_quantity: 1,
                status: 'reserved'
            }]];
        }
        return [[]];
    };

    try {
        const summary = await salesService.getOrderSummary('order-summary-1');
        assert.ok(Array.isArray(summary.allocations));
        assert.equal(summary.allocations.length, 1);
        assert.equal(summary.allocations[0].location_code, 'Estante-A1');
        assert.equal(summary.allocations[0].reserved_quantity, 2);
    } finally {
        pool.query = originalQuery;
    }
});
