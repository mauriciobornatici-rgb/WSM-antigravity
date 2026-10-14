import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool } from './helpers/qaDb.js';
import salesService from '../services/sales.service.js';
import clientService from '../services/client.service.js';

test.after(async () => {
    await closePool();
});

async function seedClient({ condition = null, taxId = null } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
        'INSERT INTO clients (id, name, tax_id, tax_condition_id) VALUES (?, ?, ?, ?)',
        [id, `QA Reemisión ${id.slice(0, 8)}`, taxId ?? `dni-${id.slice(0, 8)}`, condition]
    );
    return id;
}

// Sum of debits minus credits of one account over the entries of a document and their reversals.
async function netOf(invoiceId, accountCode) {
    const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS net
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_code = ?
           AND (je.reference_id = ? OR je.reversal_of_entry_id IN (
                SELECT id FROM (SELECT id FROM journal_entries WHERE reference_type = 'invoice' AND reference_id = ?) own))`,
        [accountCode, invoiceId, invoiceId]
    );
    return Math.round(Number(row.net) * 100) / 100;
}

test('ADR-022: an invoice ARCA rejected is annulled and issued again to the right customer, money untouched', async () => {
    const anonymousBuyer = await seedClient({ condition: 'tc_ConsFinal' });
    const company = await seedClient({ condition: 'tc_RespInscripto', taxId: `30${String(Date.now()).slice(-9)}` });
    const invoice = await salesService.createManualInvoice({
        client_id: anonymousBuyer,
        invoice_type: 'B',
        point_of_sale: 97,
        items: [{ description: 'Pelota QA', quantity: 1, unit_price: 1000, vat_rate: 21 }],
        payments: [{ method: 'cash', amount: 500 }],
    }, null);
    await pool.query("UPDATE invoices SET arca_last_error = '(10243) Condición IVA del receptor inválida' WHERE id = ?", [invoice.id]);
    const [[balanceBefore]] = await pool.query('SELECT current_account_balance AS b FROM clients WHERE id = ?', [anonymousBuyer]);

    const reissued = await salesService.reissueInvoice(invoice.id, { invoice_type: 'A', client_id: company }, null);

    // The new invoice: same amounts and lines, the right letter and customer, linked to the old one.
    assert.equal(reissued.invoice_type, 'A');
    assert.equal(reissued.client_id, company);
    assert.equal(reissued.client_tax_condition, 'Responsable Inscripto');
    assert.equal(Number(reissued.total_amount), Number(invoice.total_amount));
    assert.equal(reissued.replaces_invoice_id, invoice.id);
    assert.match(reissued.replaces_label, /^B-0097-/);
    assert.equal(reissued.status, 'issued');
    assert.equal(reissued.items.length, 1);

    // The old one stays as a record, out of every list.
    const [[old]] = await pool.query('SELECT status, deleted_at FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(old.status, 'cancelled');
    assert.ok(old.deleted_at);
    assert.equal(await salesService.getInvoiceById(invoice.id), null);

    // The ledger: the old sale is fully reversed (never deleted), the new one posted once.
    assert.equal(await netOf(invoice.id, '4.1.01.01'), 0);
    assert.equal(await netOf(reissued.id, '4.1.01.01'), -Number(reissued.net_amount));
    const [[{ posted }]] = await pool.query(
        "SELECT COUNT(*) AS posted FROM journal_entries WHERE reference_type = 'invoice' AND reference_id = ?",
        [invoice.id]
    );
    assert.ok(Number(posted) >= 2, 'sale and collection entries of the old invoice are kept');

    // The collection follows the sale and the customer; so does the outstanding balance.
    const [moved] = await pool.query("SELECT reference_id, client_id, amount FROM transactions WHERE reference_id IN (?, ?) AND type = 'sale'", [invoice.id, reissued.id]);
    assert.deepEqual(moved.map((row) => [row.reference_id, row.client_id, Number(row.amount)]), [[reissued.id, company, 500]]);
    const [[balanceAfter]] = await pool.query('SELECT current_account_balance AS b FROM clients WHERE id = ?', [anonymousBuyer]);
    const [[companyBalance]] = await pool.query('SELECT current_account_balance AS b FROM clients WHERE id = ?', [company]);
    assert.equal(Number(balanceBefore.b) - Number(balanceAfter.b), 710);
    assert.equal(Number(companyBalance.b), 710);

    // Once annulled it cannot be annulled again.
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'B' }, null), (error) => error.statusCode === 404);
});

test('ADR-022: an invoice of an order is reissued and the order points to the new one (one invoice per order)', async () => {
    const buyer = await seedClient({ condition: 'tc_ConsFinal' });
    const orderId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO orders (id, client_id, customer_name, status, total_amount) VALUES (?, ?, 'QA', 'completed', 242)",
        [orderId, buyer]
    );
    const invoice = await salesService.createManualInvoice({
        client_id: buyer, invoice_type: 'B', point_of_sale: 97,
        items: [{ description: 'Gorra QA', quantity: 2, unit_price: 100, vat_rate: 21 }],
    }, null);
    await pool.query('UPDATE invoices SET order_id = ? WHERE id = ?', [orderId, invoice.id]);
    await pool.query('UPDATE orders SET invoice_id = ? WHERE id = ?', [invoice.id, orderId]);

    const company = await seedClient({ condition: 'tc_RespInscripto', taxId: `30${String(Date.now()).slice(-9)}` });
    // Owed on account: it cannot be left without a debtor (AUD-010).
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'B', client_id: null }, null), (error) => error.errorCode === 'outstanding_requires_client');
    const ticket = await salesService.reissueInvoice(invoice.id, { invoice_type: 'A', client_id: company }, null);
    assert.equal(ticket.order_id, orderId);
    const [[order]] = await pool.query('SELECT invoice_id, client_id FROM orders WHERE id = ?', [orderId]);
    assert.deepEqual([order.invoice_id, order.client_id], [ticket.id, company], 'the order follows the invoice and its customer');
    const [[old]] = await pool.query('SELECT order_id, status FROM invoices WHERE id = ?', [invoice.id]);
    assert.deepEqual([old.order_id, old.status], [null, 'cancelled']);
    const [[audit]] = await pool.query("SELECT old_values FROM audit_logs WHERE entity_id = ? AND action = 'REISSUE_INVOICE'", [ticket.id]);
    const oldValues = typeof audit.old_values === 'string' ? JSON.parse(audit.old_values) : audit.old_values;
    assert.equal(oldValues.order_id, orderId, 'the order of the annulled invoice stays in the audit');
});

test('ADR-022: an invoice with a CAE, in ARCA, unchanged or for the wrong customer is not reissued', async () => {
    const buyer = await seedClient({ condition: 'tc_ConsFinal' });
    const invoice = await salesService.createManualInvoice({
        client_id: buyer, invoice_type: 'B', point_of_sale: 97,
        items: [{ description: 'Media QA', quantity: 2, unit_price: 100, vat_rate: 21 }],
    }, null);
    // Nothing to change.
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, {}, null), (error) => error.statusCode === 422 && error.errorCode === 'nothing_to_change');
    // The letter must suit the customer (a Consumidor Final receives B).
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'A' }, null), (error) => error.errorCode === 'invoice_cuit_required');
    // An electronic invoice never becomes a ticket.
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'TK' }, null), (error) => error.errorCode === 'reissue_letter_not_allowed');
    // In verification with ARCA.
    await pool.query("UPDATE invoices SET status = 'authorizing' WHERE id = ?", [invoice.id]);
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'TK' }, null), (error) => error.statusCode === 409 && error.errorCode === 'invoice_not_reissuable');
    // Authorized: it takes a credit note.
    await pool.query("UPDATE invoices SET status = 'authorized', cae = '12345678901234' WHERE id = ?", [invoice.id]);
    await assert.rejects(() => salesService.reissueInvoice(invoice.id, { invoice_type: 'TK' }, null), /nota de crédito/);
    const [[row]] = await pool.query('SELECT deleted_at FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(row.deleted_at, null);
});

test('ADR-022: the VAT condition is loaded at the moment of use, with the CUIT a Responsable Inscripto needs', async () => {
    const id = await seedClient();
    await assert.rejects(
        () => clientService.setTaxCondition({ id, body: { tax_condition_id: 'tc_RespInscripto' } }),
        (error) => error.statusCode === 422 && error.errorCode === 'cuit_required'
    );
    const cuit = `20${String(Date.now()).slice(-9)}`;
    const updated = await clientService.setTaxCondition({ id, body: { tax_condition_id: 'tc_RespInscripto', tax_id: cuit } });
    assert.deepEqual([updated.tax_condition_id, updated.tax_id], ['tc_RespInscripto', cuit]);
    // A Monotributista with a DNI is fine (it receives a B).
    const other = await seedClient();
    const mono = await clientService.setTaxCondition({ id: other, body: { tax_condition_id: 'tc_Monotributo' } });
    assert.equal(mono.tax_condition_id, 'tc_Monotributo');
    // Someone else's CUIT is refused.
    await assert.rejects(
        () => clientService.setTaxCondition({ id: other, body: { tax_condition_id: 'tc_RespInscripto', tax_id: cuit } }),
        (error) => error.statusCode === 409
    );
    const [audit] = await pool.query("SELECT action FROM audit_logs WHERE entity_id = ? AND action = 'UPDATE_CLIENT_TAX_CONDITION'", [id]);
    assert.equal(audit.length, 1);
});
