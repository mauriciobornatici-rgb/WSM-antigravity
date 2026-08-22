import test from 'node:test';
import assert from 'node:assert/strict';

import financeService from '../services/finance.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('finance payment helpers classify and validate payment lines', () => {
    assert.equal(financeService._resolvePaymentStatus(100, 0), 'pending');
    assert.equal(financeService._resolvePaymentStatus(100, 10), 'partial');
    assert.equal(financeService._resolvePaymentStatus(100, 100), 'paid');
    assert.equal(financeService._normalizeOrderStatus(''), 'pending');
    assert.equal(financeService._normalizeOrderStatus(' PACKED '), 'packed');
    assert.throws(() => financeService._normalizePaymentLines(null), (e) => e.errorCode === 'MISSING_PAYMENTS');
    assert.throws(() => financeService._normalizePaymentLines([{ amount: -1 }]), (e) => e.errorCode === 'INVALID_PAYMENT_AMOUNT');
    assert.throws(() => financeService._normalizePaymentLines([{ amount: 1, method: ' ' }], ''), (e) => e.errorCode === 'INVALID_PAYMENT_METHOD');
    assert.deepEqual(financeService._normalizePaymentLines([{ amount: '5.50', method: ' BANK ' }]), [{ amount: 5.5, method: 'bank' }]);
});

test('_resolveCustomerCheck handles non-check, invalid, duplicate and new cheques', async () => {
    assert.equal(await financeService._resolveCustomerCheck({}, { payment: { method: 'cash' } }), null);
    await assert.rejects(
        () => financeService._resolveCustomerCheck({ query: async () => [[]] }, { payment: { method: 'check', amount: 10 } }),
        (e) => e.errorCode === 'INVALID_CHECK_DETAILS'
    );
    const details = { issuer_name: 'Ana', bank_name: 'Banco', check_number: '1', due_date: '2026-09-01', instrument_amount: 10 };
    await assert.rejects(
        () => financeService._resolveCustomerCheck({ query: async () => [[{ id: 'ch', amount: 11 }]] }, { payment: { method: 'check', amount: 10, check: details } }),
        (e) => e.errorCode === 'CHECK_AMOUNT_MISMATCH'
    );
    assert.equal(
        await financeService._resolveCustomerCheck({ query: async () => [[{ id: 'ch', amount: 10 }]] }, { payment: { method: 'check', amount: 10, check: details } }),
        'ch'
    );
    const calls = [];
    const id = await financeService._resolveCustomerCheck({ query: async (sql) => {
        calls.push(String(sql));
        return [[]];
    } }, { clientId: 'c', payment: { method: 'check', amount: 10, check: details }, userId: 'u' });
    assert.ok(id);
    assert.equal(calls.filter((sql) => sql.includes('INSERT INTO')).length, 2);
});

test('internal invoice and order payment registration skips invalid rows and selects ledger accounts', async (t) => {
    const calls = [];
    const connection = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; } };
    const original = accountingService.createJournalEntry;
    const journals = [];
    accountingService.createJournalEntry = async (_connection, entry) => { journals.push(entry); };
    t.after(() => { accountingService.createJournalEntry = original; });
    await financeService._registerInvoicePayments(connection, {
        invoiceId: 'i', clientId: null, invoiceLabel: 'B-1', userId: null,
        payments: [null, { amount: 0 }, { method: 'transfer', amount: 10 }]
    });
    await financeService._registerOrderReceivablePayments(connection, {
        orderId: 'o', clientId: 'c', orderLabel: 'pedido', payments: [{ method: 'cash', amount: 5 }]
    });
    assert.equal(journals.length, 2);
    assert.equal(journals[0].lines[0].account_code, '1.1.02.01');
    assert.equal(journals[1].lines[0].account_code, '1.1.01.01');
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO transactions')).length, 2);
});

test('registerInvoicePayments rejects nonpositive invoices and supports partial multiple payments', async (t) => {
    let mode = 'invalid';
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM invoices')) return [[mode === 'invalid'
            ? { id: 'i', total_amount: 0 }
            : { id: 'i', total_amount: 100, payment_method: 'cash', invoice_type: 'B', point_of_sale: 1, invoice_number: 2 }]];
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: 10 }]];
        return [[]];
    });
    await assert.rejects(() => financeService.registerInvoicePayments('i', { payments: [{ amount: 1 }] }, 'u'), (e) => e.errorCode === 'INVALID_INVOICE_TOTAL');
    mode = 'partial';
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });
    const result = await financeService.registerInvoicePayments('i', { payments: [{ method: 'cash', amount: 5 }, { method: 'bank', amount: 5 }] }, 'u');
    assert.equal(result.payment_status, 'partial');
    assert.ok(calls.some((call) => call.params?.includes('multiple')));
});

