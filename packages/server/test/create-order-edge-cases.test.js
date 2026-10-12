import test from 'node:test';
import assert from 'node:assert/strict';

import { CreateOrderUseCase, resolvePriceOverrides } from '../domains/sales/CreateOrderUseCase.js';
import { InvoiceAuthorizationUseCase } from '../domains/sales/InvoiceAuthorizationUseCase.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import afipService from '../services/afip.service.js';
import { mockPool } from './helpers/mockDb.js';

test('inventory reservation rejects malformed quantities and ignores zero-available rows', async () => {
    const useCase = new CreateOrderUseCase();
    await assert.rejects(
        () => useCase._decreaseInventoryForOrder({}, { productId: 'p', quantity: 'bad' }),
        (e) => e.errorCode === 'INVALID_QUANTITY' && e.statusCode === 400
    );
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id, location')) return [[
            { id: 'zero', available_quantity: 0 }, { id: 'stock', available_quantity: 2 }
        ]];
        return [[]];
    } };
    await useCase._decreaseInventoryForOrder(connection, { productId: 'p', productName: '', quantity: 2 });
    assert.equal(calls.filter((call) => call.sql.startsWith('UPDATE inventory')).length, 1);
    assert.deepEqual(calls.find((call) => call.sql.startsWith('UPDATE inventory')).params, [2, 'stock']);
});

test('order creation rejects missing products and invalid split allocations', async (t) => {
    let mode = 'missing';
    mockPool(t, async (sql) => {
        if (String(sql).includes('SELECT id, sale_price, name, vat_rate FROM products')) {
            return mode === 'missing' ? [[]] : [[{ id: 'p', sale_price: 100, name: 'Producto' }]];
        }
        return [[]];
    });
    const useCase = new CreateOrderUseCase();
    await assert.rejects(() => useCase.execute({ items: [{ product_id: 'p', quantity: 1 }] }, 'u'), /Producto no encontrado/);
    mode = 'allocation';
    await assert.rejects(
        () => useCase.execute({ items: [{ product_id: 'p', quantity: 1 }], payments: [{ method: '', amount: 100 }] }, 'u'),
        (e) => e.errorCode === 'INVALID_ORDER_PAYMENT_ALLOCATION'
    );
    await assert.rejects(
        () => useCase.execute({ items: [{ product_id: 'p', quantity: 1 }], payments: [{ method: 'cash', amount: 90 }] }, 'u'),
        (e) => e.errorCode === 'INVALID_ORDER_PAYMENT_ALLOCATION'
    );
});

test('credit-account orders reject missing, unknown and final-consumer clients', async (t) => {
    let clientMode = 'missing';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 100, name: 'P' }]];
        if (statement.includes('SELECT id, name FROM clients')) {
            if (clientMode === 'unknown') return [[]];
            return [[{ id: 'c', name: ' Consumidor Final ' }]];
        }
        return [[]];
    });
    const useCase = new CreateOrderUseCase();
    const base = { items: [{ product_id: 'p', quantity: 1 }], payment_method: 'credit_account' };
    await assert.rejects(() => useCase.execute(base, 'u'), (e) => e.errorCode === 'CREDIT_ACCOUNT_REQUIRES_CLIENT');
    clientMode = 'unknown';
    await assert.rejects(() => useCase.execute({ ...base, client_id: 'c' }, 'u'), (e) => e.errorCode === 'INVALID_CREDIT_ACCOUNT_CLIENT');
    clientMode = 'final';
    await assert.rejects(() => useCase.execute({ ...base, client_id: 'c' }, 'u'), (e) => e.errorCode === 'INVALID_CREDIT_ACCOUNT_CLIENT');
});

