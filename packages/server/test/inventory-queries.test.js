import test from 'node:test';
import assert from 'node:assert/strict';

import inventoryService from '../services/inventory.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('inventory product queries calculate stock, totals and supplier pagination', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('COUNT(*)')) return [[{ total: '2' }]];
        if (sql.includes('SUM(quantity) AS total_stock')) return [[{ total_stock: '14' }]];
        if (sql.includes('SELECT i.*, p.name')) return [[{ id: 'inventory-1', product_name: 'Zapatilla' }]];
        return [[
            { id: 'product-1', name: 'Zapatilla', inventory_stock_current: '8' },
            { id: 'product-2', name: 'Remera', inventory_stock_current: null }
        ]];
    });

    const result = await inventoryService.getProductsWithInventoryStock(
        { supplier_id: 'supplier-1' },
        { includeTotal: true, limit: 10, offset: 5 }
    );
    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map((row) => row.stock_current), [8, 0]);
    assert.ok(calls.some(({ sql, params }) => sql.includes('LIMIT ? OFFSET ?') && params.at(-1) === 5));
    assert.equal((await inventoryService.getInventoryWithDetails())[0].product_name, 'Zapatilla');
    assert.equal(await inventoryService.getProductStock('product-1'), 14);
});

test('inventory product query returns a simple array without count options', async (t) => {
    mockPool(t, async () => [[{ id: 'product-1', inventory_stock_current: 3 }]]);
    const result = await inventoryService.getProductsWithInventoryStock();
    assert.deepEqual(result, [{ id: 'product-1', stock_current: 3 }]);
});

test('inventory movement, batch and serial queries preserve all filters', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        return [[{ id: 'row-1', status: 'available' }]];
    });

    assert.equal((await inventoryService.getMovements({
        product_id: 'product-1', type: 'transfer', start_date: '2026-01-01', end_date: '2026-12-31'
    }, { limit: 15 }))[0].id, 'row-1');
    assert.equal((await inventoryService.getProductMovements('product-1'))[0].id, 'row-1');
    assert.equal((await inventoryService.getBatches({ product_id: 'product-1', status: 'active' }))[0].id, 'row-1');
    assert.equal((await inventoryService.getSerials({ product_id: 'product-1', status: 'available' }))[0].id, 'row-1');
    assert.ok(calls.some(({ sql }) => sql.includes('DATE(im.created_at) >= DATE(?)')));
    assert.ok(calls.some(({ sql }) => sql.includes('b.status = ?')));
    assert.ok(calls.some(({ sql }) => sql.includes('s.status = ?')));
});

test('batch and serial creation and updates handle optional fields', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT * FROM product_batches')) return [[{ id: 'batch-1', quantity_current: 4 }]];
        if (sql.includes('SELECT * FROM serial_numbers')) return [[{ id: 'serial-1', status: 'sold' }]];
        return [{ affectedRows: 1 }];
    });

    assert.ok((await inventoryService.createBatch({ product_id: 'product-1', batch_number: 'L-1', quantity_initial: 5 })).id);
    assert.equal((await inventoryService.updateBatch('batch-1', { quantity_current: 4 })).quantity_current, 4);
    assert.ok((await inventoryService.createSerialNumber({ product_id: 'product-1', serial_number: 'SER-1', warranty_months: 12 })).id);
    assert.ok((await inventoryService.createSerialNumber({ product_id: 'product-1', serial_number: 'SER-2' })).id);
    assert.equal(await inventoryService.updateSerialNumber('serial-1', { unsupported: true }), null);
    assert.equal((await inventoryService.updateSerialNumber('serial-1', { status: 'sold', location: 'A-1' })).status, 'sold');
    assert.ok(calls.some(({ sql, params }) => sql.includes("'available'") && params.at(-1) instanceof Date));
    assert.ok(calls.some(({ sql, params }) => sql.includes("'available'") && params.at(-1) === null));
});

test('recordMovement persists defaults, audits and tolerates background sync failure', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        return [{ affectedRows: 1 }];
    });
    const originalAudit = auditService.log;
    const originalStock = inventoryService.getProductStock;
    const originalError = console.error;
    auditService.log = async () => {};
    inventoryService.getProductStock = async () => { throw new Error('offline'); };
    console.error = () => {};
    t.after(() => {
        auditService.log = originalAudit;
        inventoryService.getProductStock = originalStock;
        console.error = originalError;
    });

    const movement = await inventoryService.recordMovement({ type: 'adjustment', product_id: 'product-1', quantity: 2 }, 'user-1');
    assert.ok(movement.id);
    assert.equal(calls[0].params[6], 0);
    assert.equal(calls[0].params[8], 'manual');
    await new Promise((resolve) => setImmediate(resolve));
});

test('transferStock rejects invalid, same-location, missing and reserved stock', async (t) => {
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 0, 'u1'), /mayor a cero/);
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'A', 1, 'u1'), /no pueden ser iguales/);

    let mode = 'missing';
    const connection = mockPool(t, async (sql) => {
        if (sql.includes('SELECT id, quantity, reserved_quantity')) {
            if (mode === 'missing') return [[]];
            return [[{ id: 'source-1', quantity: 5, reserved_quantity: 4 }]];
        }
        return [[]];
    });
    let rollbacks = 0;
    connection.rollback = async () => { rollbacks += 1; };
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 1, 'u1'), /Stock insuficiente/);
    mode = 'reserved';
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 2, 'u1'), /disponible insuficiente/);
    assert.equal(rollbacks, 2);
});

test('transferStock moves an entire row into an existing target', async (t) => {
    const calls = [];
    const connection = mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, quantity, reserved_quantity')) return [[{ id: 'source-1', quantity: 5, reserved_quantity: 0 }]];
        if (sql.includes('SELECT id FROM inventory')) return [[{ id: 'target-1' }]];
        return [{ affectedRows: 1 }];
    });
    let commits = 0;
    connection.commit = async () => { commits += 1; };
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    const result = await inventoryService.transferStock('p1', ' A ', ' B ', 5, 'u1');
    assert.equal(result.success, true);
    assert.equal(commits, 1);
    assert.ok(calls.some(({ sql }) => sql.startsWith('DELETE FROM inventory')));
    assert.ok(calls.some(({ sql }) => sql.includes('quantity = quantity + ?')));
});

test('transferStock decrements partial source and creates a target location', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, quantity, reserved_quantity')) return [[{ id: 'source-1', quantity: 8, reserved_quantity: 1 }]];
        if (sql.includes('SELECT id FROM inventory')) return [[]];
        return [{ affectedRows: 1 }];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    await inventoryService.transferStock('p1', '', 'C', 3, null);
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE inventory SET quantity = ?') && params[0] === 5));
    assert.ok(calls.some(({ sql }) => sql.startsWith('INSERT INTO inventory (id, product_id')));
});