test('bulk customer collection validates its contract and missing documents', async (t) => {
    await assert.rejects(() => financeService.registerBulkInvoicePayments({ allocations: [] }, 'u'), (e) => e.errorCode === 'MISSING_CLIENT_ID');
    await assert.rejects(() => financeService.registerBulkInvoicePayments({ clientId: 'c', allocations: [] }, 'u'), (e) => e.errorCode === 'MISSING_ALLOCATIONS');
    mockPool(t, async (sql) => {
        if (String(sql).includes('FROM orders o')) return [[]];
        return [[]];
    });
    await assert.rejects(
        () => financeService.registerBulkInvoicePayments({ clientId: 'c', allocations: [{ documentType: 'order', documentId: 'o', payments: [{ amount: 1 }] }] }, 'u'),
        (e) => e.errorCode === 'ORDER_RECEIVABLE_NOT_FOUND'
    );
});

test('customer cheque queries cover no-filter, missing and status validation', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('FROM customer_checks cc')) return [[]];
        if (String(sql).includes('SELECT * FROM customer_checks')) return [[]];
        return [[]];
    });
    assert.deepEqual(await financeService.getCustomerChecks(), []);
    assert.equal(await financeService.getCustomerCheck('missing'), null);
    await assert.rejects(() => financeService.updateCustomerCheckStatus('x', { status: 'bad' }, 'u'), (e) => e.errorCode === 'INVALID_CHECK_STATUS');
    await assert.rejects(() => financeService.updateCustomerCheckStatus('x', { status: 'received' }, 'u'), (e) => e.errorCode === 'CHECK_NOT_FOUND');
});

test('_resolveOutgoingCheck validates and reuses own and third-party instruments', async () => {
    assert.equal(await financeService._resolveOutgoingCheck({}, { payment: { method: 'cash' } }), null);
    await assert.rejects(
        () => financeService._resolveOutgoingCheck({ query: async () => [[]] }, { payment: { method: 'check', amount: 10 } }),
        (e) => e.errorCode === 'INVALID_OUTGOING_CHECK_DETAILS'
    );
    const own = { issuer_name: 'WSM', bank_name: 'Banco', check_number: '10', due_date: '2026-09-01', instrument_amount: 10 };
    assert.equal(await financeService._resolveOutgoingCheck({ query: async () => [[{ id: 'out', amount: 10 }]] }, { payment: { method: 'check', amount: 10, check: own } }), 'out');
    await assert.rejects(
        () => financeService._resolveOutgoingCheck({ query: async () => [[{ id: 'out', amount: 11 }]] }, { payment: { method: 'check', amount: 10, check: own } }),
        (e) => e.errorCode === 'OUTGOING_CHECK_AMOUNT_MISMATCH'
    );
    const third = { source_type: 'third_party', source_customer_check_id: 'source', instrument_amount: 10 };
    await assert.rejects(
        () => financeService._resolveOutgoingCheck({ query: async () => [[]] }, { payment: { method: 'check', amount: 10, check: third } }),
        (e) => e.errorCode === 'SOURCE_CHECK_NOT_FOUND'
    );
    let lookup = 0;
    await assert.rejects(
        () => financeService._resolveOutgoingCheck({ query: async () => {
            lookup += 1;
            return lookup === 1 ? [[]] : [[{ status: 'deposited' }]];
        } }, { payment: { method: 'check', amount: 10, check: third } }),
        (e) => e.errorCode === 'SOURCE_CHECK_NOT_AVAILABLE'
    );
});

test('_resolveOutgoingCheck endorses a full third-party cheque to a supplier', async () => {
    const calls = [];
    let lookup = 0;
    const id = await financeService._resolveOutgoingCheck({ query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('source_customer_check_id')) return [[]];
        if (statement.includes('SELECT * FROM customer_checks')) {
            lookup += 1;
            return [[{ status: 'received', issuer_name: 'Ana', bank_name: 'Banco', check_number: '3', issue_date: null, due_date: '2026-09-01T00:00:00Z', amount: 10 }]];
        }
        if (statement.includes('SELECT id, amount FROM outgoing_checks WHERE bank_name')) return [[]];
        return [[]];
    } }, {
        supplierId: 's', payment: { method: 'check', amount: 10, check: { source_type: 'third_party', source_customer_check_id: 'source', instrument_amount: 10 } },
        userId: 'u', notes: ''
    });
    assert.ok(id);
    assert.ok(calls.some((call) => call.sql.includes("SET status = 'endorsed'")));
    assert.equal(lookup, 1);
});