test('order creation resolves cashier, catalog prices, mixed checks and loyalty points', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 1000, name: '' }]];
        if (statement.includes('SELECT id, name FROM clients')) return [[{ id: 'c', name: 'Ana' }]];
        if (statement.includes('SELECT name FROM users')) return [[{ name: 'Cajero QA' }]];
        if (statement.startsWith('SELECT id, location')) return [[{ id: 'inv', available_quantity: 5 }]];
        if (statement.includes('SELECT loyalty_points')) return [[{ loyalty_points: 20 }]];
        return [[]];
    });
    const originalAudit = auditService.log;
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = originalAudit; });
    const result = await new CreateOrderUseCase().execute({
        client_id: 'c', counter_name: ' ', points_redeemed: 50,
        items: [{ product_id: 'p', quantity: 2, unit_price: 'bad' }],
        payments: [
            { method: 'cash', amount: 1000 },
            { method: 'credit_account', amount: 1000, check: { note: 'metadata' } }
        ]
    }, 'u');
    assert.equal(result.total_amount, 1800);
    assert.equal(result.points_redeemed, 20);
    assert.equal(result.points_earned, 1);
    assert.equal(audit.new_values.total_amount, 1800);
    const orderInsert = calls.find((call) => call.sql.includes('INSERT INTO orders'));
    assert.ok(orderInsert.params.includes('Cajero QA'));
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO order_payments')).length, 2);
});

test('duplicate external order races recover the committed remote order', async (t) => {
    const originalQuery = pool.query;
    pool.query = async () => [[{ id: 'existing', total_amount: '50' }]];
    t.after(() => { pool.query = originalQuery; });
    const connection = mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('external_source = ?')) return [[]];
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 50, name: 'P' }]];
        if (statement.includes('INSERT INTO orders')) {
            const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
        }
        return [[]];
    });
    // mockPool replaces pool.query, so restore only the shared query used after rollback.
    pool.query = async () => [[{ id: 'existing', total_amount: '50' }]];
    const result = await new CreateOrderUseCase().execute({
        external_source: 'tiendanube', external_id: '1', items: [{ product_id: 'p', quantity: 1 }]
    }, 'u');
    assert.deepEqual(result, { id: 'existing', total_amount: 50, idempotent_replay: true });
    assert.ok(connection);
});

test('invoice authorization handles missing, replay, success and AFIP rollback', async (t) => {
    let mode = 'missing';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FOR UPDATE')) {
            if (mode === 'missing') return [[]];
            if (mode === 'replay') return [[{ id: 'i', status: 'authorized' }]];
            return [[{ id: 'i', status: 'issued', invoice_type: 'B' }]];
        }
        if (statement.includes('company_settings')) return [[]];
        if (statement.includes('invoice_items')) return [[{ quantity: 1 }]];
        if (statement.startsWith('SELECT * FROM invoices WHERE id = ?')) return [[{ id: 'i', status: 'authorized' }]];
        return [[]];
    });
    const useCase = new InvoiceAuthorizationUseCase();
    await assert.rejects(() => useCase.execute('i', 'u'), (e) => e.statusCode === 404);
    mode = 'replay';
    assert.equal((await useCase.execute('i', 'u')).status, 'authorized');

    const originals = {
        afip: afipService.authorizeVoucher,
        journal: accountingService.postInvoiceAccountingEntries,
        audit: auditService.log
    };
    afipService.authorizeVoucher = async () => ({ cae: 'CAE', cae_expiration_date: '2026-09-01', invoice_number: 2 });
    accountingService.postInvoiceAccountingEntries = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        afipService.authorizeVoucher = originals.afip;
        accountingService.postInvoiceAccountingEntries = originals.journal;
        auditService.log = originals.audit;
    });
    mode = 'success';
    assert.equal((await useCase.execute('i', 'u')).status, 'authorized');
    afipService.authorizeVoucher = async () => { throw new Error('AFIP offline'); };
    await assert.rejects(() => useCase.execute('i', 'u'), /AFIP offline/);
});

