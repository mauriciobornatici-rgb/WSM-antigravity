import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createSupplierInvoice,
    getPendingSupplierInvoices,
    getSupplierInvoices,
    registerBulkSupplierPayments
} from '../controllers/supplierInvoiceController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import financeService from '../services/finance.service.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) { statusCode = code; return this; },
            json(body) { settled = true; resolve({ status: statusCode, body }); return this; }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try { handler(req, res, next); } catch (error) { next(error); }
    });
}

function installPool(t, handler) {
    const calls = [];
    const lifecycle = [];
    const run = async (sql, params = []) => {
        const statement = norm(sql);
        // The supplier row lock that opens the invoice transaction is answered apart from `calls`.
        if (statement.startsWith('SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) {
            return [[{ id: params[0] }]];
        }
        calls.push({ statement, params });
        return handler(statement, params);
    };
    const connection = {
        query: run,
        async beginTransaction() { lifecycle.push('begin'); },
        async commit() { lifecycle.push('commit'); },
        async rollback() { lifecycle.push('rollback'); },
        release() { lifecycle.push('release'); }
    };
    const prev = { query: pool.query, getConnection: pool.getConnection };
    pool.query = run;
    pool.getConnection = async () => connection;
    t.after(() => {
        pool.query = prev.query;
        pool.getConnection = prev.getConnection;
    });
    return { calls, lifecycle, connection };
}

function stub(t, target, name, fn) {
    const prev = target[name];
    target[name] = fn;
    t.after(() => { target[name] = prev; });
}

const invoiceBody = {
    invoice_number: '0001-00000010',
    invoice_type: 'A',
    supplier_id: 's1',
    issue_date: '2026-03-01',
    net_amount: 100,
    vat_amount: 21,
    other_taxes: 5.01,
    notes: 'nota'
};

test('getSupplierInvoices lists without filters', async (t) => {
    const { calls } = installPool(t, async () => [[{ id: 'i1' }]]);
    const res = await runHandler(getSupplierInvoices);
    assert.deepEqual(res.body, [{ id: 'i1' }]);
    assert.deepEqual(calls[0].params, []);
    assert.ok(!calls[0].statement.includes('AND si.supplier_id'));
});

test('getSupplierInvoices applies supplier and status filters', async (t) => {
    const { calls } = installPool(t, async () => [[]]);
    await runHandler(getSupplierInvoices, { query: { supplier_id: 's1', status: 'approved' } });
    assert.ok(calls[0].statement.includes('AND si.supplier_id = ?'));
    assert.ok(calls[0].statement.includes('AND si.status = ?'));
    assert.deepEqual(calls[0].params, ['s1', 'approved']);
});

test('createSupplierInvoice rejects duplicates with 409 and rolls back without posting', async (t) => {
    const { calls, lifecycle } = installPool(t, async () => [[{ id: 'dup' }]]);
    stub(t, accountingService, 'createJournalEntry', async () => { throw new Error('should not post'); });
    const res = await runHandler(createSupplierInvoice, { body: invoiceBody });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'duplicate_invoice');
    assert.match(res.body.message, /A 0001-00000010/);
    assert.deepEqual(calls[0].params, ['s1', 'A', '0001-00000010']);
    assert.equal(calls.length, 1);
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
});

test('createSupplierInvoice persists invoice, balance, ledger, journal entry and audit', async (t) => {
    const { calls, lifecycle, connection } = installPool(t, async (statement) => {
        // ADR-019: the delivery note is this supplier's, not invoiced yet, and received 100 net.
        if (statement.startsWith('SELECT id, supplier_id, status')) return [[{ id: 'r1', supplier_id: 's1', status: 'approved', remito_number: 'R-1' }]];
        if (statement.includes('AS net FROM reception_items')) return [[{ net: 100 }]];
        return [[]];
    });
    const journals = [];
    stub(t, accountingService, 'createJournalEntry', async (conn, entry) => { journals.push({ conn, entry }); });
    const logs = [];
    stub(t, auditService, 'log', async (payload, conn) => { logs.push({ payload, conn }); });

    const res = await runHandler(createSupplierInvoice, {
        body: { ...invoiceBody, reception_id: 'r1', purchase_order_id: 'po1', due_date: '2026-04-01' },
        user: { id: 'u1' }
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.total_amount, 126.01);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);

    const insert = calls.find((c) => c.statement.startsWith('INSERT INTO supplier_invoices'));
    assert.equal(insert.params[4], 'r1');
    assert.equal(insert.params[5], 'po1');
    assert.equal(insert.params[7], '2026-04-01');
    assert.deepEqual(insert.params.slice(8, 12), [100, 21, 5.01, 126.01]);
    assert.equal(insert.params[13], 'u1');

    const balance = calls.find((c) => c.statement.includes('UPDATE suppliers SET account_balance'));
    assert.deepEqual(balance.params, [126.01, 's1']);

    const ledger = calls.find((c) => c.statement.startsWith('INSERT INTO transactions'));
    assert.equal(ledger.params[1], 126.01);
    assert.equal(ledger.params[3], insert.params[0]);

    // ADR-008: only the supplier invoice posts inventory + IVA CF against Proveedores.
    assert.equal(journals.length, 1);
    assert.equal(journals[0].conn, connection);
    const { lines, reference_type: refType } = journals[0].entry;
    assert.equal(refType, 'supplier_invoice');
    assert.equal(lines[0].account_code, '1.1.04.01');
    assert.equal(lines[0].debit, 100);
    assert.equal(lines[1].account_code, '1.1.05.02');
    assert.equal(lines[1].debit, 21);
    assert.match(lines[1].notes, /21%/);
    // ADR-016: perceptions are tax paid in advance, not inventory cost.
    assert.equal(lines[2].account_code, '1.1.05.04');
    assert.equal(lines[2].debit, 5.01);
    assert.equal(lines[3].account_code, '2.1.01.01');
    assert.equal(lines[3].credit, 126.01);
    const debits = Math.round((lines[0].debit + lines[1].debit + lines[2].debit) * 100) / 100;
    assert.equal(debits, lines[3].credit);

    assert.equal(logs[0].conn, connection);
    assert.equal(logs[0].payload.action, 'CREATE_SUPPLIER_INVOICE');
    assert.equal(logs[0].payload.user_id, 'u1');
});

