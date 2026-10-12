import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, uniqueId } from './helpers/qaDb.js';
import accountingService from '../services/accounting.service.js';
import {
    DUPLICATE_CLASSES, classifyDuplicates, diagnoseDuplicates, findCandidateInvoiceEntries,
    findReceptionEntries, reverseDuplicates,
} from '../scripts/purchase-entries/purchaseEntries.js';

test.after(async () => {
    await closePool();
});

// Reproduces the ADR-010 defect: a reception posted the same accounts
// (inventario / IVA CF / proveedores) that the supplier invoice posts again.
async function postJournalEntry({ referenceType, referenceId, net, vat, total }) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const id = await accountingService.createJournalEntry(connection, {
            date: new Date(),
            description: `QA ${referenceType} ${referenceId}`,
            reference_type: referenceType,
            reference_id: referenceId,
            lines: [
                { account_code: '1.1.04.01', debit: net, credit: 0, notes: 'Inventario QA' },
                { account_code: '1.1.05.02', debit: vat, credit: 0, notes: 'IVA Crédito Fiscal QA' },
                { account_code: '2.1.01.01', debit: 0, credit: total, notes: 'Proveedores QA' },
            ],
        });
        await connection.commit();
        return id;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

async function seedSupplier() {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [id, `Proveedor QA ${id.slice(0, 8)}`]);
    return id;
}

async function seedPurchaseOrder(supplierId) {
    const id = crypto.randomUUID();
    await pool.query(
        `INSERT INTO purchase_orders (id, po_number, supplier_id, order_date, status, total_amount)
         VALUES (?, ?, ?, CURDATE(), 'approved', 1210)`,
        [id, uniqueId('PO'), supplierId]
    );
    return id;
}

async function seedReception({ supplierId, purchaseOrderId = null }) {
    const id = crypto.randomUUID();
    await pool.query(
        `INSERT INTO receptions (id, reception_number, purchase_order_id, supplier_id, status)
         VALUES (?, ?, ?, ?, 'approved')`,
        [id, uniqueId('REC'), purchaseOrderId, supplierId]
    );
    return id;
}

async function seedSupplierInvoice({ supplierId, receptionId = null, purchaseOrderId = null, net, vat, total }) {
    const id = crypto.randomUUID();
    await pool.query(
        `INSERT INTO supplier_invoices (id, invoice_number, invoice_type, supplier_id, reception_id, purchase_order_id, issue_date, net_amount, vat_amount, total_amount)
         VALUES (?, ?, 'A', ?, ?, ?, CURDATE(), ?, ?, ?)`,
        [id, uniqueId('INV'), supplierId, receptionId, purchaseOrderId, net, vat, total]
    );
    return id;
}

async function entryLines(entryId) {
    const [rows] = await pool.query(
        'SELECT account_code, debit, credit FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY account_code',
        [entryId]
    );
    return rows.map((row) => ({ account_code: row.account_code, debit: Number(row.debit), credit: Number(row.credit) }));
}

async function isReversed(entryId) {
    const [rows] = await pool.query('SELECT 1 FROM journal_entries WHERE reversal_of_entry_id = ?', [entryId]);
    return rows.length > 0;
}

async function diagnoseReadOnly() {
    const connection = await pool.getConnection();
    try {
        await connection.query('START TRANSACTION READ ONLY');
        const duplicates = await diagnoseDuplicates(connection);
        await connection.query('ROLLBACK');
        return duplicates;
    } finally {
        connection.release();
    }
}

async function tableCounts() {
    const [[entries]] = await pool.query('SELECT COUNT(*) AS n FROM journal_entries');
    const [[lines]] = await pool.query('SELECT COUNT(*) AS n FROM journal_entry_lines');
    return { entries: Number(entries.n), lines: Number(lines.n) };
}

test('exact duplicate: classified, reversed with a balanced swapped contra-asiento, original untouched, idempotent on a second run', async () => {
    const supplierId = await seedSupplier();
    const receptionId = await seedReception({ supplierId });
    const receptionEntryId = await postJournalEntry({ referenceType: 'reception', referenceId: receptionId, net: 1000, vat: 210, total: 1210 });
    const invoiceId = await seedSupplierInvoice({ supplierId, receptionId, net: 1000, vat: 210, total: 1210 });
    await postJournalEntry({ referenceType: 'supplier_invoice', referenceId: invoiceId, net: 1000, vat: 210, total: 1210 });

    const duplicates = await diagnoseReadOnly();
    const dup = duplicates.find((d) => d.entry_id === receptionEntryId);
    assert.ok(dup, 'the reception entry must be detected');
    assert.equal(dup.class, DUPLICATE_CLASSES.EXACT);
    assert.equal(dup.matched_invoices.length, 1);
    assert.equal(dup.matched_invoices[0].invoice_id, invoiceId);
    assert.equal(dup.matched_invoices[0].linked_by, 'reception_id');
    assert.equal(dup.total_debit, 1210);

    const originalLines = await entryLines(receptionEntryId);

    const result = await reverseDuplicates(accountingService, duplicates, { classes: ['exact'], userId: null });
    const reversedRecord = result.reversed.find((r) => r.entry_id === receptionEntryId);
    assert.ok(reversedRecord, 'the exact duplicate must be reversed');

    assert.equal(await isReversed(receptionEntryId), true);
    assert.deepEqual(await entryLines(receptionEntryId), originalLines, 'the original entry is never modified');

    const contraLines = await entryLines(reversedRecord.reversal_entry_id);
    assert.deepEqual(contraLines.sort((a, b) => a.account_code.localeCompare(b.account_code)), [
        { account_code: '1.1.04.01', debit: 0, credit: 1000 },
        { account_code: '1.1.05.02', debit: 0, credit: 210 },
        { account_code: '2.1.01.01', debit: 1210, credit: 0 },
    ]);
    const totalDebit = contraLines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = contraLines.reduce((sum, l) => sum + l.credit, 0);
    assert.equal(totalDebit, totalCredit, 'contra-asiento must be balanced');

    // Second run: the entry is no longer picked up as an unreversed reception entry.
    const duplicatesAfter = await diagnoseReadOnly();
    assert.equal(duplicatesAfter.find((d) => d.entry_id === receptionEntryId), undefined);

    // Applying again over the (now stale) first diagnosis is idempotent: skipped, not an error.
    const secondAttempt = await reverseDuplicates(accountingService, duplicates, { classes: ['exact'], userId: null });
    const skipped = secondAttempt.skipped.find((s) => s.entry_id === receptionEntryId);
    assert.ok(skipped, 'a second reversal attempt must be skipped, not erroring');
    assert.equal(secondAttempt.errors.length, 0);
});

