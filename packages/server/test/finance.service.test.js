import test from 'node:test';
import assert from 'node:assert/strict';

import financeService from '../services/finance.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import { mockPool } from './helpers/mockDb.js';

test('registerInvoicePayments throws 404 if invoice not found', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) {
            return [[]]; // Not found
        }
        return [[]];
    });

    await assert.rejects(
        () => financeService.registerInvoicePayments('inv-123', { payments: [{ amount: 100, method: 'cash' }] }, 'user-1'),
        (err) => {
            assert.equal(err.statusCode, 404);
            assert.equal(err.errorCode, 'INVOICE_NOT_FOUND');
            return true;
        }
    );
});

test('registerInvoicePayments throws 400 if payments list is empty', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) {
            return [[{ id: 'inv-123', total_amount: 500, payment_method: 'cash' }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => financeService.registerInvoicePayments('inv-123', { payments: [] }, 'user-1'),
        (err) => {
            assert.equal(err.statusCode, 400);
            assert.equal(err.errorCode, 'MISSING_PAYMENTS');
            return true;
        }
    );
});

test('registerInvoicePayments throws 400 if any payment amount is invalid or zero', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) {
            return [[{ id: 'inv-123', total_amount: 500 }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => financeService.registerInvoicePayments('inv-123', { payments: [{ amount: 0, method: 'cash' }] }, 'user-1'),
        (err) => {
            assert.equal(err.statusCode, 400);
            assert.equal(err.errorCode, 'INVALID_PAYMENT_AMOUNT');
            return true;
        }
    );
});

test('registerInvoicePayments throws 400 if payments exceed total invoice amount', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) {
            return [[{ id: 'inv-123', total_amount: 100 }]];
        }
        if (sql.includes('SELECT COALESCE(SUM(amount)')) {
            return [[{ paid_amount: 50 }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => financeService.registerInvoicePayments('inv-123', { payments: [{ amount: 60, method: 'cash' }] }, 'user-1'),
        (err) => {
            assert.equal(err.statusCode, 400);
            assert.equal(err.errorCode, 'PAYMENTS_EXCEED_TOTAL');
            return true;
        }
    );
});

test('registerInvoicePayments successfully registers payments, updates invoice/order, decreases client balance', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT * FROM invoices')) {
            return [[{ id: 'inv-123', total_amount: 200, client_id: 'client-1', order_id: 'order-1', payment_method: 'cash', invoice_type: 'B', point_of_sale: 1, invoice_number: 10 }]];
        }
        if (sql.includes('SELECT COALESCE(SUM(amount)')) {
            return [[{ paid_amount: 0 }]];
        }
        if (sql.includes('SELECT id, status FROM orders')) {
            return [[{ id: 'order-1', status: 'packed' }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    const originalCreateJournalEntry = accountingService.createJournalEntry;

    let auditLogged = false;
    let journalEntryCreated = false;

    auditService.log = async () => {
        auditLogged = true;
    };
    accountingService.createJournalEntry = async () => {
        journalEntryCreated = true;
    };

    t.after(() => {
        auditService.log = originalLog;
        accountingService.createJournalEntry = originalCreateJournalEntry;
    });

    const result = await financeService.registerInvoicePayments(
        'inv-123',
        { payments: [{ amount: 200, method: 'cash' }] },
        'user-1'
    );

    assert.deepEqual(result, {
        id: 'inv-123',
        total_amount: 200,
        paid_before: 0,
        paid_now: 200,
        paid_amount: 200,
        pending_amount: 0,
        payment_status: 'paid'
    });

    assert.ok(journalEntryCreated);
    assert.ok(auditLogged);

    // Verify updates to DB
    const updates = queryCalls.filter((c) => c.sql.includes('UPDATE'));
    
    // Invoices update
    assert.ok(updates.some((c) => c.sql.includes('UPDATE invoices SET payment_status = ?, payment_method = ? WHERE id = ?')));
    // Orders update
    assert.ok(updates.some((c) => c.sql.includes('UPDATE orders SET payment_status = ?, status = ? WHERE id = ?')));
    // Clients update
    assert.ok(updates.some((c) => c.sql.includes('UPDATE clients') && c.sql.includes('current_account_balance')));
});
