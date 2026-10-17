import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'fs/promises';

import * as controller from '../controllers/inventoryController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import inventoryService from '../services/inventory.service.js';
import accountingService from '../services/accounting.service.js';

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const headers = {};
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            setHeader(name, value) {
                headers[name] = value;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body, headers });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined, headers });
        };
        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    });
}

function createTrackedConnection(queryMock = async () => [{}]) {
    const calls = [];
    const counts = { begin: 0, commit: 0, rollback: 0, release: 0 };
    const connection = {
        async beginTransaction() { counts.begin += 1; },
        async commit() { counts.commit += 1; },
        async rollback() { counts.rollback += 1; },
        release() { counts.release += 1; },
        async query(sql, params = []) {
            const statement = normalizeSql(sql);
            calls.push({ statement, params });
            return queryMock(statement, params);
        }
    };
    return { connection, calls, counts };
}

function installPool(t, { poolQuery, tracked } = {}) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    const calls = [];
    pool.query = async (sql, params = []) => {
        const statement = normalizeSql(sql);
        calls.push({ statement, params });
        if (!poolQuery) throw new Error(`Unexpected pool SQL: ${statement}`);
        return poolQuery(statement, params);
    };
    pool.getConnection = async () => {
        if (!tracked) throw new Error('Unexpected getConnection');
        return tracked.connection;
    };
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
    });
    return calls;
}

function installAudit(t) {
    const entries = [];
    const previous = auditService.log;
    auditService.log = async (entry) => {
        entries.push(entry);
    };
    t.after(() => {
        auditService.log = previous;
    });
    return entries;
}

function stubInventory(t, implementations) {
    const calls = {};
    for (const [name, impl] of Object.entries(implementations)) {
        const previous = inventoryService[name];
        calls[name] = [];
        inventoryService[name] = (...args) => {
            calls[name].push(args);
            return impl(...args);
        };
        t.after(() => {
            inventoryService[name] = previous;
        });
    }
    return calls;
}

const dupError = () => Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });

// ------------------------------------------------------ Catalog options