test('createSupplierInvoice derives total, uses defaults and non-A note', async (t) => {
    const { calls } = installPool(t, async () => [[]]);
    const journals = [];
    stub(t, accountingService, 'createJournalEntry', async (_c, entry) => { journals.push(entry); });
    stub(t, auditService, 'log', async () => {});
    const res = await runHandler(createSupplierInvoice, {
        body: { invoice_number: '1', invoice_type: 'C', supplier_id: 's1', net_amount: 50, vat_amount: 10.5, total_amount: 60.5 }
    });
    assert.equal(res.body.total_amount, 60.5);
    const insert = calls.find((c) => c.statement.startsWith('INSERT INTO supplier_invoices'));
    assert.equal(insert.params[4], null);
    assert.equal(insert.params[5], null);
    assert.equal(insert.params[7], null);
    assert.equal(insert.params[12], null);
    assert.equal(insert.params[13], null);
    // ADR-016: a Factura C gives no fiscal credit: its VAT is part of the cost.
    assert.deepEqual(journals[0].lines.map((line) => [line.account_code, line.debit, line.credit]), [
        ['1.1.04.01', 60.5, 0], ['2.1.01.01', 0, 60.5]
    ]);
    assert.ok(journals[0].date instanceof Date);

    // An invoice with no net amount is refused (it would post an empty purchase).
    const none = await runHandler(createSupplierInvoice, {
        body: { invoice_number: '2', invoice_type: 'C', supplier_id: 's1' }
    });
    assert.equal(none.status, 400);
    assert.equal(none.body.error, 'invalid_net_amount');

    // A typed total that disagrees with its parts would post an unbalanced entry.
    const mismatch = await runHandler(createSupplierInvoice, {
        body: { invoice_number: '3', invoice_type: 'A', supplier_id: 's1', net_amount: 100, vat_amount: 21, total_amount: 150 }
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.error, 'invalid_invoice_total');
});

test('createSupplierInvoice rolls back and releases when the journal entry fails', async (t) => {
    const { lifecycle } = installPool(t, async () => [[]]);
    stub(t, accountingService, 'createJournalEntry', async () => { throw new Error('asiento invalido'); });
    let audited = false;
    stub(t, auditService, 'log', async () => { audited = true; });
    await assert.rejects(() => runHandler(createSupplierInvoice, { body: invoiceBody }), /asiento invalido/);
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
    assert.equal(audited, false);
});

test('getPendingSupplierInvoices returns empty list without querying payments', async (t) => {
    const { calls } = installPool(t, async () => [[]]);
    const res = await runHandler(getPendingSupplierInvoices);
    assert.deepEqual(res.body, []);
    assert.equal(calls.length, 1);
});

test('getPendingSupplierInvoices computes paid and pending amounts', async (t) => {
    const { calls } = installPool(t, async (statement) => {
        if (statement.includes('FROM supplier_payments')) {
            return [[{ supplier_invoice_id: 'i1', paid_amount: '40' }, { supplier_invoice_id: 'i3', paid_amount: null }]];
        }
        return [[
            { id: 'i1', total_amount: '100' },
            { id: 'i2', total_amount: '30' },
            { id: 'i3', total_amount: null }
        ]];
    });
    const res = await runHandler(getPendingSupplierInvoices, { query: { supplier_id: 's1' } });
    assert.ok(calls[0].statement.includes('AND si.supplier_id = ?'));
    assert.deepEqual(calls[0].params, ['s1']);
    assert.deepEqual(calls[1].params, [['i1', 'i2', 'i3']]);
    assert.deepEqual(res.body.map((r) => [r.paid_amount, r.pending_amount]), [[40, 60], [0, 30], [0, 0]]);
});

test('getPendingSupplierInvoices never reports negative pending amount', async (t) => {
    installPool(t, async (statement) => {
        if (statement.includes('FROM supplier_payments')) return [[{ supplier_invoice_id: 'i1', paid_amount: 150 }]];
        return [[{ id: 'i1', total_amount: 100 }]];
    });
    const res = await runHandler(getPendingSupplierInvoices);
    assert.equal(res.body[0].pending_amount, 0);
});

test('registerBulkSupplierPayments delegates to finance service with the authenticated user', async (t) => {
    const received = [];
    stub(t, financeService, 'registerBulkSupplierPayments', async (...args) => { received.push(args); return { ok: true }; });
    const payload = { supplier_id: 's1', payments: [] };
    const res = await runHandler(registerBulkSupplierPayments, { body: payload, user: { id: 'u9' } });
    assert.deepEqual(res.body, { ok: true });
    assert.deepEqual(received[0], [payload, 'u9']);

    await runHandler(registerBulkSupplierPayments, { body: payload });
    assert.equal(received[1][1], null);
});
