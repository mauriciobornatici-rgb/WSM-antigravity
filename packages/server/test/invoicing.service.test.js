import test from 'node:test';
import assert from 'node:assert/strict';

import salesService from '../services/sales.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('createInvoice throws if order not found', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM orders')) {
            return [[]]; // Order not found
        }
        return [[]];
    });

    await assert.rejects(
        () => salesService.createInvoice('order-123', { invoice_type: 'B' }, 'user-1'),
        /Order not found/
    );
});

test('createInvoice throws if order already invoiced', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM orders')) {
            return [[{ id: 'order-123', invoice_id: 'invoice-already' }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => salesService.createInvoice('order-123', { invoice_type: 'B' }, 'user-1'),
        /Order already invoiced/
    );
});

test('createInvoice throws if order has no items', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM orders')) {
            return [[{ id: 'order-123', invoice_id: null }]];
        }
        if (sql.includes('SELECT oi.*')) {
            return [[]]; // No items
        }
        return [[]];
    });

    await assert.rejects(
        () => salesService.createInvoice('order-123', { invoice_type: 'B' }, 'user-1'),
        /Order has no items/
    );
});

test('createInvoice successfully creates invoice from order', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT * FROM orders')) {
            return [[{ id: 'order-123', invoice_id: null, client_id: 'client-1', customer_name: 'Juan Perez' }]];
        }
        if (sql.includes('SELECT oi.*')) {
            return [[{ product_id: 'p1', product_name: 'Zapatilla', sku: 'ZAP-01', quantity: 2, picked_quantity: 2, unit_price: 100, vat_rate: 21 }]];
        }
        if (sql.includes('SELECT billing_pos')) {
            return [[{ billing_pos: 1 }]];
        }
        if (sql.includes('MAX(invoice_number)')) {
            return [[{ max_number: 5 }]];
        }
        if (sql.includes('document_sequences')) {
            return [[{ current_value: 5 }]];
        }
        if (sql.includes('SELECT name, tax_id, address FROM clients')) {
            return [[{ name: 'Juan Perez', tax_id: '20-30405060-7', address: 'Av. Siempre Viva 742' }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    let logged = false;
    auditService.log = async () => { logged = true; };
    t.after(() => { auditService.log = originalLog; });

    const result = await salesService.createInvoice('order-123', { invoice_type: 'B', point_of_sale: 1 }, 'user-1');

    assert.ok(result.id);
    assert.equal(result.payment_status, 'pending');
    assert.equal(result.total_amount, 242.00); // 200 + 42
    assert.ok(logged);

    const inserts = queryCalls.filter(c => c.sql.includes('INSERT INTO invoices'));
    assert.equal(inserts.length, 1);
});