test('order creation with VAT and payments matches full gross total (POS checkout)', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 1200000, name: 'Monitor' }]];
        if (statement.startsWith('SELECT id, product_id, location')) {
            return [[{ id: 'inv', product_id: 'p', location: 'A-01', quantity: 10, reserved_quantity: 0 }]];
        }
        if (statement.includes('SET quantity = quantity - ?')) return [{ affectedRows: 1 }];
        return [[]];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    const result = await new CreateOrderUseCase({ onStockChanged: async () => {} }).execute({
        external_source: 'pos',
        external_id: '0a252ca9-9af2-455d-89d7-87150716f8ae',
        total_amount: 1452000,
        items: [{ product_id: 'p', quantity: 1, unit_price: 1200000, vat_rate: 21.00 }],
        payments: [{ method: 'cash', amount: 1452000 }]
    }, 'u');

    assert.equal(result.total_amount, 1452000);
    const orderInsert = calls.find((call) => call.sql.includes('INSERT INTO orders'));
    assert.ok(orderInsert.params.includes(1452000));
});

test('a POS counter sale deducts physical stock and records sale movements instead of reserving (C1)', async (t) => {
    const calls = [];
    const synced = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) {
            return [[{ id: 'b', sale_price: 100, name: 'Botin' }, { id: 'a', sale_price: 50, name: 'Media' }]];
        }
        if (statement.startsWith('SELECT id, product_id, location')) {
            return [[
                { id: 'inv-a', product_id: 'a', location: 'A-01', quantity: 5, reserved_quantity: 0 },
                { id: 'inv-b1', product_id: 'b', location: 'B-01', quantity: 1, reserved_quantity: 0 },
                { id: 'inv-b2', product_id: 'b', location: 'B-02', quantity: 4, reserved_quantity: 1 },
            ]];
        }
        if (statement.includes('SET quantity = quantity - ?')) return [{ affectedRows: 1 }];
        return [[]];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    await new CreateOrderUseCase({ onStockChanged: async (ids) => { synced.push(...ids); } }).execute({
        external_source: 'pos',
        external_id: 'b5b8f1c4-4a8e-4e0c-9d5e-2f1f1f1f1f1f',
        items: [{ product_id: 'b', quantity: 4 }, { product_id: 'a', quantity: 2 }],
    }, 'cashier-1');

    const lockCall = calls.find((call) => call.sql.startsWith('SELECT id, product_id, location'));
    assert.match(lockCall.sql, /FOR UPDATE/);
    assert.deepEqual(lockCall.params[0], ['a', 'b'], 'products are locked in a stable order');

    const orderInsert = calls.find((call) => call.sql.includes('INSERT INTO orders'));
    assert.equal(orderInsert.params[6], 'completed');

    const deductions = calls.filter((call) => call.sql.includes('SET quantity = quantity - ?'));
    assert.deepEqual(deductions.map((call) => call.params), [
        [2, 'inv-a', 2],
        [3, 'inv-b2', 3],
        [1, 'inv-b1', 1],
    ]);
    const movements = calls.filter((call) => call.sql.includes('INSERT INTO inventory_movements'));
    assert.equal(movements.length, 3);
    assert.ok(movements.every((call) => call.params[1] === 'sale' && call.params.at(-1) === 'cashier-1'));
    assert.equal(movements.reduce((sum, call) => sum + call.params[4], 0), 6);

    assert.equal(calls.some((call) => call.sql.includes('reserved_quantity = reserved_quantity +')), false);
    assert.equal(calls.some((call) => call.sql.includes('order_item_allocations')), false);
    const itemInserts = calls.filter((call) => call.sql.includes('INSERT INTO order_items'));
    assert.ok(itemInserts.every((call) => call.sql.includes('picked_quantity') && call.params[3] === call.params[4]));

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(synced.sort(), ['a', 'b']);
});

