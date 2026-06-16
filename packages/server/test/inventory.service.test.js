import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import inventoryService from '../services/inventory.service.js';

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
    auditService.log = async (payload) => {
        auditPayload = payload;
    };

    t.after(() => {
        inventoryService.create = originalCreate;
        inventoryService.ensureUniqueBarcode = originalEnsureUniqueBarcode;
        pool.query = originalPoolQuery;
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
            if (sql.includes('SELECT id FROM inventory')) {
                return [[{ id: 'inv-row-1' }]];
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