test('getProductCatalogOptions rejects unknown option types without querying', async (t) => {
    installPool(t);
    const result = await runHandler(controller.getProductCatalogOptions, { query: { type: 'bogus' } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid_option_type');
});

test('getProductCatalogOptions filters by type/parent, hides inactive by default and coerces values', async (t) => {
    const calls = installPool(t, {
        poolQuery: async () => [[{ id: 'o1', active: 1, usage_count: '4' }, { id: 'o2', active: 0, usage_count: null }]]
    });
    const result = await runHandler(controller.getProductCatalogOptions, {
        query: { type: 'subgroup', parent_id: 'g1' }
    });
    assert.deepEqual(result.body, [
        { id: 'o1', active: true, usage_count: 4 },
        { id: 'o2', active: false, usage_count: 0 }
    ]);
    assert.match(calls[0].statement, /catalog_option\.type = \?/);
    assert.match(calls[0].statement, /catalog_option\.parent_id = \?/);
    assert.match(calls[0].statement, /catalog_option\.active = TRUE/);
    assert.deepEqual(calls[0].params, ['subgroup', 'g1']);
});

test('getProductCatalogOptions includes inactive values on request and applies no filters by default', async (t) => {
    const calls = installPool(t, { poolQuery: async () => [[]] });
    await runHandler(controller.getProductCatalogOptions, { query: { include_inactive: 'true' } });
    assert.doesNotMatch(calls[0].statement, /active = TRUE/);
    assert.doesNotMatch(calls[0].statement, /catalog_option\.type = \?/);
    assert.deepEqual(calls[0].params, []);
});

test('createProductCatalogOption surfaces parent validation errors as statusCode 400', async (t) => {
    installPool(t, { poolQuery: async () => [[]] });
    const run = (body) => runHandler(controller.createProductCatalogOption, { body });
    await assert.rejects(run({ type: 'brand', name: 'Nike', parent_id: 'g1' }), (e) => e.statusCode === 400 && /subgrupos/.test(e.message));
    await assert.rejects(run({ type: 'subgroup', name: 'Remeras' }), (e) => e.statusCode === 400 && /pertenecer/.test(e.message));
    await assert.rejects(run({ type: 'subgroup', name: 'Remeras', parent_id: 'x' }), (e) => e.statusCode === 400 && /no existe/.test(e.message));
    for (const body of [{ type: 'bogus', name: 'x' }, { type: 'brand', name: '  ' }, { type: 'brand', name: 'x'.repeat(101) }]) {
        const result = await run(body);
        assert.equal(result.status, 400);
        assert.equal(result.body.error, 'invalid_catalog_option');
    }
});

test('createProductCatalogOption inserts a normalized, deduplicable option and audits it', async (t) => {
    const calls = installPool(t, {
        poolQuery: async (statement) => (statement.startsWith('INSERT') ? [{}] : [[{ id: 'new', active: 1 }]])
    });
    const audit = installAudit(t);

    const result = await runHandler(controller.createProductCatalogOption, {
        body: { type: 'brand', name: '  Nike   Air  ', sort_order: '3' },
        user: { id: 'u1' }
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { id: 'new', active: true, usage_count: 0 });
    const [id, optionKey, type, name, normalized, parentId, sortOrder, createdBy] = calls[0].params;
    assert.equal(type, 'brand');
    assert.equal(name, 'Nike Air');
    assert.equal(normalized, 'nike air');
    assert.equal(parentId, null);
    assert.equal(sortOrder, 3);
    assert.equal(createdBy, 'u1');
    assert.equal(optionKey, crypto.createHash('sha256').update('brand||nike air').digest('hex'));
    assert.equal(audit[0].entity_id, id);
    assert.equal(audit[0].action, 'CREATE_PRODUCT_CATALOG_OPTION');
});

test('createProductCatalogOption accepts a subgroup under an existing group', async (t) => {
    const calls = installPool(t, {
        poolQuery: async (statement) => {
            if (statement.startsWith('SELECT id FROM product_catalog_options')) return [[{ id: 'g1' }]];
            if (statement.startsWith('INSERT')) return [{}];
            return [[{ id: 'new', active: 0 }]];
        }
    });
    installAudit(t);
    const result = await runHandler(controller.createProductCatalogOption, {
        body: { type: 'subgroup', name: 'Remeras', parent_id: 'g1' }
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.active, false);
    const insert = calls.find((call) => call.statement.startsWith('INSERT'));
    assert.equal(insert.params[5], 'g1');
    assert.equal(insert.params[6], 0);
    assert.equal(insert.params[7], null);
});

test('createProductCatalogOption maps duplicates to 409 and rethrows other DB errors', async (t) => {
    let error = dupError();
    installPool(t, {
        poolQuery: async () => {
            throw error;
        }
    });
    const dup = await runHandler(controller.createProductCatalogOption, { body: { type: 'color', name: 'Rojo' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'duplicate_catalog_option');

    error = new Error('other');
    await assert.rejects(runHandler(controller.createProductCatalogOption, { body: { type: 'color', name: 'Rojo' } }), /other/);
    const noBody = await runHandler(controller.createProductCatalogOption, { body: undefined });
    assert.equal(noBody.status, 400);
});

function optionPool(existing, extra = {}) {
    return async (statement) => {
        if (statement === 'SELECT * FROM product_catalog_options WHERE id = ?') return [existing ? [existing] : []];
        if (statement.includes('LEFT JOIN product_catalog_options parent ON parent.id = catalog_option.parent_id WHERE')) {
            return [[{ ...(existing || {}), ...extra }]];
        }
        if (statement.startsWith('SELECT id FROM product_catalog_options')) return [extra.parentRows || [{ id: 'g1' }]];
        throw new Error(`Unexpected SQL: ${statement}`);
    };
}

test('updateProductCatalogOption answers 404 for unknown ids and 400 for invalid names', async (t) => {
    installPool(t, { poolQuery: optionPool(null) });
    const missing = await runHandler(controller.updateProductCatalogOption, { params: { id: 'x' }, body: {} });
    assert.equal(missing.status, 404);

    installPool(t, { poolQuery: optionPool({ id: 'o1', type: 'brand', name: 'Nike', active: 1, sort_order: 0 }) });
    const blank = await runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: { name: '  ' } });
    assert.equal(blank.status, 400);
    const long = await runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: { name: 'x'.repeat(101) } });
    assert.equal(long.status, 400);
});

test('updateProductCatalogOption renaming a brand propagates to products and families inside one transaction', async (t) => {
    const existing = { id: 'o1', type: 'brand', name: 'Nike', parent_id: null, active: 1, sort_order: 2 };
    const tracked = createTrackedConnection();
    installPool(t, { poolQuery: optionPool(existing), tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.updateProductCatalogOption, {
        params: { id: 'o1' },
        body: { name: 'Adidas', active: false, sort_order: '5' },
        user: { id: 'u1' }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.active, true, 'response is re-read from the database');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.equal(tracked.calls.length, 3);
    assert.deepEqual(tracked.calls[0].params.slice(1, 6), ['Adidas', 'adidas', null, false, 5]);
    assert.match(tracked.calls[1].statement, /UPDATE products SET `brand` = \? WHERE `brand_option_id` = \?/);
    assert.deepEqual(tracked.calls[1].params, ['Adidas', 'o1']);
    assert.match(tracked.calls[2].statement, /SET family\.`brand` = \?/);
    assert.equal(audit[0].action, 'UPDATE_PRODUCT_CATALOG_OPTION');
    assert.deepEqual(audit[0].old_values, existing);
});

test('updateProductCatalogOption renaming a group updates the category family field; sizes skip families', async (t) => {
    const group = { id: 'g1', type: 'group', name: 'Ropa', parent_id: null, active: 1, sort_order: 0 };
    const trackedGroup = createTrackedConnection();
    installPool(t, { poolQuery: optionPool(group), tracked: trackedGroup });
    installAudit(t);
    await runHandler(controller.updateProductCatalogOption, { params: { id: 'g1' }, body: { name: 'Indumentaria' } });
    assert.match(trackedGroup.calls[1].statement, /`category` = \?/);
    assert.match(trackedGroup.calls[2].statement, /family\.`category` = \?/);

    const size = { id: 's1', type: 'size', name: 'M', parent_id: null, active: 1, sort_order: 0 };
    const trackedSize = createTrackedConnection();
    installPool(t, { poolQuery: optionPool(size), tracked: trackedSize });
    await runHandler(controller.updateProductCatalogOption, { params: { id: 's1' }, body: { name: 'L' } });
    assert.equal(trackedSize.calls.length, 2);
    assert.match(trackedSize.calls[1].statement, /`size` = \?/);
});

test('updateProductCatalogOption keeps denormalized product names untouched when the name does not change', async (t) => {
    const existing = { id: 'o1', type: 'color', name: 'Rojo', parent_id: null, active: 0, sort_order: 7 };
    const tracked = createTrackedConnection();
    installPool(t, { poolQuery: optionPool(existing), tracked });
    installAudit(t);
    await runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: { name: ' Rojo ' } });
    assert.equal(tracked.calls.length, 1);
    assert.deepEqual(tracked.calls[0].params.slice(3, 6), [null, false, 7]);

    await runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: {} });
    assert.equal(tracked.calls.length, 2);
});