test('a POS order with shipping keeps the reservation flow', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 100, name: 'P' }]];
        if (statement.startsWith('SELECT id, location')) return [[{ id: 'inv', location: 'A', available_quantity: 3 }]];
        return [[]];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    await new CreateOrderUseCase({ onStockChanged: async () => { throw new Error('must not sync'); } }).execute({
        external_source: 'pos',
        external_id: 'c5b8f1c4-4a8e-4e0c-9d5e-2f1f1f1f1f1f',
        shipping_method: 'delivery',
        items: [{ product_id: 'p', quantity: 1 }],
    }, 'u');

    assert.equal(calls.find((call) => call.sql.includes('INSERT INTO orders')).params[6], 'pending');
    assert.ok(calls.some((call) => call.sql.includes('reserved_quantity = reserved_quantity +')));
    assert.equal(calls.some((call) => call.sql.includes('SET quantity = quantity - ?')), false);
});

test('price policy: catalog price unless authorized, imported, or captured offline (ADR-008)', () => {
    const prices = new Map([['p', 100]]);
    const names = new Map([['p', 'Pelota']]);
    const pos = (unitPrice, extra = {}) => ({ external_source: 'pos', items: [{ product_id: 'p', quantity: 1, unit_price: unitPrice }], ...extra });

    assert.deepEqual(resolvePriceOverrides(pos(100), prices, names, { role: 'cashier' }), { overrides: [], source: null });
    assert.deepEqual(resolvePriceOverrides(pos(undefined), prices, names, { role: 'cashier' }).overrides, []);
    assert.throws(
        () => resolvePriceOverrides(pos(0), prices, names, { role: 'cashier' }),
        (err) => err.statusCode === 409 && err.errorCode === 'PRICE_OVERRIDE_NOT_ALLOWED' && /Pelota/.test(err.message)
    );
    assert.throws(() => resolvePriceOverrides(pos(90), prices, names, null), /requiere autorización/);

    assert.equal(resolvePriceOverrides(pos(90), prices, names, { role: 'manager' }).source, 'authorized_user');
    assert.equal(resolvePriceOverrides(pos(90), prices, names, { role: 'admin' }).source, 'authorized_user');
    assert.equal(
        resolvePriceOverrides({ external_source: 'tiendanube', items: [{ product_id: 'p', unit_price: 95 }] }, prices, names, null).source,
        'tiendanube'
    );

    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.deepEqual(resolvePriceOverrides(pos(90, { offline_captured_at: recent }), prices, names, { role: 'cashier' }), {
        overrides: [{ product_id: 'p', catalog_price: 100, unit_price: 90 }],
        source: 'offline_pos',
    });
    const tooOld = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const capturedAt of [tooOld, future, 'not-a-date']) {
        assert.throws(() => resolvePriceOverrides(pos(90, { offline_captured_at: capturedAt }), prices, names, { role: 'cashier' }), /requiere autorización/);
    }
});

test('an authorized price override is audited in the same transaction as the sale', async (t) => {
    const audits = [];
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 100, name: 'P' }]];
        if (statement.startsWith('SELECT id, product_id, location')) return [[{ id: 'inv', product_id: 'p', location: 'A', quantity: 5, reserved_quantity: 0 }]];
        if (statement.includes('SET quantity = quantity - ?')) return [{ affectedRows: 1 }];
        return [[]];
    });
    const originalAudit = auditService.log;
    auditService.log = async (entry, executor) => { audits.push({ entry, transactional: Boolean(executor) }); };
    t.after(() => { auditService.log = originalAudit; });

    await new CreateOrderUseCase({ onStockChanged: async () => {} }).execute({
        external_source: 'pos',
        external_id: 'd5b8f1c4-4a8e-4e0c-9d5e-2f1f1f1f1f1f',
        items: [{ product_id: 'p', quantity: 1, unit_price: 80 }],
    }, 'manager-1', { role: 'manager' });

    const override = audits.find(({ entry }) => entry.action === 'ORDER_PRICE_OVERRIDE');
    assert.ok(override?.transactional);
    assert.deepEqual(override.entry.new_values, {
        source: 'authorized_user', role: 'manager', lines: [{ product_id: 'p', catalog_price: 100, unit_price: 80 }],
    });
});
