import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import inventoryService from '../services/inventory.service.js';
import accountingService from '../services/accounting.service.js';

test('ensureUniqueBarcode returns normalized barcode when no duplicate exists', async () => {
    const connection = {
        async query() {
            return [[]];
        }
    };

    const result = await inventoryService.ensureUniqueBarcode('  7791234567890  ', null, connection);
    assert.equal(result, '7791234567890');
});

test('ensureUniqueBarcode throws 409 when barcode already exists', async () => {
    const connection = {
        async query() {
            return [[{ id: 'existing-product' }]];
        }
    };

    await assert.rejects(
        () => inventoryService.ensureUniqueBarcode('7791234567890', null, connection),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'DUPLICATE_BARCODE');
            return true;
        }
    );
});

test('resolveProductFamily reuses an existing family for a size/color variant', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            calls.push({ sql: String(sql), params });
            return [[{ id: 'family-1' }]];
        }
    };

    const result = await inventoryService.resolveProductFamily(null, {
        name: 'Remera Essential',
        brand: 'WSM',
        category: 'Ropa',
        size: 'M',
        color: 'Azul'
    }, connection);

    assert.equal(result, 'family-1');
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /FROM product_families/i);
    assert.deepEqual(calls[0].params, ['Remera Essential', 'WSM', 'Ropa']);
});

test('resolveProductFamily leaves a standalone product ungrouped', async () => {
    let queryCalled = false;
    const connection = {
        async query() {
            queryCalled = true;
            return [[]];
        }
    };

    const result = await inventoryService.resolveProductFamily(null, {
        name: 'Pelota Oficial',
        category: 'Accesorios'
    }, connection);

    assert.equal(result, null);
    assert.equal(queryCalled, false);
});

test('applyProductCatalogOptions derives canonical product values from master ids', async () => {
    const productData = {
        category_option_id: 'group-1',
        subcategory_option_id: 'subgroup-1',
        color_option_id: 'color-1'
    };
    const connection = {
        async query() {
            return [[
                { id: 'group-1', type: 'group', name: 'Ropa', parent_id: null },
                { id: 'subgroup-1', type: 'subgroup', name: 'Remeras', parent_id: 'group-1' },
                { id: 'color-1', type: 'color', name: 'Azul marino', parent_id: null }
            ]];
        }
    };

    await inventoryService.applyProductCatalogOptions(productData, {}, connection);

    assert.equal(productData.category, 'Ropa');
    assert.equal(productData.subcategory, 'Remeras');
    assert.equal(productData.color, 'Azul marino');
});

test('applyProductCatalogOptions rejects a subgroup outside the selected group', async () => {
    const connection = {
        async query() {
            return [[
                { id: 'group-1', type: 'group', name: 'Ropa', parent_id: null },
                { id: 'subgroup-1', type: 'subgroup', name: 'Pelotas', parent_id: 'group-2' }
            ]];
        }
    };

    await assert.rejects(
        () => inventoryService.applyProductCatalogOptions({
            category_option_id: 'group-1',
            subcategory_option_id: 'subgroup-1'
        }, {}, connection),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.match(error.message, /no pertenece/i);
            return true;
        }
    );
});

test('applyProductCatalogOptions supports no-op and explicit option clearing', async () => {
    let queries = 0;
    const connection = { query: async () => { queries += 1; return [[]]; } };
    const unchanged = { name: 'Pelota' };
    assert.equal(await inventoryService.applyProductCatalogOptions(unchanged, {}, connection), unchanged);

    const cleared = {
        category_option_id: '',
        subcategory_option_id: undefined,
        brand_option_id: null,
        size_option_id: '',
        color_option_id: null,
    };
    await inventoryService.applyProductCatalogOptions(cleared, {}, connection);
    assert.equal(queries, 0);
    assert.deepEqual(cleared, {
        category_option_id: null, category: null,
        subcategory_option_id: null, subcategory: null,
        brand_option_id: null, brand: null,
        size_option_id: null, size: null,
        color_option_id: null, color: null,
    });
});