test('updateProductCatalogOption validates parent changes for subgroups', async (t) => {
    const existing = { id: 'sg1', type: 'subgroup', name: 'Remeras', parent_id: 'g1', active: 1, sort_order: 0 };
    const tracked = createTrackedConnection();
    installPool(t, { poolQuery: optionPool(existing), tracked });
    installAudit(t);

    const moved = await runHandler(controller.updateProductCatalogOption, {
        params: { id: 'sg1' },
        body: { parent_id: 'g1' }
    });
    assert.equal(moved.status, 200);
    assert.equal(tracked.calls[0].params[3], 'g1');

    installPool(t, { poolQuery: optionPool(existing, { parentRows: [] }) });
    await assert.rejects(
        runHandler(controller.updateProductCatalogOption, { params: { id: 'sg1' }, body: { parent_id: 'ghost' } }),
        (error) => error.statusCode === 400
    );
});

test('updateProductCatalogOption maps duplicates to 409 and rethrows other failures with rollback', async (t) => {
    const existing = { id: 'o1', type: 'brand', name: 'Nike', parent_id: null, active: 1, sort_order: 0 };
    let failure = dupError();
    const tracked = createTrackedConnection(async () => {
        throw failure;
    });
    installPool(t, { poolQuery: optionPool(existing), tracked });

    const dup = await runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: { name: 'Puma' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'duplicate_catalog_option');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });

    failure = new Error('deadlock');
    await assert.rejects(
        runHandler(controller.updateProductCatalogOption, { params: { id: 'o1' }, body: { name: 'Puma' } }),
        /deadlock/
    );
    assert.equal(tracked.counts.rollback, 2);
    assert.equal(tracked.counts.release, 2);
});

// ----------------------------------------------------------- Products

test('getProducts without pagination params returns the raw list and ignores junk supplier filters', async (t) => {
    const calls = stubInventory(t, { getProductsWithInventoryStock: () => [{ id: 'p1' }] });
    for (const supplier_id of ['undefined', 'null', undefined]) {
        const result = await runHandler(controller.getProducts, { query: { supplier_id } });
        assert.deepEqual(result.body, [{ id: 'p1' }]);
        assert.deepEqual(calls.getProductsWithInventoryStock.at(-1), [{}]);
    }
    await runHandler(controller.getProducts, { query: { supplier_id: 'sup1' } });
    assert.deepEqual(calls.getProductsWithInventoryStock.at(-1), [{ supplier_id: 'sup1' }]);
});

test('getProducts with pagination caps the limit, asks for totals and sets headers', async (t) => {
    const calls = stubInventory(t, { getProductsWithInventoryStock: () => ({ rows: [{ id: 'p1' }], total: 1200 }) });
    const result = await runHandler(controller.getProducts, { query: { page: '3', limit: '9999' } });
    assert.deepEqual(result.body, [{ id: 'p1' }]);
    assert.deepEqual(calls.getProductsWithInventoryStock[0], [{}, { limit: 500, offset: 1000, includeTotal: true }]);
    assert.equal(result.headers['X-Total-Count'], '1200');
    assert.equal(result.headers['X-Total-Pages'], '3');
});

