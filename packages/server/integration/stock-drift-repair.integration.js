import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, saleMovementsOf, seedProduct, stockOf } from './helpers/qaDb.js';
import auditService from '../services/audit.service.js';
import {
    DRIFT_CLASSES, REPAIR_AUDIT_ACTION, findAffectedOrders, repairOrder,
} from '../scripts/stock-drift/stockDrift.js';

test.after(async () => {
    await closePool();
});

// Reproduces what the POS left behind before the C1 fix: a pending/completed order
// whose stock was only reserved (with or without allocation rows).
async function seedLegacyPosOrder({ productId, quantity, withAllocation = false, invoiced = false, shiftPaid = false }) {
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    let invoiceId = null;
    if (invoiced) {
        invoiceId = crypto.randomUUID();
        await pool.query(
            'INSERT INTO invoices (id, client_name, invoice_type, point_of_sale, invoice_number) VALUES (?, ?, ?, ?, ?)',
            [invoiceId, 'Consumidor final', 'B', 99, crypto.randomInt(1, 2_000_000_000)]
        );
    }
    await pool.query(
        `INSERT INTO orders (id, status, external_source, external_id, invoice_id, total_amount, created_at)
         VALUES (?, ?, 'pos', ?, ?, 100, NOW() - INTERVAL 1 DAY)`,
        [orderId, invoiced ? 'completed' : 'pending', crypto.randomUUID(), invoiceId]
    );
    await pool.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, 100)',
        [itemId, orderId, productId, quantity]
    );
    if (withAllocation) {
        const [[row]] = await pool.query('SELECT id, location FROM inventory WHERE product_id = ? LIMIT 1', [productId]);
        await pool.query(
            `INSERT INTO order_item_allocations (id, order_id, order_item_id, product_id, inventory_id, location_code, reserved_quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), orderId, itemId, productId, row.id, row.location, quantity]
        );
    }
    if (shiftPaid) {
        const registerId = crypto.randomUUID();
        const shiftId = crypto.randomUUID();
        await pool.query('INSERT INTO cash_registers (id, name) VALUES (?, ?)', [registerId, `QA ${registerId.slice(0, 8)}`]);
        await pool.query('INSERT INTO cash_shifts (id, cash_register_id) VALUES (?, ?)', [shiftId, registerId]);
        await pool.query(
            "INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type) VALUES (?, ?, ?, 'cash', 100, 'sale')",
            [crypto.randomUUID(), shiftId, orderId]
        );
    }
    return orderId;
}

async function affected(orderId) {
    const connection = await pool.getConnection();
    try {
        return (await findAffectedOrders(connection)).find((order) => order.id === orderId);
    } finally {
        connection.release();
    }
}

async function repair(order, mode) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await repairOrder(connection, order, { mode });
        await auditService.log({ action: REPAIR_AUDIT_ACTION, entity_type: 'order', entity_id: order.id, new_values: { mode } }, connection);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

test('class A legacy sale without allocations: stock deducted, reservation released, sale traced, idempotent', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5, reserved: 2 }] });
    const orderId = await seedLegacyPosOrder({ productId, quantity: 2, shiftPaid: true });

    const order = await affected(orderId);
    assert.equal(order.drift_class, DRIFT_CLASSES.A);
    assert.equal(order.legacy_without_allocations, true);

    await repair(order, 'sale');

    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    const movements = await saleMovementsOf(productId);
    assert.deepEqual(movements.map((movement) => [movement.reference_id, movement.quantity]), [[orderId, 2]]);
    const [[row]] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
    assert.equal(row.status, 'completed');
    assert.equal(await affected(orderId), undefined, 'a repaired order is not detected again');
});

test('class A with allocation rows repairs exactly the allocated inventory row', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 4, reserved: 1 }, { location: 'QA-Z', quantity: 9 }] });
    const orderId = await seedLegacyPosOrder({ productId, quantity: 1, withAllocation: true, invoiced: true });

    const order = await affected(orderId);
    assert.equal(order.drift_class, DRIFT_CLASSES.A);
    await repair(order, 'sale');

    const [rows] = await pool.query('SELECT location, quantity, reserved_quantity FROM inventory WHERE product_id = ? ORDER BY location', [productId]);
    assert.deepEqual(rows.map((row) => [row.location, row.quantity, row.reserved_quantity]), [['QA-A', 3, 0], ['QA-Z', 9, 0]]);
    const [[allocation]] = await pool.query('SELECT status, picked_quantity FROM order_item_allocations WHERE order_id = ?', [orderId]);
    assert.deepEqual([allocation.status, allocation.picked_quantity], ['picked', 1]);
});

test('class B: a later stock count already fixed physical stock, so only the reservation is released', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5, reserved: 2 }] });
    const orderId = await seedLegacyPosOrder({ productId, quantity: 2, shiftPaid: true });
    await pool.query(
        "INSERT INTO inventory_movements (id, type, product_id, quantity, reason) VALUES (?, 'stock_audit', ?, -2, 'conteo QA')",
        [crypto.randomUUID(), productId]
    );

    const order = await affected(orderId);
    assert.equal(order.drift_class, DRIFT_CLASSES.B);
    await repair(order, 'release');

    assert.deepEqual(await stockOf(productId), { quantity: 5, reserved: 0 });
    assert.equal((await saleMovementsOf(productId)).length, 0);
});

test('class C (no invoice, no payment) is detected and not treated as a sale', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 3, reserved: 1 }] });
    const orderId = await seedLegacyPosOrder({ productId, quantity: 1 });

    const order = await affected(orderId);
    assert.equal(order.drift_class, DRIFT_CLASSES.C);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 1 });
});

test('an order whose reservation disappeared is reported as an anomaly and changes nothing', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 3, reserved: 0 }] });
    const orderId = await seedLegacyPosOrder({ productId, quantity: 2, shiftPaid: true });

    const order = await affected(orderId);
    await assert.rejects(() => repair(order, 'sale'), (error) => error.code === 'STOCK_DRIFT_ANOMALY');
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.ok(await affected(orderId), 'still pending for manual review');
});