test('supplier payments and outgoing cheque APIs validate missing records and statuses', async (t) => {
    await assert.rejects(() => financeService.registerBulkSupplierPayments({ allocations: [] }, 'u'), (e) => e.errorCode === 'MISSING_SUPPLIER_ID');
    await assert.rejects(() => financeService.registerBulkSupplierPayments({ supplierId: 's', allocations: [] }, 'u'), (e) => e.errorCode === 'MISSING_ALLOCATIONS');
    let target = 'supplier';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (target === 'supplier' && statement.includes('SELECT * FROM supplier_invoices')) return [[]];
        if (target === 'outgoing' && statement.includes('SELECT * FROM outgoing_checks')) return [[]];
        if (statement.includes('FROM outgoing_checks oc')) return [[]];
        return [[]];
    });
    await assert.rejects(
        () => financeService.registerBulkSupplierPayments({ supplierId: 's', allocations: [{ invoiceId: 'i', payments: [{ amount: 1 }] }] }, 'u'),
        (e) => e.errorCode === 'INVOICE_NOT_FOUND'
    );
    assert.deepEqual(await financeService.getOutgoingChecks(), []);
    assert.equal(await financeService.getOutgoingCheck('missing'), null);
    await assert.rejects(() => financeService.updateOutgoingCheckStatus('x', { status: 'bad' }, 'u'), (e) => e.errorCode === 'INVALID_OUTGOING_CHECK_STATUS');
    target = 'outgoing';
    await assert.rejects(() => financeService.updateOutgoingCheckStatus('x', { status: 'cancelled' }, 'u'), (e) => e.errorCode === 'OUTGOING_CHECK_NOT_FOUND');
});

test('bulk invoice collection covers missing, overpaid and successful mixed invoices', async (t) => {
    let mode = 'missing';
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM invoices WHERE id')) {
            if (mode === 'missing') return [[]];
            return [[{
                id: 'i', client_id: 'c', total_amount: 100, payment_method: 'cash',
                invoice_type: 'B', point_of_sale: 1, invoice_number: 2, order_id: 'o'
            }]];
        }
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: mode === 'overpaid' ? 90 : 0 }]];
        if (statement.includes('SELECT id, status FROM orders')) return [[{ id: 'o', status: mode === 'cancelled' ? 'cancelled' : 'packed' }]];
        return [[]];
    });
    const payload = { clientId: 'c', allocations: [{ invoiceId: 'i', payments: [{ method: 'cash', amount: 100 }] }] };
    await assert.rejects(() => financeService.registerBulkInvoicePayments(payload, 'u'), (e) => e.errorCode === 'INVOICE_NOT_FOUND');
    mode = 'overpaid';
    await assert.rejects(() => financeService.registerBulkInvoicePayments(payload, 'u'), (e) => e.errorCode === 'PAYMENTS_EXCEED_TOTAL');

    const originals = { register: financeService._registerInvoicePayments, audit: auditService.log };
    financeService._registerInvoicePayments = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        financeService._registerInvoicePayments = originals.register;
        auditService.log = originals.audit;
    });
    mode = 'success';
    const result = await financeService.registerBulkInvoicePayments({
        clientId: 'c', notes: '', allocations: [{ documentId: 'i', documentType: 'invoice', payments: [
            { method: 'cash', amount: 50 }, { method: 'bank', amount: 50 }
        ] }]
    }, null);
    assert.equal(result.total_paid, 100);
    assert.equal(result.invoices[0].payment_status, 'paid');
    assert.ok(calls.some((call) => call.params?.includes('multiple')));
    assert.ok(calls.some((call) => call.params?.includes('completed')));

    mode = 'cancelled';
    const cancelled = await financeService.registerBulkInvoicePayments(payload, 'u');
    assert.equal(cancelled.invoices[0].payment_status, 'paid');
    assert.ok(calls.some((call) => call.params?.[1] === 'cancelled'));
});

test('order collection rejects overpayments and allocates received cheques before invoicing', async (t) => {
    let mode = 'overpay';
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('FROM orders o')) return [[{ id: 'o', client_id: 'c', receivable_amount: 100 }]];
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: mode === 'overpay' ? 90 : 0 }]];
        if (statement.includes('SELECT id, amount FROM customer_checks')) return [[]];
        return [[]];
    });
    const check = {
        issuer_name: 'Ana', bank_name: 'Banco', check_number: 'C-1', due_date: '2026-09-01', instrument_amount: 100
    };
    const payload = { clientId: 'c', allocations: [{ documentType: 'order', documentId: 'o', payments: [{ method: 'check', amount: 100, check }] }] };
    await assert.rejects(() => financeService.registerBulkInvoicePayments(payload, 'u'), (e) => e.errorCode === 'PAYMENTS_EXCEED_TOTAL');
    mode = 'success';
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async () => {};
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });
    const result = await financeService.registerBulkInvoicePayments(payload, 'u');
    assert.equal(result.total_paid, 100);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO customer_check_allocations')));
});

test('supplier bulk payment rejects overpayment before mutating balances', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM supplier_invoices')) return [[{ id: 'i', supplier_id: 's', total_amount: 100 }]];
        if (statement.includes('SUM(amount)')) return [[{ paid_amount: 90 }]];
        return [[]];
    });
    await assert.rejects(
        () => financeService.registerBulkSupplierPayments({ supplierId: 's', allocations: [{ invoiceId: 'i', payments: [{ amount: 20, method: 'cash' }] }] }, 'u'),
        (e) => e.errorCode === 'PAYMENTS_EXCEED_TOTAL'
    );
});