test('getInventory, movements, batches and serials delegate to the service', async (t) => {
    const calls = stubInventory(t, {
        getInventoryWithDetails: () => [{ a: 1 }],
        getMovements: () => [{ m: 1 }],
        getProductMovements: () => [{ pm: 1 }],
        getBatches: () => [{ b: 1 }],
        getSerials: () => [{ s: 1 }]
    });
    assert.deepEqual((await runHandler(controller.getInventory)).body, [{ a: 1 }]);
    const movements = await runHandler(controller.getMovements, { query: { limit: '10', product_id: 'p1' } });
    assert.deepEqual(movements.body, [{ m: 1 }]);
    assert.deepEqual(calls.getMovements[0], [{ limit: '10', product_id: 'p1' }, { limit: '10' }]);
    const product = await runHandler(controller.getProductMovements, { params: { id: 'p1' } });
    assert.deepEqual(product.body, [{ pm: 1 }]);
    assert.deepEqual(calls.getProductMovements[0], ['p1']);
    await runHandler(controller.getBatches, { query: { product_id: 'p1' } });
    assert.deepEqual(calls.getBatches[0], [{ product_id: 'p1' }]);
    await runHandler(controller.getSerials, { query: { status: 'in_stock' } });
    assert.deepEqual(calls.getSerials[0], [{ status: 'in_stock' }]);
});

test('createProduct, createMovement, transferStock and bulkUpdateTiendaNube pass the acting user', async (t) => {
    const calls = stubInventory(t, {
        createProduct: () => ({ id: 'p1' }),
        recordMovement: () => ({ id: 'm1' }),
        transferStock: () => ({ moved: true }),
        bulkUpdateTiendaNube: () => ({ updated: 2 })
    });
    const user = { id: 'u1' };
    assert.deepEqual((await runHandler(controller.createProduct, { body: { sku: 'A' }, user })).body, { id: 'p1' });
    assert.deepEqual(calls.createProduct[0], [{ sku: 'A' }, 'u1']);
    await runHandler(controller.createMovement, { body: { product_id: 'p1' }, user });
    assert.deepEqual(calls.recordMovement[0], [{ product_id: 'p1' }, 'u1']);
    const transfer = await runHandler(controller.transferStock, {
        body: { product_id: 'p1', from_location: 'A', to_location: 'B', quantity: 3, ignored: true },
        user
    });
    assert.deepEqual(transfer.body, { moved: true });
    assert.deepEqual(calls.transferStock[0], ['p1', 'A', 'B', 3, 'u1']);
    const bulk = await runHandler(controller.bulkUpdateTiendaNube, { body: { products: [{ id: 1 }] }, user });
    assert.deepEqual(bulk.body, { updated: 2 });
    assert.deepEqual(calls.bulkUpdateTiendaNube[0], [[{ id: 1 }], 'u1']);
});

test('transferStock propagates service errors (e.g. insufficient stock) to next()', async (t) => {
    stubInventory(t, {
        transferStock: () => {
            throw new Error('Stock insuficiente');
        }
    });
    await assert.rejects(
        runHandler(controller.transferStock, { body: { product_id: 'p1', from_location: 'A', to_location: 'B', quantity: 99 } }),
        /Stock insuficiente/
    );
});

// The product edit runs in the service, in one transaction (ADR-027): a fake connection answers it.
// stock: quantities in "General", or { location, quantity } rows.
const STOCK_LOCK = 'SELECT id, product_id, location, quantity, reserved_quantity FROM inventory WHERE product_id IN (?) ORDER BY product_id, id FOR UPDATE';
const PRODUCT_LOCK = 'SELECT * FROM products WHERE id = ? AND deleted_at IS NULL FOR UPDATE';

function productEditConnection(t, { previous, stock = [], updated = previous, failOn = null } = {}) {
    const tracked = createTrackedConnection(async (statement) => {
        if (failOn && statement.startsWith(failOn.statement)) throw failOn.error;
        if (statement === STOCK_LOCK) {
            return [stock.map((row, index) => ({
                id: `inv-${index}`, product_id: previous?.id, reserved_quantity: 0,
                ...(typeof row === 'number' ? { location: 'General', quantity: row } : row),
            }))];
        }
        if (statement.startsWith(PRODUCT_LOCK)) return [previous ? [previous] : []];
        if (statement === 'SELECT * FROM products WHERE id = ?') return [[updated]];
        return [{ affectedRows: 1 }];
    });
    installPool(t, { tracked });
    return tracked;
}

