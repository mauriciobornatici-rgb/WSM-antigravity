import test from 'node:test';
import assert from 'node:assert/strict';

import { returnsService } from '../services/warranties.service.js';
import { mockPool } from './helpers/mockDb.js';

test('createReturn successfully persists a return document and its items, pricing from the order', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT id FROM orders')) {
            return [[{ id: 'order-123' }]];
        }
        if (sql.includes('FROM order_items WHERE order_id')) {
            // Sold at 75 (net) even though the client tries to send a different price.
            return [[{ product_id: 'prod-abc', quantity: 2, unit_price: 75.00 }]];
        }
        if (sql.includes('FROM client_return_items ri')) {
            return [[]];
        }
        if (sql.includes('SELECT COALESCE(SUM(quantity * unit_price)')) {
            return [[{ total: 150.00 }]];
        }
        return [[]];
    });

    const result = await returnsService.createReturn({
        client_id: 'client-123',
        customer_name: 'Marcos Lopez',
        order_id: 'order-123',
        reason: 'Defectuoso',
        // Client-sent unit_price (999) must be ignored: the stored price comes from the order.
        items: [
            { product_id: 'prod-abc', quantity: 2, condition_status: 'sellable', unit_price: 999 }
        ]
    });

    assert.ok(result.id);

    // Verify insert queries
    const inserts = queryCalls.filter(c => c.sql.includes('INSERT INTO'));
    assert.ok(inserts.some(c => c.sql.includes('INSERT INTO client_returns')));
    const itemInsert = inserts.find(c => c.sql.includes('INSERT INTO client_return_items'));
    assert.ok(itemInsert);
    assert.equal(itemInsert.params[0][0][5], 75.00, 'stored unit_price must come from order_items, not the client');

    const updates = queryCalls.filter(c => c.sql.includes('UPDATE'));
    assert.ok(updates.some(c => c.sql.includes('UPDATE client_returns SET total_amount = ?')));
});

test('approveReturn throws RETURN_NOT_FOUND if return does not exist', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM client_returns')) {
            return [[]];
        }
        return [[]];
    });

    await assert.rejects(
        () => returnsService.approveReturn('non-existent-id', 'user-1'),
        (err) => {
            assert.equal(err.errorCode, 'RETURN_NOT_FOUND');
            assert.equal(err.statusCode, 404);
            return true;
        }
    );
});

test('approveReturn throws RETURN_ALREADY_APPROVED if status is approved', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM client_returns')) {
            return [[{ id: 'ret-123', status: 'approved' }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => returnsService.approveReturn('ret-123', 'user-1'),
        (err) => {
            assert.equal(err.errorCode, 'RETURN_ALREADY_APPROVED');
            assert.equal(err.statusCode, 409);
            return true;
        }
    );
});

test('approveReturn throws RETURN_WITHOUT_ITEMS if items list is empty', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM client_returns')) {
            return [[{ id: 'ret-123', status: 'pending' }]];
        }
        if (sql.includes('SELECT * FROM client_return_items')) {
            return [[]];
        }
        return [[]];
    });

    await assert.rejects(
        () => returnsService.approveReturn('ret-123', 'user-1'),
        (err) => {
            assert.equal(err.errorCode, 'RETURN_WITHOUT_ITEMS');
            assert.equal(err.statusCode, 400);
            return true;
        }
    );
});

test('approveReturn successfully approves a return, updates inventory, records movement and refunds gross (net + VAT)', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT * FROM client_returns')) {
            return [[{ id: 'ret-123', status: 'pending', client_id: 'client-1' }]];
        }
        if (sql.includes('SELECT * FROM client_return_items')) {
            return [[{ id: 'item-1', product_id: 'prod-1', quantity: 2, condition_status: 'sellable', unit_price: 100 }]];
        }
        if (sql.includes('SELECT id, vat_rate FROM products')) {
            return [[{ id: 'prod-1', vat_rate: 21 }]];
        }
        if (sql.includes('SELECT id FROM inventory')) {
            return [[{ id: 'inv-row-1' }]];
        }
        return [[]];
    });


    const result = await returnsService.approveReturn('ret-123', 'user-1');
    assert.equal(result.success, true);
    assert.equal(result.return_id, 'ret-123');
    // net = 2 * 100 = 200; VAT 21% = 42; gross refund = 242.
    assert.equal(result.total_amount, 242);
    assert.equal(result.restocked_quantity, 2);
    assert.equal(result.discarded_quantity, 0);

    const updates = queryCalls.filter(c => c.sql.includes('UPDATE'));
    const inserts = queryCalls.filter(c => c.sql.includes('INSERT'));

    assert.ok(updates.some(c => c.sql.includes('UPDATE client_returns SET status = "approved"')));
    assert.ok(updates.some(c => c.sql.includes('UPDATE inventory SET quantity = quantity + ?')));
    assert.ok(inserts.some(c => c.sql.includes('INSERT INTO inventory_movements')));

    const journalCall = inserts.find(c => c.sql.includes('INSERT INTO credit_notes'));
    assert.equal(journalCall.params[7], 242, 'credit_notes.amount must be the gross total');
});
