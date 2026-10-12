import test from 'node:test';
import assert from 'node:assert/strict';

import financeService from '../services/finance.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('payment normalization and received cheques cover safe operational defaults', async () => {
    assert.deepEqual(financeService._normalizePaymentLines([{ amount: 10 }]), [{ amount: 10, method: 'cash' }]);
    assert.deepEqual(financeService._normalizePaymentLines([{ amount: 10, reference_number: '  TR-10  ' }]), [
        { amount: 10, method: 'cash', reference_number: 'TR-10' }
    ]);
    assert.deepEqual(financeService._normalizePaymentLines([{ amount: 10, reference_number: '   ' }]), [
        { amount: 10, method: 'cash' }
    ]);
    assert.throws(
        () => financeService._normalizePaymentLines([{ amount: Number.NaN }]),
        (error) => error.errorCode === 'INVALID_PAYMENT_AMOUNT'
    );

    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[]];
    } };
    const checkId = await financeService._resolveCustomerCheck(connection, {
        clientId: null,
        userId: null,
        payment: {
            method: 'check', amount: 250,
            check: {
                issuer_name: 'Titular', bank_name: 'Banco', check_number: 'DEF-1',
                issue_date: '2026-08-22', due_date: '2026-09-22', notes: 'Recibido en caja'
            }
        }
    });
    assert.ok(checkId);
    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO customer_checks'));
    assert.equal(insert.params[1], null);
    assert.equal(insert.params[5], 250);
    assert.equal(insert.params[6], '2026-08-22');
    assert.equal(insert.params.at(-1), null);
});

test('registerInvoicePayments fully settles an invoice without client or linked order', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM invoices')) return [[{
            id: 'invoice-anonymous', total_amount: 25, payment_method: 'bank',
            invoice_type: 'B', point_of_sale: 2, invoice_number: 4,
            client_id: null, order_id: null
        }]];
        if (statement.includes('SUM(amount)')) return [[{}]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });

    const result = await financeService.registerInvoicePayments('invoice-anonymous', {
        payments: [{ amount: 25 }]
    }, null);
    assert.equal(result.payment_status, 'paid');
    assert.equal(result.paid_before, 0);
    assert.ok(calls.some(({ params }) => params?.includes('bank')));
    assert.equal(calls.some(({ sql }) => sql.includes('UPDATE clients')), false);
    assert.equal(calls.some(({ sql }) => sql.includes('SELECT id, status FROM orders')), false);
});

test('order receivable payments trace cheque and bank branches', async (t) => {
    const calls = [];
    const journals = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[]];
    } };
    const originals = {
        check: financeService._resolveCustomerCheck,
        journal: accountingService.createJournalEntry,
    };
    financeService._resolveCustomerCheck = async (_connection, { payment }) => payment.method === 'check' ? 'check-1' : null;
    accountingService.createJournalEntry = async (_connection, entry) => journals.push(entry);
    t.after(() => {
        financeService._resolveCustomerCheck = originals.check;
        accountingService.createJournalEntry = originals.journal;
    });

    await financeService._registerOrderReceivablePayments(connection, {
        orderId: 'order-1', clientId: 'client-1', orderLabel: 'PED-1', userId: null,
        payments: [{ method: 'check', amount: 40 }, { method: 'bank', amount: 60 }]
    });
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO customer_check_allocations')));
    assert.deepEqual(journals.map((entry) => entry.lines[0].account_code), ['1.1.02.02', '1.1.02.01']);
});

