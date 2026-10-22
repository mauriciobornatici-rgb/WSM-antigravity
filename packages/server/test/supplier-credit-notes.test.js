import test from 'node:test';
import assert from 'node:assert/strict';

import { SupplierCreditNoteService } from '../domains/procurement/SupplierCreditNoteService.js';
import { SupplierInvoiceService } from '../domains/procurement/SupplierInvoiceService.js';
import { normalizeVoucherNumber, purchaseDocumentAmounts } from '../domains/procurement/purchaseDocumentAmounts.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

// ADR-029: the supplier's credit note settles what its invoice left in 1.1.06.01.

function harness(t, { invoice = {}, applied = 0, credited = 0, paid = 0, duplicate = false, supplier = true, failOn = null } = {}) {
    const calls = [];
    const conn = mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (failOn && statement.includes(failOn.statement)) throw failOn.error;
        if (statement.includes('FROM supplier_invoices WHERE id = ? FOR UPDATE')) {
            return [invoice === null ? [] : [{
                id: 'inv', supplier_id: 's', invoice_type: 'A', invoice_number: '0001-1', status: 'approved',
                total_amount: 399.3, credit_expected_amount: 110, ...invoice,
            }]];
        }
        if (statement.includes('FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [supplier ? [{ id: params[0] }] : []];
        if (statement.includes('SUM(applied_amount)')) return [[{ applied, credited }]];
        if (statement.includes('SELECT id FROM supplier_credit_notes')) return [duplicate ? [{ id: 'old' }] : []];
        if (statement.includes('FROM supplier_payments')) return [[{ paid }]];
        return [[]];
    });
    let rolledBack = false;
    conn.rollback = async () => { rolledBack = true; };
    const entries = [];
    const audits = [];
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async (_c, entry) => { entries.push(entry); return 'je'; };
    auditService.log = async (entry) => { audits.push(entry); };
    t.after(() => { accountingService.createJournalEntry = originals.journal; auditService.log = originals.audit; });
    return { service: new SupplierCreditNoteService(), calls, entries, audits, rolledBack: () => rolledBack };
}

const note = (overrides = {}) => ({
    supplier_invoice_id: 'inv', credit_note_number: '0001-7', issue_date: '2026-10-21',
    net_amount: 110, vat_amount: 23.1, vat_rate: 21, total_amount: 133.1, ...overrides,
});
const lines = (entry) => entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);

test('a credit note A settles 1.1.06.01, reverses its VAT credit and lowers the debt', async (t) => {
    const { service, entries, calls, audits } = harness(t, { paid: 266.2 });
    const result = await service.createCreditNote(note(), 'u');

    assert.deepEqual(lines(entries[0]), [['2.1.01.01', 133.1, 0], ['1.1.06.01', 0, 110], ['1.1.05.02', 0, 23.1]]);
    assert.equal(entries[0].reference_type, 'supplier_credit_note');
    const saved = calls.find(({ statement }) => statement.startsWith('INSERT INTO supplier_credit_notes'));
    // The number is kept as point of sale-number: '0001-7' is 0001-00000007 (AUD-018).
    assert.deepEqual(saved.params.slice(1, 11), ['s', 'inv', 'A', '0001-00000007', '2026-10-21', 110, 23.1, 0, 133.1, 110]);
    const balance = calls.find(({ statement }) => statement.startsWith('UPDATE suppliers SET account_balance'));
    assert.deepEqual(balance.params, [133.1, 's']);
    const movement = calls.find(({ statement }) => statement.startsWith('INSERT INTO transactions'));
    assert.equal(movement.params[1], 133.1);
    assert.match(movement.params[2], /Nota de crédito A 0001-00000007/);
    // 266.20 paid + 133.10 credited settle the 399.30 invoice.
    const status = calls.find(({ statement }) => statement.startsWith('UPDATE supplier_invoices SET payment_status'));
    assert.deepEqual(status.params, ['paid', 'inv']);
    assert.deepEqual([result.applied_amount, result.holding_result, result.credit_left, result.payment_status], [110, 0, 0, 'paid']);
    assert.equal(audits[0].action, 'CREATE_SUPPLIER_CREDIT_NOTE');
});