function updateColumns(calls, index = 0) {
    const update = calls.filter(({ statement }) => statement.startsWith('UPDATE products SET'))[index];
    if (!update) return null;
    const columns = update.statement.match(/SET (.+) WHERE/)[1].split(', ').map((part) => part.split(' = ')[0].replace(/`/g, ''));
    return Object.fromEntries(columns.map((column, index) => [column, update.params[index]]));
}

function captureEntries(t) {
    const entries = [];
    const originalEntry = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (connection, entry) => { entries.push(entry); return `je-${entries.length}`; };
    t.after(() => { accountingService.createJournalEntry = originalEntry; });
    return entries;
}

const entryLines = (entry) => entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);
const manager = { id: 'u1', role: 'manager' };

test('updateProduct normalizes the payload, strips protected fields and audits old/new values in one transaction', async (t) => {
    const previous = { id: 'p1', name: 'Old', category: 'x', purchase_price: '12.00' };
    const updated = { id: 'p1', name: 'New' };
    const audit = installAudit(t);
    const calls = stubInventory(t, {
        applyProductCatalogOptions: () => {},
        ensureUniqueBarcode: (barcode) => `${barcode}-u`,
        normalizeLocation: (location) => String(location).toUpperCase(),
        resolveProductFamily: () => 'fam1',
    });
    const tracked = productEditConnection(t, { previous, updated });

    const result = await runHandler(controller.updateProduct, {
        params: { id: 'p1' },
        body: {
            name: 'New',
            cost_price: 12,
            stock_initial: 500,
            barcode: '779',
            location: 'a-1',
            image_url: ' https://cdn.example.com/a.png ',
            family_name: 'Familia'
        },
        user: { id: 'u1' }
    });

    assert.deepEqual(result.body, updated);
    // The same cost (sent as cost_price) changes nothing and needs no permission.
    assert.deepEqual(updateColumns(tracked.calls), {
        name: 'New',
        barcode: '779-u',
        location: 'A-1',
        image_url: 'https://cdn.example.com/a.png',
        family_id: 'fam1'
    });
    assert.equal(updateColumns(tracked.calls, 1), null);
    assert.deepEqual(calls.resolveProductFamily[0][0], 'Familia');
    assert.equal(calls.resolveProductFamily[0][1].name, 'New');
    assert.equal(calls.ensureUniqueBarcode[0][2], tracked.connection, 'checked inside the transaction');
    assert.equal(audit[0].action, 'UPDATE_PRODUCT');
    assert.deepEqual(audit[0].old_values, previous);
    assert.deepEqual(audit[0].new_values, updated);
    assert.equal(audit.some(({ action }) => action === 'REVALUE_STOCK'), false, 'the same cost revalues nothing');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('updateProduct with a new cost on goods in stock revalues them with an entry, stock locked before the product', async (t) => {
    const audit = installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    const entries = captureEntries(t);
    // Mermas carries no value (D3): its units are not revalued.
    const tracked = productEditConnection(t, {
        previous: { id: 'p1', name: 'Pelota', purchase_price: '500.00' },
        stock: [4, { location: 'Cuarentena', quantity: 3 }, { location: 'Mermas', quantity: 9 }],
    });

    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: '600,004'.replace(',', '.') }, user: manager });

    const order = tracked.calls.map(({ statement }) => statement);
    assert.ok(order.indexOf(STOCK_LOCK) >= 0 && order.indexOf(STOCK_LOCK) < order.indexOf(PRODUCT_LOCK), 'stock (L3) before the product (L4)');
    assert.deepEqual(updateColumns(tracked.calls), { purchase_price: 600 }, 'cents, as the column keeps it; no price to follow');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].reference_type, 'stock_revaluation');
    assert.deepEqual(entryLines(entries[0]), [
        ['1.1.04.01', 700, 0],
        ['4.2.02.01', 0, 700],
    ]);
    assert.match(entries[0].description, /Revaluación de stock de Pelota: 7 u\. de costo \$500 a \$600/);
    const revalued = audit.find(({ action }) => action === 'REVALUE_STOCK');
    assert.deepEqual(revalued.new_values, {
        cost: 600, quantity: 7, amount: 700, journal_entry_id: 'je-1', source: 'product_edit', counter_account: '4.2.02.01',
    });
});

test('updateProduct: a lower cost is a holding loss; no stock, no entry', async (t) => {
    installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    const entries = captureEntries(t);
    productEditConnection(t, { previous: { id: 'p1', name: 'Pelota', purchase_price: '500.00' }, stock: [2] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 450 }, user: manager });
    assert.deepEqual(entryLines(entries[0]), [
        ['4.2.02.01', 100, 0],
        ['1.1.04.01', 0, 100],
    ]);

    entries.length = 0;
    productEditConnection(t, { previous: { id: 'p1', name: 'Pelota', purchase_price: '500.00' }, stock: [] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 450 }, user: manager });
    assert.equal(entries.length, 0);
});

test('updateProduct: a cost loaded on stock that had none is an opening adjustment, not a gain (D6)', async (t) => {
    installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    const entries = captureEntries(t);
    productEditConnection(t, { previous: { id: 'p1', name: 'Pelota', purchase_price: '0.00', cost_price: '0.00' }, stock: [5] });

    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 80 }, user: { id: 'a', role: 'admin' } });

    assert.deepEqual(entryLines(entries[0]), [
        ['1.1.04.01', 400, 0],
        ['3.1.03.01', 0, 400],
    ]);
});

test('updateProduct: only a manager or an admin changes the cost or its policy (D5); the stored cost resent is no change', async (t) => {
    const audit = installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    const entries = captureEntries(t);
    const previous = { id: 'p1', name: 'Pelota', purchase_price: '500.00', auto_update_cost: 1 };

    const tracked = productEditConnection(t, { previous, stock: [2] });
    const refused = await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 520 }, user: { id: 'w', role: 'warehouse' } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'cost_edit_not_allowed');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(updateColumns(tracked.calls), null);

    productEditConnection(t, { previous, stock: [2] });
    const policy = await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { auto_update_cost: false }, user: { id: 'w', role: 'warehouse' } });
    assert.equal(policy.status, 403);

    // A product whose cost still lives in cost_price shows it in the form: sending it back is no change.
    const legacy = productEditConnection(t, { previous: { id: 'p1', name: 'Pelota', purchase_price: '0.00', cost_price: '450.00' }, stock: [2] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 450, name: 'Pelota', auto_update_price: true }, user: { id: 'w', role: 'warehouse' } });
    assert.deepEqual(updateColumns(legacy.calls), { name: 'Pelota', auto_update_price: 1 });
    assert.equal(updateColumns(legacy.calls, 1), null);
    assert.equal(entries.length, 0);
    assert.equal(audit.some(({ action }) => action === 'REVALUE_STOCK'), false);
});

test('updateProduct: the sale price follows a new cost keeping the markup, unless typed or turned off (D1)', async (t) => {
    installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    captureEntries(t);
    // Net 1000 at 21 % is 1210 final; cost 500 → 600 moves the final price to 1452 (net 1200).
    const previous = { id: 'p1', name: 'Pelota', purchase_price: '500.00', sale_price: '1000.0000', vat_rate: 21, auto_update_price: 1 };

    const follows = productEditConnection(t, { previous, stock: [1] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 600, sale_price: 1000 }, user: manager });
    assert.deepEqual(updateColumns(follows.calls, 1), { purchase_price: 600, sale_price: 1200 });

    const typed = productEditConnection(t, { previous, stock: [1] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 600, sale_price: 1100 }, user: manager });
    assert.deepEqual(updateColumns(typed.calls), { sale_price: 1100 });
    assert.deepEqual(updateColumns(typed.calls, 1), { purchase_price: 600 }, 'a price typed with the cost wins');

    const off = productEditConnection(t, { previous, stock: [1] });
    await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { purchase_price: 600, auto_update_price: false }, user: manager });
    assert.deepEqual(updateColumns(off.calls), { auto_update_price: 0 });
    assert.deepEqual(updateColumns(off.calls, 1), { purchase_price: 600 }, 'turned off in the same save: the price stays');
});

test('updateProduct: unknown product answers null and rolls back; a deadlock answers 409 busy', async (t) => {
    const audit = installAudit(t);
    stubInventory(t, { applyProductCatalogOptions: () => {} });
    const missing = productEditConnection(t, { previous: null });
    const result = await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { name: 'N' } });
    assert.equal(result.body, null);
    assert.deepEqual(missing.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(audit.length, 0, 'nothing updated, nothing audited');

    productEditConnection(t, {
        previous: { id: 'p1' },
        failOn: { statement: 'UPDATE products SET', error: Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }) },
    });
    const busy = await runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { name: 'N' } });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error, 'busy');
});

test('updateProduct rejects data-URL images before touching the database', async (t) => {
    installPool(t, {});
    await assert.rejects(
        runHandler(controller.updateProduct, { params: { id: 'p1' }, body: { image_url: 'data:image/png;base64,AAAA' } }),
        (error) => error.statusCode === 400 && error.errorCode === 'DATA_URL_NOT_ALLOWED'
    );
});

test('deleteProduct audits only when the product existed', async (t) => {
    const audit = installAudit(t);
    let previous = { id: 'p1' };
    stubInventory(t, { findById: () => previous, delete: () => ({ success: true }) });

    const deleted = await runHandler(controller.deleteProduct, { params: { id: 'p1' }, user: { id: 'u1' } });
    assert.deepEqual(deleted.body, { success: true });
    assert.equal(audit[0].action, 'DELETE_PRODUCT');
    assert.deepEqual(audit[0].old_values, { id: 'p1' });

    previous = null;
    await runHandler(controller.deleteProduct, { params: { id: 'ghost' } });
    assert.equal(audit.length, 1);
});

// ------------------------------------------------------ Image upload

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

function stubFs(t) {
    const writes = [];
    const mkdirs = [];
    const previousMkdir = fs.mkdir;
    const previousWrite = fs.writeFile;
    fs.mkdir = async (...args) => {
        mkdirs.push(args);
    };
    fs.writeFile = async (...args) => {
        writes.push(args);
    };
    t.after(() => {
        fs.mkdir = previousMkdir;
        fs.writeFile = previousWrite;
    });
    return { writes, mkdirs };
}

test('uploadProductImage stores a validated image with exclusive-create and returns a public URL', async (t) => {
    const { writes, mkdirs } = stubFs(t);
    const result = await runHandler(controller.uploadProductImage, {
        body: { data_url: PNG_DATA_URL },
        headers: { 'x-forwarded-proto': 'https, http' },
        protocol: 'http',
        get: (name) => (name === 'host' ? 'erp.example.com' : undefined)
    });

    assert.equal(result.status, 201);
    assert.match(result.body.image_url, /^https:\/\/erp\.example\.com\/uploads\/products\/[0-9a-f-]{36}\.png$/);
    assert.equal(mkdirs[0][1].recursive, true);
    assert.equal(writes[0][2].flag, 'wx');
    assert.equal(writes[0][1].toString(), 'fake-png-bytes');
    assert.match(writes[0][0], /uploads[\\/]products[\\/][0-9a-f-]{36}\.png$/);
});

test('uploadProductImage falls back to req.protocol and a default host', async (t) => {
    stubFs(t);
    const withProtocol = await runHandler(controller.uploadProductImage, {
        body: { data_url: PNG_DATA_URL },
        protocol: 'https',
        get: () => 'shop.example.com'
    });
    assert.match(withProtocol.body.image_url, /^https:\/\/shop\.example\.com\//);

    const defaults = await runHandler(controller.uploadProductImage, {
        body: { data_url: PNG_DATA_URL },
        get: () => undefined
    });
    assert.match(defaults.body.image_url, /^http:\/\/localhost:3001\/uploads\/products\//);
});

test('uploadProductImage rejects non-image or malformed payloads without writing files', async (t) => {
    const { writes } = stubFs(t);
    for (const data_url of [undefined, 42, 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,', 'https://evil.example.com/x.png']) {
        await assert.rejects(
            runHandler(controller.uploadProductImage, { body: { data_url } }),
            (error) => error.statusCode === 400
        );
    }
    await assert.rejects(
        runHandler(controller.uploadProductImage, { body: undefined }),
        (error) => error.statusCode === 400
    );
    assert.equal(writes.length, 0);
});

// ----------------------------------------------------- Batches / serials

test('createBatch and createSerialNumber audit the created record', async (t) => {
    const audit = installAudit(t);
    stubInventory(t, {
        createBatch: () => ({ id: 'b1' }),
        createSerialNumber: () => ({ id: 's1' })
    });
    const batch = await runHandler(controller.createBatch, { body: { product_id: 'p1', qty: 2 }, user: { id: 'u1' } });
    assert.deepEqual(batch.body, { id: 'b1' });
    assert.equal(audit[0].action, 'CREATE_BATCH');
    assert.deepEqual(audit[0].new_values, { id: 'b1', product_id: 'p1', qty: 2 });

    const serial = await runHandler(controller.createSerialNumber, { body: { serial: 'X' } });
    assert.deepEqual(serial.body, { id: 's1' });
    assert.equal(audit[1].action, 'CREATE_SERIAL_NUMBER');
    assert.equal(audit[1].user_id, null);
});

test('updateBatch and updateSerialNumber audit only when a record was updated', async (t) => {
    const audit = installAudit(t);
    let batchResult = { id: 'b1' };
    let serialResult = { id: 's1' };
    stubInventory(t, {
        updateBatch: () => batchResult,
        updateSerialNumber: () => serialResult
    });

    await runHandler(controller.updateBatch, { params: { id: 'b1' }, body: { qty: 1 } });
    await runHandler(controller.updateSerialNumber, { params: { id: 's1' }, body: { status: 'sold' } });
    assert.deepEqual(audit.map((entry) => entry.action), ['UPDATE_BATCH', 'UPDATE_SERIAL_NUMBER']);

    batchResult = null;
    serialResult = null;
    const batch = await runHandler(controller.updateBatch, { params: { id: 'zz' }, body: {} });
    const serial = await runHandler(controller.updateSerialNumber, { params: { id: 'zz' }, body: {} });
    assert.equal(batch.body, null);
    assert.equal(serial.body, null);
    assert.equal(audit.length, 2);
});

// -------------------------------------------------- Warehouse locations

test('getWarehouseLocations coerces numeric aggregates and booleans', async (t) => {
    installPool(t, {
        poolQuery: async () => [[
            { id: 'l1', code: 'A', active: 1, is_sales_floor: 1, sku_count: '3', total_quantity: '12.5' },
            { id: 'l2', code: 'B', active: 0, sku_count: null, total_quantity: null }
        ]]
    });
    const result = await runHandler(controller.getWarehouseLocations);
    // ADR-015: is_sales_floor también se devuelve como boolean (ausente => false).
    assert.deepEqual(result.body, [
        { id: 'l1', code: 'A', active: true, is_sales_floor: true, sku_count: 3, total_quantity: 12.5 },
        { id: 'l2', code: 'B', active: false, is_sales_floor: false, sku_count: 0, total_quantity: 0 }
    ]);
});

test('createWarehouseLocation validates input, trims fields and audits', async (t) => {
    const calls = installPool(t, {
        poolQuery: async (statement) => (statement.startsWith('INSERT') ? [{}] : [[{ id: 'l1', code: 'A-1' }]])
    });
    const audit = installAudit(t);

    const invalid = await runHandler(controller.createWarehouseLocation, { body: { code: '   ' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'invalid_location');
    const noBody = await runHandler(controller.createWarehouseLocation, { body: undefined });
    assert.equal(noBody.status, 400);
    assert.equal(calls.length, 0);

    const created = await runHandler(controller.createWarehouseLocation, {
        body: { code: ' A-1 ', description: '  Pasillo  ' },
        user: { id: 'u1' }
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id: 'l1', code: 'A-1' });
    const [, code, name, description, createdBy] = calls[0].params;
    assert.deepEqual([code, name, description, createdBy], ['A-1', 'A-1', 'Pasillo', 'u1']);
    assert.equal(audit[0].action, 'CREATE_WAREHOUSE_LOCATION');

    await runHandler(controller.createWarehouseLocation, { body: { code: 'B', name: 'Bodega', description: '  ' } });
    const second = calls.find((call) => call.params[1] === 'B');
    assert.deepEqual(second.params.slice(2, 5), ['Bodega', null, null]);
});

test('createWarehouseLocation maps duplicate codes to 409 and rethrows other errors', async (t) => {
    let failure = dupError();
    installPool(t, {
        poolQuery: async () => {
            throw failure;
        }
    });
    const dup = await runHandler(controller.createWarehouseLocation, { body: { code: 'A' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'duplicate_location');
    failure = new Error('conn lost');
    await assert.rejects(runHandler(controller.createWarehouseLocation, { body: { code: 'A' } }), /conn lost/);
});

// updateLocation runs in a transaction: the location pool answers on a tracked connection.
function installLocationPool(t, query) {
    const tracked = createTrackedConnection(query);
    installPool(t, { tracked });
    return tracked.calls;
}

function locationPool({ existing, usage = 0, updateError } = {}) {
    return async (statement) => {
        if (statement === 'SELECT * FROM warehouse_locations WHERE id = ? FOR UPDATE' || statement === 'SELECT * FROM warehouse_locations WHERE id = ?') {
            return [existing ? [existing] : []];
        }
        if (statement.includes('AS usage_count')) return [[{ usage_count: usage }]];
        if (statement.startsWith('UPDATE warehouse_locations')) {
            if (updateError) throw updateError;
            return [{}];
        }
        throw new Error(`Unexpected SQL: ${statement}`);
    };
}

test('updateWarehouseLocation answers 404 for unknown ids and 400 for blank code or name', async (t) => {
    installAudit(t);
    installLocationPool(t, locationPool({ existing: null }));
    const missing = await runHandler(controller.updateWarehouseLocation, { params: { id: 'x' }, body: {} });
    assert.equal(missing.status, 404);

    installLocationPool(t, locationPool({ existing: { id: 'l1', code: 'A', name: 'Alpha', description: null, active: 1 } }));
    const blank = await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { code: ' ' } });
    assert.equal(blank.status, 400);
    const blankName = await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { name: '' } });
    assert.equal(blankName.status, 400);
    const noBody = await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: undefined });
    assert.equal(noBody.status, 200);
});

test('updateWarehouseLocation blocks code changes while stock or products use the location', async (t) => {
    const calls = installLocationPool(t, locationPool({ existing: { id: 'l1', code: 'A', name: 'Alpha', description: null, active: 1 }, usage: '2' }));
    const result = await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { code: 'Z' } });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'location_in_use');
    assert.deepEqual(calls.find((call) => call.statement.includes('AS usage_count')).params, ['A', 'A']);
    assert.equal(calls.some((call) => call.statement.startsWith('UPDATE')), false);
});

test('updateWarehouseLocation allows renaming codes of unused locations and edits other fields freely', async (t) => {
    const existing = { id: 'l1', code: 'A', name: 'Alpha', description: 'old', active: 1 };
    const calls = installLocationPool(t, locationPool({ existing, usage: 0 }));
    const audit = installAudit(t);

    const renamed = await runHandler(controller.updateWarehouseLocation, {
        params: { id: 'l1' },
        body: { code: 'Z', description: '  ', active: false },
        user: { id: 'u1' }
    });
    assert.equal(renamed.status, 200);
    const update = calls.find((call) => call.statement.startsWith('UPDATE'));
    assert.deepEqual(update.params, ['Z', 'Alpha', null, false, false, 'l1']);
    assert.equal(audit[0].action, 'UPDATE_WAREHOUSE_LOCATION');

    calls.length = 0;
    await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { name: 'Beta', description: 'new' } });
    assert.equal(calls.some((call) => call.statement.includes('AS usage_count')), false, 'no usage check if code is unchanged');
    const second = calls.find((call) => call.statement.startsWith('UPDATE'));
    assert.deepEqual(second.params, ['A', 'Beta', 'new', true, false, 'l1']);

    calls.length = 0;
    await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { is_sales_floor: true } });
    const third = calls.find((call) => call.statement.startsWith('UPDATE'));
    assert.deepEqual(third.params, ['A', 'Alpha', 'old', true, true, 'l1']);
});

test('updateWarehouseLocation maps duplicates to 409 and rethrows other DB errors', async (t) => {
    const existing = { id: 'l1', code: 'A', name: 'Alpha', description: null, active: 1 };
    installLocationPool(t, locationPool({ existing, updateError: dupError() }));
    const dup = await runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { name: 'B' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'duplicate_location');

    installLocationPool(t, locationPool({ existing, updateError: new Error('io') }));
    await assert.rejects(runHandler(controller.updateWarehouseLocation, { params: { id: 'l1' }, body: { name: 'B' } }), /io/);
});
