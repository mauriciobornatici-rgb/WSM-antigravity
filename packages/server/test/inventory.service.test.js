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
            stock_initial: 7
        },
        'user-1'
    );

    assert.ok(result.id);
    assert.ok(createdPayload?.id);
    assert.equal(createdPayload.stock_initial, undefined);
    assert.equal(createdPayload.barcode, '7790001112223');
    assert.equal(createdPayload.location, 'A-01');

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