test('a credit note B or C is worth its total; more than expected is holding result, less leaves the rest', async (t) => {
    // Factura B: the invoice put 121 (net and VAT) in 1.1.06.01.
    const bigger = harness(t, { invoice: { invoice_type: 'B', credit_expected_amount: 121, total_amount: 242 } });
    const biggerNote = note({ net_amount: 110, vat_amount: 23.1, total_amount: 133.1 });
    // More than expected books a gain: the user confirms it first (AUD-018).
    await assert.rejects(
        () => bigger.service.createCreditNote(biggerNote, 'u'),
        (err) => err.statusCode === 409 && err.responseBody.error === 'credit_note_exceeds_expected' && err.responseBody.excess_amount === 12.1
    );
    assert.equal(bigger.entries.length, 0);
    await bigger.service.createCreditNote({ ...biggerNote, accept_excess: true }, 'u');
    assert.deepEqual(lines(bigger.entries[0]), [['2.1.01.01', 133.1, 0], ['1.1.06.01', 0, 121], ['4.2.02.01', 0, 12.1]]);

    const smaller = harness(t, { invoice: { credit_expected_amount: 110 }, applied: 30, credited: 36.3 });
    const result = await smaller.service.createCreditNote(note({ net_amount: 50, vat_amount: 10.5, total_amount: 60.5 }), 'u');
    assert.deepEqual(lines(smaller.entries[0]), [['2.1.01.01', 60.5, 0], ['1.1.06.01', 0, 50], ['1.1.05.02', 0, 10.5]]);
    assert.deepEqual([result.applied_amount, result.credit_left, result.payment_status], [50, 30, 'partial']);
});

test('perceptions in the note go back to their account', async (t) => {
    const { service, entries } = harness(t);
    await service.createCreditNote(note({ other_taxes: 3, total_amount: 136.1 }), 'u');
    assert.deepEqual(lines(entries[0]), [['2.1.01.01', 136.1, 0], ['1.1.06.01', 0, 110], ['1.1.05.02', 0, 23.1], ['1.1.05.04', 0, 3]]);
});

test('a credit note needs an invoice with credit to receive, its letter and a new number', async (t) => {
    let h = harness(t, { invoice: null });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 404 && err.responseBody.error === 'supplier_invoice_not_found');
    h = harness(t, { invoice: { status: 'cancelled' } });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'supplier_invoice_cancelled');
    h = harness(t, { supplier: false });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 404 && err.responseBody.error === 'supplier_not_found');
    h = harness(t);
    await assert.rejects(
        () => h.service.createCreditNote(note({ credit_note_type: 'B' }), 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'credit_note_type_mismatch' && /factura A también es A/.test(err.message)
    );
    h = harness(t, { applied: 110 });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'no_credit_note_expected');
    h = harness(t, { invoice: { credit_expected_amount: 0 } });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'no_credit_note_expected');
    h = harness(t, { duplicate: true });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'duplicate_credit_note');
    assert.equal(h.entries.length, 0);
    assert.ok(h.rolledBack());
    // A second click after the first note settled everything says it is already registered (AUD-018).
    h = harness(t, { duplicate: true, applied: 110 });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.responseBody.error === 'duplicate_credit_note');
    // The notes of an invoice never add up to more than the invoice.
    h = harness(t, { invoice: { total_amount: 150 }, credited: 20 });
    await assert.rejects(
        () => h.service.createCreditNote(note(), 'u'),
        (err) => err.statusCode === 409 && err.responseBody.error === 'credit_note_exceeds_invoice' && /153\.10.*150\.00/.test(err.message)
    );
    // The fiscal credit is reversed at the note's own rate, never a guessed one.
    h = harness(t);
    await assert.rejects(() => h.service.createCreditNote(note({ vat_rate: undefined }), 'u'), (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_vat_rate');
    // Its amounts are checked like an invoice's.
    h = harness(t);
    await assert.rejects(() => h.service.createCreditNote(note({ total_amount: 140 }), 'u'), (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_invoice_total');
});

test('a race on the number or the locks answers 409, never a 500', async (t) => {
    let h = harness(t, { failOn: { statement: 'INSERT INTO supplier_credit_notes', error: Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }) } });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'duplicate_credit_note');
    h = harness(t, { failOn: { statement: 'FROM supplier_invoices WHERE id = ? FOR UPDATE', error: Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }) } });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'busy');
    h = harness(t, { failOn: { statement: 'INSERT INTO transactions', error: new Error('boom') } });
    await assert.rejects(() => h.service.createCreditNote(note(), 'u'), /boom/);
});