test('applyProductCatalogOptions rejects missing and wrong-type catalog values', async () => {
    const missingConnection = { query: async () => [[]] };
    await assert.rejects(
        () => inventoryService.applyProductCatalogOptions({ brand_option_id: 'missing' }, {}, missingConnection),
        (error) => error.statusCode === 400 && /brand/.test(error.message)
    );

    const wrongTypeConnection = {
        query: async () => [[{ id: 'size-1', type: 'color', name: 'Azul', parent_id: null }]],
    };
    await assert.rejects(
        () => inventoryService.applyProductCatalogOptions({ size_option_id: 'size-1' }, {}, wrongTypeConnection),
        (error) => error.statusCode === 400 && /size/.test(error.message)
    );
});

test('applyProductCatalogOptions validates an inherited subgroup against the current group', async () => {
    const calls = [];
    const connection = {
        async query(sql) {
            calls.push(String(sql));
            if (String(sql).includes("type = 'subgroup'")) {
                return [[{ id: 'subgroup-1', type: 'subgroup', name: 'Remeras', parent_id: 'group-1' }]];
            }
            return [[{ id: 'group-1', type: 'group', name: 'Ropa', parent_id: null }]];
        },
    };
    const product = { category_option_id: 'group-1' };
    await inventoryService.applyProductCatalogOptions(product, { subcategory_option_id: 'subgroup-1' }, connection);
    assert.equal(product.category, 'Ropa');
    assert.ok(calls.some((sql) => sql.includes("type = 'subgroup'")));
});

test('resolveProductFamily refreshes existing images and creates deterministic families safely', async () => {
    const existingCalls = [];
    const existingConnection = {
        async query(sql, params) {
            existingCalls.push({ sql: String(sql), params });
            if (String(sql).includes('FROM product_families')) return [[{ id: 'family-existing' }]];
            return [{ affectedRows: 1 }];
        },
    };
    assert.equal(await inventoryService.resolveProductFamily(' Línea Running ', {
        image_url: 'https://cdn.example/family.jpg',
    }, existingConnection), 'family-existing');
    assert.ok(existingCalls.some(({ sql }) => sql.startsWith('UPDATE product_families')));

    let resolvedId = null;
    const creationCalls = [];
    const creationConnection = {
        async query(sql, params) {
            const statement = String(sql).trim();
            creationCalls.push({ sql: statement, params });
            if (statement.includes('LOWER(TRIM(name))')) return [[]];
            if (statement.startsWith('INSERT INTO product_families')) return [{ affectedRows: 1 }];
            if (statement.startsWith('SELECT id FROM product_families WHERE family_key')) {
                return [resolvedId ? [{ id: resolvedId }] : []];
            }
            return [[]];
        },
    };
    const generatedId = await inventoryService.resolveProductFamily(' Remera   Técnica ', {
        brand: ' WSM ', category: ' Ropa ', color: ' Negro ', image_url: null,
    }, creationConnection);
    assert.match(generatedId, /^[0-9a-f-]{36}$/i);
    const firstInsert = creationCalls.find(({ sql }) => sql.startsWith('INSERT INTO product_families'));
    assert.equal(firstInsert.params[2], 'Remera Técnica');
    assert.equal(firstInsert.params[3], 'WSM');

    resolvedId = 'family-won-by-concurrent-request';
    assert.equal(await inventoryService.resolveProductFamily('Remera Técnica', {
        brand: 'WSM', category: 'Ropa', size: 'M',
    }, creationConnection), resolvedId);
});

test('barcode checks handle empty values and exclusion during product edits', async () => {
    let captured;
    const connection = { query: async (sql, params) => { captured = { sql, params }; return [[]]; } };
    assert.equal(await inventoryService.ensureUniqueBarcode(' ', null, connection), null);
    assert.equal(await inventoryService.ensureUniqueBarcode('779', 'product-1', connection), '779');
    assert.match(captured.sql, /id <> \?/);
    assert.deepEqual(captured.params, ['779', 'product-1']);
});