test('probable duplicate (same purchase order, no direct reception_id link): classified but not reversed by default', async () => {
    const supplierId = await seedSupplier();
    const purchaseOrderId = await seedPurchaseOrder(supplierId);
    const receptionId = await seedReception({ supplierId, purchaseOrderId });
    const receptionEntryId = await postJournalEntry({ referenceType: 'reception', referenceId: receptionId, net: 500, vat: 105, total: 605 });
    const invoiceId = await seedSupplierInvoice({ supplierId, purchaseOrderId, net: 500, vat: 105, total: 605 });
    await postJournalEntry({ referenceType: 'supplier_invoice', referenceId: invoiceId, net: 500, vat: 105, total: 605 });

    const duplicates = await diagnoseReadOnly();
    const dup = duplicates.find((d) => d.entry_id === receptionEntryId);
    assert.ok(dup);
    assert.equal(dup.class, DUPLICATE_CLASSES.PROBABLE);
    assert.equal(dup.matched_invoices[0].linked_by, 'purchase_order_id');

    const result = await reverseDuplicates(accountingService, duplicates, { classes: ['exact'], userId: null });
    assert.equal(result.targets, duplicates.filter((d) => d.class === 'exact').length);
    assert.equal(result.reversed.some((r) => r.entry_id === receptionEntryId), false);
    assert.equal(await isReversed(receptionEntryId), false, 'a probable duplicate is never touched by the default run');
});

test('pending_invoice (no supplier invoice posted yet): classified, and not reversed by default', async () => {
    const supplierId = await seedSupplier();
    const receptionId = await seedReception({ supplierId });
    const receptionEntryId = await postJournalEntry({ referenceType: 'reception', referenceId: receptionId, net: 300, vat: 63, total: 363 });

    const duplicates = await diagnoseReadOnly();
    const dup = duplicates.find((d) => d.entry_id === receptionEntryId);
    assert.ok(dup);
    assert.equal(dup.class, DUPLICATE_CLASSES.PENDING_INVOICE);
    assert.equal(dup.matched_invoices.length, 0);

    const result = await reverseDuplicates(accountingService, duplicates, { classes: ['exact'], userId: null });
    assert.equal(result.reversed.some((r) => r.entry_id === receptionEntryId), false);
    assert.equal(await isReversed(receptionEntryId), false);
});

test('an already-reversed reception entry is not reported again', async () => {
    const supplierId = await seedSupplier();
    const receptionId = await seedReception({ supplierId });
    const receptionEntryId = await postJournalEntry({ referenceType: 'reception', referenceId: receptionId, net: 100, vat: 21, total: 121 });
    await accountingService.reverseJournalEntry(receptionEntryId, null);

    const duplicates = await diagnoseReadOnly();
    assert.equal(duplicates.find((d) => d.entry_id === receptionEntryId), undefined);
});

test('diagnose (findReceptionEntries / findCandidateInvoiceEntries / classifyDuplicates) writes nothing', async () => {
    const supplierId = await seedSupplier();
    const receptionId = await seedReception({ supplierId });
    await postJournalEntry({ referenceType: 'reception', referenceId: receptionId, net: 200, vat: 42, total: 242 });
    const invoiceId = await seedSupplierInvoice({ supplierId, receptionId, net: 200, vat: 42, total: 242 });
    await postJournalEntry({ referenceType: 'supplier_invoice', referenceId: invoiceId, net: 200, vat: 42, total: 242 });

    const before = await tableCounts();
    const connection = await pool.getConnection();
    try {
        await connection.query('START TRANSACTION READ ONLY');
        const receptionEntries = await findReceptionEntries(connection);
        const invoiceEntries = await findCandidateInvoiceEntries(
            connection,
            receptionEntries.map((e) => e.reception_id),
            receptionEntries.map((e) => e.purchase_order_id)
        );
        const duplicates = classifyDuplicates(receptionEntries, invoiceEntries);
        assert.ok(duplicates.length > 0);
        await connection.query('ROLLBACK');
    } finally {
        connection.release();
    }
    const after = await tableCounts();
    assert.deepEqual(after, before, 'diagnosis must not write any row');
});
