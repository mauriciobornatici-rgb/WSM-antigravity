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

test('registerBulkInvoicePayments collects an uninvoiced credit-account order without creating a fiscal invoice', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('FROM orders o') && sql.includes('receivable_amount')) {
            return [[{
                id: 'order-1',
                client_id: 'client-1',
                client_name: 'Pedro',
                receivable_amount: 60000,
                payment_method: 'credit_account'
            }]];
        }
        if (sql.includes('SELECT COALESCE(SUM(amount)')) {
            return [[{ paid_amount: 0 }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    const originalCreateJournalEntry = accountingService.createJournalEntry;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async () => {};
    t.after(() => {
        auditService.log = originalLog;
        accountingService.createJournalEntry = originalCreateJournalEntry;
    });

    const result = await financeService.registerBulkInvoicePayments({
        clientId: 'client-1',
        allocations: [{
            documentId: 'order-1',
            documentType: 'order',
            payments: [{ method: 'transfer', amount: 60000 }]
        }]
    }, 'user-1');

    assert.equal(result.total_paid, 60000);
    assert.equal(result.invoices[0].documentType, 'order');
    assert.equal(result.invoices[0].payment_status, 'paid');
    assert.ok(queryCalls.some((call) => call.sql.includes('INSERT INTO transactions')));
    assert.ok(queryCalls.some((call) => call.sql.includes('UPDATE orders SET payment_status')));
    assert.equal(queryCalls.some((call) => call.sql.includes('INSERT INTO invoices')), false);
});

test('getCustomerChecks normalizes portfolio amounts and allocation counters', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('FROM customer_checks cc')) {
            return [[{
                id: 'check-1',
                amount: '1250.50',
                allocated_amount: '750.25',
                invoice_count: '2',
                status: 'received'
            }]];
        }
        return [[]];
    });

    const result = await financeService.getCustomerChecks({ status: 'received' });

    assert.equal(result.length, 1);
    assert.equal(result[0].amount, 1250.5);
    assert.equal(result[0].allocated_amount, 750.25);
    assert.equal(result[0].invoice_count, 2);
});

test('getCustomerCheck returns its event and invoice-allocation trace', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('FROM customer_check_events')) {
            return [[{ id: 'event-1', status: 'received' }]];
        }
        if (sql.includes('FROM customer_check_allocations')) {
            return [[{ id: 'allocation-1', invoice_id: 'invoice-1', amount: 500 }]];
        }
        if (sql.includes('FROM customer_checks cc')) {
            return [[{ id: 'check-1', amount: 500, status: 'received' }]];
        }
        return [[]];
    });

    const result = await financeService.getCustomerCheck('check-1');

    assert.equal(result.id, 'check-1');
    assert.equal(result.events[0].id, 'event-1');
    assert.equal(result.allocations[0].invoice_id, 'invoice-1');
});

test('updateCustomerCheckStatus requires a recipient when a cheque is endorsed', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT * FROM customer_checks')) {
            return [[{ id: 'check-1', status: 'received', delivered_to: null }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => financeService.updateCustomerCheckStatus('check-1', { status: 'endorsed' }, 'user-1'),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.errorCode, 'CHECK_DELIVERY_RECIPIENT_REQUIRED');
            return true;
        }
    );
});

test('updateCustomerCheckStatus records clearance once and returns the complete trace', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT * FROM customer_checks')) {
            return [[{
                id: 'check-1',
                status: 'deposited',
                cleared_at: null,
                delivered_to: null,
                notes: null,
                amount: 500,
                check_number: '123',
                bank_name: 'Banco QA'
            }]];
        }
        if (sql.includes('FROM customer_check_events')) {
            return [[{ id: 'event-1', status: 'cleared', notes: 'Acreditado' }]];
        }
        if (sql.includes('FROM customer_check_allocations')) {
            return [[{ id: 'allocation-1', invoice_id: 'invoice-1', amount: 500 }]];
        }
        if (sql.includes('FROM customer_checks cc')) {
            return [[{ id: 'check-1', amount: 500, status: 'cleared' }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    const originalCreateJournalEntry = accountingService.createJournalEntry;
    let journalEntryCount = 0;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async () => { journalEntryCount += 1; };
    t.after(() => {
        auditService.log = originalLog;
        accountingService.createJournalEntry = originalCreateJournalEntry;
    });

    const result = await financeService.updateCustomerCheckStatus(
        'check-1',
        { status: 'cleared', notes: 'Acreditado' },
        'user-1'
    );

    assert.equal(result.status, 'cleared');
    assert.equal(journalEntryCount, 1);
    assert.ok(queryCalls.some((call) => call.sql.includes('cleared_at = NOW()')));
    assert.ok(queryCalls.some((call) => call.sql.includes('INSERT INTO customer_check_events')));
});