test('createProduct persists initial stock and inventory movement when stock_initial is positive', async (t) => {
    const originalCreate = inventoryService.create;
    const originalEnsureUniqueBarcode = inventoryService.ensureUniqueBarcode;
    const originalPoolQuery = pool.query;
    const originalAuditLog = auditService.log;

    const poolCalls = [];
    let createdPayload = null;
    let auditPayload = null;

    inventoryService.create = async (data) => {
        createdPayload = data;
        return { id: data.id, ...data };
    };
    inventoryService.ensureUniqueBarcode = async (barcode) => inventoryService.normalizeBarcode(barcode);
    pool.query = async (sql, params) => {
        poolCalls.push({ sql: String(sql), params });
        return [[]];
    };
    // ADR-017: the opening stock is written in one transaction, with its ledger entry.
    const originalGetConnection = pool.getConnection;
    const lifecycle = [];
    pool.getConnection = async () => ({
        beginTransaction: async () => { lifecycle.push('begin'); },
        commit: async () => { lifecycle.push('commit'); },
        rollback: async () => { lifecycle.push('rollback'); },
        release: () => { lifecycle.push('release'); },
        query: pool.query,
    });
    const originalInitialStock = accountingService.postInitialStock;
    let initialStock = null;
    accountingService.postInitialStock = async (_connection, payload) => { initialStock = payload; };
    auditService.log = async (payload) => {
        auditPayload = payload;
    };

    t.after(() => {
        inventoryService.create = originalCreate;
        inventoryService.ensureUniqueBarcode = originalEnsureUniqueBarcode;
        pool.query = originalPoolQuery;
        pool.getConnection = originalGetConnection;
        accountingService.postInitialStock = originalInitialStock;
        auditService.log = originalAuditLog;
    });

    const result = await inventoryService.createProduct(
        {
            name: 'Pelota Oficial',
            sku: 'PEL-001',
            purchase_price: 100,
            sale_price: 150,
            location: 'A-01',
            barcode: '  7790001112223 ',
            image_url: ' https://cdn.example.com/pelota.jpg ',
            stock_initial: 7
        },
        'user-1'
    );

    assert.ok(result.id);
    assert.ok(createdPayload?.id);
    assert.equal(createdPayload.stock_initial, undefined);
    assert.equal(createdPayload.barcode, '7790001112223');
    assert.equal(createdPayload.location, 'A-01');
    assert.equal(createdPayload.image_url, 'https://cdn.example.com/pelota.jpg');

    assert.equal(poolCalls.length, 2);
    assert.match(poolCalls[0].sql, /INSERT INTO inventory/i);
    assert.equal(poolCalls[0].params[1], createdPayload.id);
    assert.equal(poolCalls[0].params[2], 'A-01');
    assert.equal(poolCalls[0].params[3], 7);

    assert.match(poolCalls[1].sql, /INSERT INTO inventory_movements/i);
    assert.equal(poolCalls[1].params[1], createdPayload.id);
    assert.equal(poolCalls[1].params[2], 'A-01');
    assert.equal(poolCalls[1].params[3], 7);

    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    assert.deepEqual(initialStock, { productId: createdPayload.id, quantity: 7, unitCost: 100, description: 'Stock inicial de Pelota Oficial' });
    assert.equal(createdPayload.origin, 'erp');

    assert.equal(auditPayload?.action, 'CREATE_PRODUCT');
    assert.equal(auditPayload?.new_values?.stock_initial, 7);
});

test('createProduct rejects data URL image payloads with 400', async (t) => {
    const originalCreate = inventoryService.create;
    const originalEnsureUniqueBarcode = inventoryService.ensureUniqueBarcode;

    let createCalled = false;
    inventoryService.create = async () => {
        createCalled = true;
        return { id: 'unexpected' };
    };
    inventoryService.ensureUniqueBarcode = async (barcode) => inventoryService.normalizeBarcode(barcode);

    t.after(() => {
        inventoryService.create = originalCreate;
        inventoryService.ensureUniqueBarcode = originalEnsureUniqueBarcode;
    });

    await assert.rejects(
        () => inventoryService.createProduct(
            {
                name: 'Pelota Oficial',
                sku: 'PEL-001',
                purchase_price: 100,
                sale_price: 150,
                image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA'
            },
            'user-1'
        ),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.errorCode, 'DATA_URL_NOT_ALLOWED');
            return true;
        }
    );

    assert.equal(createCalled, false);
});

