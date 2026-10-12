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
        if (sql.includes('SELECT * FROM invoices WHERE id = ? FOR UPDATE')) {
            return [[{
                id: params[0], invoice_type: 'B', point_of_sale: 1, invoice_number: 6,
                issue_date: '2026-01-01', total_amount: 242, vat_amount: 42
            }]];
        }
        if (sql.includes('FROM journal_entries je')) {
            return [[{ id: 'existing-entry' }]];
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
    assert.ok(result.items);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].product_name, 'Zapatilla');
    assert.ok(logged);

    const inserts = queryCalls.filter(c => c.sql.includes('INSERT INTO invoices'));
    assert.equal(inserts.length, 1);
});

test('getInvoiceById returns invoice with items', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM invoices i')) {
            return [[{ id: 'inv-1', invoice_number: 10, total_amount: 100, client_name: 'Ana' }]];
        }
        if (statement.includes('SELECT * FROM invoice_items')) {
            return [[{ id: 'item-1', invoice_id: 'inv-1', product_name: 'Pelota', quantity: 1, unit_price: 100 }]];
        }
        return [[]];
    });

    const invoice = await salesService.getInvoiceById('inv-1');
    assert.ok(invoice);
    assert.equal(invoice.id, 'inv-1');
    assert.equal(invoice.items.length, 1);
    assert.equal(invoice.items[0].product_name, 'Pelota');
});

test('getInvoiceById returns null when not found', async (t) => {
    mockPool(t, async () => [[]]);
    const invoice = await salesService.getInvoiceById('non-existent');
    assert.equal(invoice, null);
});

