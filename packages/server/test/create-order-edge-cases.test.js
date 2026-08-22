import test from 'node:test';
import assert from 'node:assert/strict';

import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
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
        if (String(sql).includes('SELECT id, sale_price, name FROM products')) {
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
        if (statement.includes('SELECT id, sale_price, name FROM products')) return [[{ id: 'p', sale_price: 100, name: 'P' }]];
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
        if (statement.includes('SELECT id, sale_price, name FROM products')) return [[{ id: 'p', sale_price: 1000, name: '' }]];
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
        if (statement.includes('SELECT id, sale_price, name FROM products')) return [[{ id: 'p', sale_price: 50, name: 'P' }]];
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