test('createProduct converts legacy cost and safely ignores malformed initial stock', async (t) => {
    const originalCreate = inventoryService.create;
    const originalEnsureUniqueBarcode = inventoryService.ensureUniqueBarcode;
    const originalResolveFamily = inventoryService.resolveProductFamily;
    const originalPoolQuery = pool.query;
    const originalAuditLog = auditService.log;
    let created;
    let audited;
    let inventoryWrites = 0;

    inventoryService.create = async (data) => { created = data; return data; };
    inventoryService.ensureUniqueBarcode = async () => null;
    inventoryService.resolveProductFamily = async () => null;
    pool.query = async () => { inventoryWrites += 1; return [[]]; };
    auditService.log = async (payload) => { audited = payload; };
    t.after(() => {
        inventoryService.create = originalCreate;
        inventoryService.ensureUniqueBarcode = originalEnsureUniqueBarcode;
        inventoryService.resolveProductFamily = originalResolveFamily;
        pool.query = originalPoolQuery;
        auditService.log = originalAuditLog;
    });

    await inventoryService.createProduct({
        name: 'Producto legado', cost_price: '125.50', stock_initial: 'invalido', location: '',
    }, null);
    assert.equal(created.purchase_price, 125.5, 'the legacy cost, in cents as the column keeps it');
    assert.equal(created.cost_price, 125.5, 'one cost: cost_price mirrors it (ADR-027)');
    assert.equal(created.location, null);
    assert.equal(inventoryWrites, 0);
    assert.equal(audited.new_values.stock_initial, 0);
});

test('processReceptionApproval throws RECEPTION_NOT_FOUND when reception does not exist', async (t) => {
    const originalGetConnection = pool.getConnection;
    
    const mockConnection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql) => {
            if (sql.includes('SELECT * FROM receptions')) {
                return [[]];
            }
            return [[]];
        }
    };
    
    pool.getConnection = async () => mockConnection;
    
    t.after(() => {
        pool.getConnection = originalGetConnection;
    });

    await assert.rejects(
        () => inventoryService.processReceptionApproval('non-existing-id'),
        (err) => {
            assert.equal(err.errorCode, 'RECEPTION_NOT_FOUND');
            return true;
        }
    );
});

test('processReceptionApproval throws RECEPTION_ALREADY_APPROVED when status is approved', async (t) => {
    const originalGetConnection = pool.getConnection;
    
    const mockConnection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql) => {
            if (sql.includes('SELECT * FROM receptions')) {
                return [[{ id: 'reception-id', status: 'approved' }]];
            }
            return [[]];
        }
    };
    
    pool.getConnection = async () => mockConnection;
    
    t.after(() => {
        pool.getConnection = originalGetConnection;
    });

    await assert.rejects(
        () => inventoryService.processReceptionApproval('reception-id'),
        (err) => {
            assert.equal(err.errorCode, 'RECEPTION_ALREADY_APPROVED');
            return true;
        }
    );
});

test('processReceptionApproval throws RECEPTION_HAS_NO_ITEMS when items list is empty', async (t) => {
    const originalGetConnection = pool.getConnection;
    
    const mockConnection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql) => {
            if (sql.includes('SELECT * FROM receptions')) {
                return [[{ id: 'reception-id', status: 'draft' }]];
            }
            if (sql.includes('SELECT * FROM reception_items')) {
                return [[]];
            }
            return [[]];
        }
    };
    
    pool.getConnection = async () => mockConnection;
    
    t.after(() => {
        pool.getConnection = originalGetConnection;
    });

    await assert.rejects(
        () => inventoryService.processReceptionApproval('reception-id'),
        (err) => {
            assert.equal(err.errorCode, 'RECEPTION_HAS_NO_ITEMS');
            return true;
        }
    );
});