test('credit notes are listed by supplier or invoice', async (t) => {
    const { service, calls } = harness(t);
    await service.getCreditNotes({ supplier_id: 's', supplier_invoice_id: 'inv' });
    await service.getCreditNotes();
    assert.deepEqual(calls[0].params, ['s', 'inv']);
    assert.match(calls[0].statement, /scn\.supplier_id = \? AND scn\.supplier_invoice_id = \?/);
    assert.deepEqual(calls[1].params, []);
});

test('a note with several rates keeps its lines and reverses each fiscal credit in its account', async (t) => {
    const { service, entries, calls } = harness(t, { invoice: { credit_expected_amount: 200 } });
    await service.createCreditNote(note({
        net_amount: 200, vat_amount: 31.5, total_amount: 231.5, vat_rate: undefined,
        vat_lines: [{ vat_rate: 21, net_amount: 100, vat_amount: 21 }, { vat_rate: 10.5, net_amount: 100, vat_amount: 10.5 }],
    }), 'u');
    const saved = calls.filter(({ statement }) => statement.startsWith('INSERT INTO supplier_credit_note_vat_lines'));
    assert.deepEqual(saved.map(({ params }) => params.slice(2)), [[21, 100, 21], [10.5, 100, 10.5]]);
    assert.deepEqual(lines(entries[0]).map(([account, , credit]) => [account, credit]).slice(2), [['1.1.05.02', 21], ['1.1.05.01', 10.5]]);
});

test('the amounts of a purchase document are checked before anything is booked', () => {
    const base = { net_amount: 100, vat_amount: 21 };
    assert.deepEqual(purchaseDocumentAmounts({ ...base, other_taxes: 2 }), { vatLines: null, net: 100, vat: 21, taxes: 2, total: 123 });
    const refused = (data, error) => assert.throws(() => purchaseDocumentAmounts(data), (err) => err.statusCode === 400 && err.responseBody.error === error);
    refused({ net_amount: 0, vat_amount: 0 }, 'invalid_net_amount');
    refused({ ...base, vat_rate: 0 }, 'invalid_vat_rate');
    refused({ vat_lines: [{ vat_rate: 0, net_amount: 100, vat_amount: 21 }] }, 'invalid_vat_rate');
    refused({ vat_lines: [{ vat_rate: 21, net_amount: 100, vat_amount: 30 }] }, 'invalid_vat_line');
    refused({ net_amount: 90, vat_lines: [{ vat_rate: 21, net_amount: 100, vat_amount: 21 }] }, 'invalid_invoice_total');
    refused({ ...base, total_amount: 120 }, 'invalid_invoice_total');
    // AUD-018: a single rate's VAT is checked too; a VAT of 0 is a document without it.
    refused({ net_amount: 100, vat_amount: 30, vat_rate: 21 }, 'invalid_vat_line');
    assert.equal(purchaseDocumentAmounts({ net_amount: 100, vat_amount: 0, vat_rate: 21 }).total, 100);
    assert.equal(purchaseDocumentAmounts({ net_amount: 99.99, vat_amount: 21, vat_rate: 21 }).vat, 21);
});

test('voucher numbers are kept as point of sale-number', () => {
    assert.equal(normalizeVoucherNumber(' 1-123 '), '0001-00000123');
    assert.equal(normalizeVoucherNumber('00002 - 45'), '00002-00000045');
    assert.equal(normalizeVoucherNumber('NC sin formato'), 'NC sin formato');
    assert.equal(normalizeVoucherNumber(null), '');
});

test('the IVA book lists the supplier credit notes, negative', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM supplier_credit_notes scn')) {
            return [[{
                credit_note_type: 'A', credit_note_number: '0001-7', issue_date: '2026-10-22', supplier_name: 'Proveedor', supplier_tax_id: null,
                net_amount: '100.00', vat_amount: '21.00', other_taxes: '0.00', total_amount: '121.00',
            }]];
        }
        return [[]];
    });
    const book = await new SupplierInvoiceService().getPurchasesVatBook();
    assert.deepEqual(book.map(({ type, number, tax_id, subtotal, iva, total }) => [type, number, tax_id, subtotal, iva, total]), [
        ['Nota de crédito A', '0001-7', '-', -100, -21, -121],
    ]);
});
