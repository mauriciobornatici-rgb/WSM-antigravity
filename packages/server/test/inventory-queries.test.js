import test from 'node:test';
import assert from 'node:assert/strict';

import inventoryService from '../services/inventory.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
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

test('inventory totals and stock queries fall back safely for empty aggregate rows', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('COUNT(*)')) return [[]];
        if (sql.includes('SUM(quantity) AS total_stock')) return [[]];
        return [[{ id: 'product-1', inventory_stock_current: null }]];
    });
    const result = await inventoryService.getProductsWithInventoryStock({}, { includeTotal: true });
    assert.deepEqual(result, { rows: [{ id: 'product-1', stock_current: 0 }], total: 0 });
    assert.equal(await inventoryService.getProductStock('missing'), 0);
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
        if (stockLockOf(sql)) {
            if (mode === 'missing') return [[{ id: 'other', product_id: 'p1', location: 'Z', quantity: 9, reserved_quantity: 0 }]];
            return [[{ id: 'source-1', product_id: 'p1', location: 'A', quantity: 5, reserved_quantity: 4 }]];
        }
        return [[]];
    });
    let rollbacks = 0;
    connection.rollback = async () => { rollbacks += 1; };
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 1, 'u1'), /Stock insuficiente/);
    mode = 'reserved';
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 2, 'u1'), /disponible insuficiente/);
    assert.equal(rollbacks, 2);

    const deadlocked = mockPool(t, async () => { throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }); });
    deadlocked.rollback = async () => {};
    await assert.rejects(() => inventoryService.transferStock('p1', 'A', 'B', 1, 'u1'), (error) => error.statusCode === 409 && error.errorCode === 'busy');
});

// Every row of the product, origin and destination, in one ordered statement (ADR-027, L3).
const stockLockOf = (sql) => String(sql).replace(/\s+/g, ' ').trim()
    === 'SELECT id, product_id, location, quantity, reserved_quantity FROM inventory WHERE product_id IN (?) ORDER BY product_id, id FOR UPDATE';

test('transferStock moves an entire row into an existing target', async (t) => {
    const calls = [];
    const connection = mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (stockLockOf(sql)) {
            return [[
                { id: 'source-1', product_id: 'p1', location: 'A', quantity: 5, reserved_quantity: 0 },
                { id: 'target-1', product_id: 'p1', location: 'B', quantity: 1, reserved_quantity: 0 },
            ]];
        }
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
    // The depleted source row must be zeroed, not deleted: order_item_allocations
    // references inventory rows with ON DELETE RESTRICT (migration 044).
    assert.equal(calls.some(({ sql }) => sql.startsWith('DELETE FROM inventory')), false);
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE inventory SET quantity = ?') && params[0] === 0));
    assert.ok(calls.some(({ sql, params }) => sql.includes('quantity = quantity + ?') && params[1] === 'target-1'));
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO journal_entries')), false, 'between valued locations nothing changes in value');
});

test('transferStock decrements partial source and creates a target location', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (stockLockOf(sql)) return [[{ id: 'source-1', product_id: 'p1', location: 'General', quantity: 8, reserved_quantity: 1 }]];
        return [{ affectedRows: 1 }];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    await inventoryService.transferStock('p1', '', 'C', 3, null);
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE inventory SET quantity = ?') && params[0] === 5));
    assert.ok(calls.some(({ sql }) => sql.startsWith('INSERT INTO inventory (id, product_id')));
});

test('transferStock to Mermas is a loss now, and back from Mermas a recovery at today\'s cost (D3)', async (t) => {
    const entries = [];
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (stockLockOf(sql)) {
            return [[
                { id: 'gen', product_id: 'p1', location: 'General', quantity: 8, reserved_quantity: 0 },
                { id: 'waste', product_id: 'p1', location: 'Mermas', quantity: 2, reserved_quantity: 0 },
            ]];
        }
        if (String(sql).includes('auto_update_cost')) return [[{ id: 'p1', purchase_price: '12.50' }]];
        return [{ affectedRows: 1 }];
    });
    const originals = { audit: auditService.log, entry: accountingService.createJournalEntry };
    auditService.log = async () => {};
    accountingService.createJournalEntry = async (_c, entry) => { entries.push(entry); return `je-${entries.length}`; };
    t.after(() => { auditService.log = originals.audit; accountingService.createJournalEntry = originals.entry; });

    const out = await inventoryService.transferStock('p1', 'General', 'Mermas', 3, 'u1');
    await inventoryService.transferStock('p1', 'Mermas', 'General', 1, 'u1');

    assert.deepEqual(entries.map((entry) => entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit])), [
        [['5.1.02.02', 37.5, 0], ['1.1.04.01', 0, 37.5]],
        [['1.1.04.01', 12.5, 0], ['5.1.02.02', 0, 12.5]],
    ]);
    assert.deepEqual([entries[0].reference_type, entries[0].reference_id], ['transfer', out.movementId]);
    const movementCosts = calls.filter(({ sql }) => sql.includes('INSERT INTO inventory_movements')).map(({ params }) => params[5]);
    assert.deepEqual(movementCosts, [12.5, 12.5]);
    assert.deepEqual(calls.filter(({ sql }) => sql.startsWith('UPDATE inventory_movements SET journal_entry_id')).map(({ params }) => params[0]), ['je-1', 'je-2']);
});

test('inventory normalization canonicalizes empty, textual and family values', () => {
    assert.equal(inventoryService.normalizeBarcode(null), null);
    assert.equal(inventoryService.normalizeBarcode(' 779 '), '779');
    assert.equal(inventoryService.normalizeLocation('  '), null);
    assert.equal(inventoryService.normalizeLocation(' A-1 '), 'A-1');
    assert.equal(inventoryService.normalizeFamilyValue(undefined), null);
    assert.equal(inventoryService.normalizeFamilyValue(' Camiseta '), 'Camiseta');
});

test('inventory queries support empty filters, totals and explicit offsets', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('COUNT(*)')) return [[{ total: null }]];
        return [[]];
    });
    assert.deepEqual(await inventoryService.getMovements({}, { limit: 10, offset: 2 }), []);
    assert.deepEqual(await inventoryService.getBatches(), []);
    assert.deepEqual(await inventoryService.getSerials(), []);
    assert.ok(calls.some(({ sql }) => sql.includes('LIMIT ?')));
});

test('batch updates handle empty patches and missing refreshed rows', async (t) => {
    mockPool(t, async () => [[]]);
    assert.equal(await inventoryService.updateBatch('b', {}), null);
    assert.equal(await inventoryService.updateBatch('b', { status: 'expired', expiration_date: null }), null);
});
