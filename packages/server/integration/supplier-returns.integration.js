import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, uniqueId } from './helpers/qaDb.js';
import supplierReturnService from '../domains/procurement/SupplierReturnService.js';

test.after(async () => {
    await closePool();
});

async function seedSupplierReturn(productId, quantity) {
    const supplierId = crypto.randomUUID();
    const returnId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    await pool.query(
        "INSERT INTO supplier_returns (id, return_number, supplier_id, status) VALUES (?, ?, ?, 'draft')",
        [returnId, uniqueId('DEV'), supplierId]
    );
    await pool.query(
        'INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?, 10)',
        [crypto.randomUUID(), returnId, productId, quantity]
    );
    return returnId;
}

async function rowsOf(productId) {
    const [rows] = await pool.query(
        'SELECT location, quantity, reserved_quantity FROM inventory WHERE product_id = ? ORDER BY location',
        [productId]
    );
    return rows.map((row) => [row.location, row.quantity, row.reserved_quantity]);
}

test('a supplier return takes unreserved stock, prefers the return location and traces the real location', async () => {
    const productId = await seedProduct({ stock: [
        { location: 'General', quantity: 5, reserved: 3 },
        { location: 'Devoluciones a Proveedores', quantity: 2 },
    ] });
    const returnId = await seedSupplierReturn(productId, 3);

    await supplierReturnService.approveSupplierReturn(returnId, null);

    assert.deepEqual(await rowsOf(productId), [['Devoluciones a Proveedores', 0, 0], ['General', 4, 3]]);
    const [movements] = await pool.query(
        "SELECT from_location, quantity FROM inventory_movements WHERE reference_id = ? AND type = 'return' ORDER BY from_location",
        [returnId]
    );
    assert.deepEqual(movements.map((row) => [row.from_location, row.quantity]), [['Devoluciones a Proveedores', 2], ['General', 1]]);
});

test('a supplier return never consumes stock reserved for customer orders', async () => {
    const productId = await seedProduct({ stock: [{ location: 'General', quantity: 4, reserved: 3 }] });
    const returnId = await seedSupplierReturn(productId, 2);

    await assert.rejects(
        () => supplierReturnService.approveSupplierReturn(returnId, null),
        (err) => err.errorCode === 'INSUFFICIENT_STOCK' && err.statusCode === 409
    );
    assert.deepEqual(await rowsOf(productId), [['General', 4, 3]]);
    const [[row]] = await pool.query('SELECT status FROM supplier_returns WHERE id = ?', [returnId]);
    assert.equal(row.status, 'draft');
});