test('processReceptionApproval successfully approves reception, updates stock, updates PO status', async (t) => {
    const originalGetConnection = pool.getConnection;
    
    const queryCalls = [];
    const mockConnection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params) => {
            queryCalls.push({ sql, params });
            if (sql.includes('SELECT * FROM receptions')) {
                return [[{ id: 'reception-1', status: 'draft', supplier_id: 'supplier-1', purchase_order_id: 'po-1' }]];
            }
            if (sql.includes('SELECT * FROM reception_items')) {
                return [[{
                    id: 'item-1',
                    product_id: 'product-1',
                    quantity_received: 10,
                    unit_cost: 50,
                    po_item_id: 'po-item-1',
                    location_assigned: 'Depot-A'
                }]];
            }
            if (sql.includes('FROM quality_checks')) {
                return [[{
                    quantity_checked: 10,
                    quantity_passed: 10,
                    quantity_failed: 0,
                    defect_description: null
                }]];
            }
            // ADR-027: the stock rows (L3), then the product with its cost (L4).
            if (sql.includes('reserved_quantity') && sql.includes('FROM inventory')) {
                return [[{ id: 'inv-row-1', product_id: 'product-1', location: 'Depot-A', quantity: 5, reserved_quantity: 0 }]];
            }
            if (sql.includes('auto_update_cost')) return [[{ id: 'product-1', purchase_price: 50 }]];
            if (sql.includes('FROM purchase_order_items WHERE id IN')) {
                return [[{ id: 'po-item-1', quantity_ordered: 20, quantity_received: 10 }]];
            }
            if (sql.includes('quantity_ordered') && sql.includes('purchase_order_items')) {
                return [[{ ordered_qty: 20, received_qty: 20 }]];
            }
            return [[]];
        }
    };
    
    pool.getConnection = async () => mockConnection;
    
    t.after(() => {
        pool.getConnection = originalGetConnection;
    });

    const result = await inventoryService.processReceptionApproval('reception-1', { approvedBy: 'user-1', actorUserId: 'user-1' });
    
    assert.deepEqual(result, { success: true });
    
    const updates = queryCalls.filter(c => c.sql.includes('UPDATE'));
    const inserts = queryCalls.filter(c => c.sql.includes('INSERT'));
    
    assert.ok(inserts.some(c => c.sql.includes('INSERT INTO inventory_movements')));
    assert.ok(updates.some(c => c.sql.includes('UPDATE inventory SET quantity = quantity + ?')));
    assert.ok(updates.some(c => c.sql.includes('UPDATE purchase_order_items SET quantity_received = quantity_received + ?')));
    assert.ok(updates.some(c => c.sql.includes('UPDATE purchase_orders SET status = ?')));
});

test('processReceptionApproval rejects receptions without a complete quality check', async (t) => {
    const originalGetConnection = pool.getConnection;
    let rolledBack = false;
    const mockConnection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => { rolledBack = true; },
        release: () => {},
        query: async (sql) => {
            if (sql.includes('SELECT * FROM receptions')) {
                return [[{ id: 'reception-1', status: 'pending_qc', supplier_id: 'supplier-1' }]];
            }
            if (sql.includes('SELECT * FROM reception_items')) {
                return [[{ id: 'item-1', product_id: 'product-1', quantity_received: 4, unit_cost: 9 }]];
            }
            if (sql.includes('FROM quality_checks')) return [[]];
            return [[]];
        }
    };
    pool.getConnection = async () => mockConnection;
    t.after(() => { pool.getConnection = originalGetConnection; });

    await assert.rejects(
        () => inventoryService.processReceptionApproval('reception-1'),
        (error) => error.errorCode === 'RECEPTION_QC_INCOMPLETE' && error.statusCode === 409
    );
    assert.equal(rolledBack, true);
});