test('customer cheque lifecycle supports endorsement, deposit and repeated clearance safely', async (t) => {
    let currentStatus = 'received';
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM customer_checks') && statement.includes('FOR UPDATE')) return [[{
            id: 'check-1', status: currentStatus, delivered_to: null, notes: 'Nota previa',
            deposited_at: null, cleared_at: currentStatus === 'cleared' ? '2026-08-22' : null,
            amount: 100, check_number: '1', bank_name: 'Banco'
        }]];
        if (statement.includes('FROM customer_checks cc')) return [[{ id: 'check-1', status: currentStatus, amount: 100 }]];
        if (statement.includes('FROM customer_check_events')) return [[]];
        if (statement.includes('FROM customer_check_allocations')) return [[]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    let journals = 0;
    accountingService.createJournalEntry = async () => { journals += 1; };
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });

    currentStatus = 'endorsed';
    await financeService.updateCustomerCheckStatus('check-1', {
        status: 'endorsed', delivered_to: 'Proveedor Uno', notes: 'Endoso operativo'
    }, null);
    currentStatus = 'deposited';
    await financeService.updateCustomerCheckStatus('check-1', { status: 'deposited' }, null);
    currentStatus = 'cleared';
    await financeService.updateCustomerCheckStatus('check-1', { status: 'cleared' }, null);

    assert.equal(journals, 0);
    assert.ok(calls.some(({ sql }) => sql.includes('deposited_at = NOW()')));
    assert.ok(calls.some(({ params }) => params?.includes('Entregado a Proveedor Uno. Endoso operativo')));
    assert.ok(calls.some(({ params }) => params?.includes('Nota previa')));
});

test('outgoing cheque lifecycle preserves prior notes when rejected', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM outgoing_checks') && statement.includes('FOR UPDATE')) {
            return [[{ id: 'out-1', status: 'delivered', notes: 'Nota previa' }]];
        }
        if (statement.includes('FROM outgoing_checks oc')) return [[{ id: 'out-1', status: 'rejected', amount: 50 }]];
        if (statement.includes('FROM outgoing_check_events') || statement.includes('FROM outgoing_check_allocations')) return [[]];
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });

    const result = await financeService.updateOutgoingCheckStatus('out-1', { status: 'rejected' }, null);
    assert.equal(result.status, 'rejected');
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE outgoing_checks') && params[1] === 'Nota previa'));
    assert.equal(calls.some(({ sql }) => sql.includes('cleared_at = NOW()')), false);
});

test('supplier settlement selects cash, bank and third-party cheque accounts', async (t) => {
    const calls = [];
    const journals = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM supplier_invoices')) return [[{
            id: 'supplier-invoice', supplier_id: 'supplier', total_amount: 100, invoice_number: 'A-10'
        }]];
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: null }]];
        // The cash line leaves the drawer of the single open shift, which holds enough (ADR-014).
        if (statement.includes("FROM cash_shifts WHERE id = ? AND status = 'open' FOR UPDATE")) return [[{ id: 'shift-1' }]];
        if (statement.includes("FROM cash_shifts WHERE status = 'open'")) return [[{ id: 'shift-1' }]];
        if (statement.includes('FROM shift_payments')) return [[{ inflow: 100, outflow: 0 }]];
        if (statement.includes('SELECT opening_balance')) return [[{ opening_balance: 0 }]];
        return [[]];
    });
    const originals = {
        outgoing: financeService._resolveOutgoingCheck,
        journal: accountingService.createJournalEntry,
        audit: auditService.log,
    };
    financeService._resolveOutgoingCheck = async (_connection, { payment }) => payment.method === 'check' ? 'out-1' : null;
    accountingService.createJournalEntry = async (_connection, entry) => journals.push(entry);
    auditService.log = async () => {};
    t.after(() => {
        financeService._resolveOutgoingCheck = originals.outgoing;
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });

    const result = await financeService.registerBulkSupplierPayments({
        supplierId: 'supplier', notes: 'Cancelación mixta', allocations: [{
            invoiceId: 'supplier-invoice', payments: [
                { method: 'cash', amount: 20 },
                { method: 'bank', amount: 30, reference_number: 'TR-1' },
                { method: 'check', amount: 50, check: { source_type: 'third_party' } }
            ]
        }]
    }, null);
    assert.equal(result.total_paid, 100);
    assert.deepEqual(journals.map((entry) => entry.lines[1].account_code), ['1.1.01.01', '1.1.02.01', '1.1.02.02']);
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO outgoing_check_allocations')));
    assert.ok(calls.some(({ params }) => params?.includes('TR-1')));
    // Only the cash line takes money out of the drawer (as an 'expense' of the open shift).
    const drawer = calls.filter(({ sql }) => sql.includes('INSERT INTO shift_payments'));
    assert.equal(drawer.length, 1);
    assert.deepEqual([drawer[0].params[1], drawer[0].params[2]], ['shift-1', 20]);
    assert.ok(drawer[0].sql.includes("'expense'"));
});
