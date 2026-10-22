import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';

// ADR-029: an invoice that charges more units than its delivery notes have left puts them in
// "Notas de crédito a recibir" (1.1.06.01), and the supplier's credit note settles it.

async function ledgerOf(referenceType, referenceId) {
    const [rows] = await pool.query(
        `SELECT jel.account_code, jel.debit, jel.credit
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.reference_type = ? AND je.reference_id = ?
         ORDER BY jel.account_code, jel.debit, jel.credit`,
        [referenceType, referenceId]
    );
    return rows.map((row) => [row.account_code, Number(row.debit), Number(row.credit)]);
}

async function seedSupplier() {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    return supplierId;
}

async function receiveWithoutOrder(supplierId, productId, quantity, unitCost) {
    const { default: receptionService } = await import('../domains/procurement/ReceptionService.js');
    const { QualityCheckService } = await import('../domains/procurement/QualityCheckService.js');
    const { default: goodsReceptionService } = await import('../domains/procurement/GoodsReceptionService.js');
    const reception = await receptionService.createReception({
        supplier_id: supplierId, remito_number: `R-${crypto.randomUUID().slice(0, 8)}`,
        items: [{ product_id: productId, quantity_received: quantity, unit_cost: unitCost, location_assigned: 'QA-A' }],
    }, null, null, { canEditCost: true });
    await new QualityCheckService().createQualityCheck({
        reception_id: reception.id, product_id: productId, result: 'passed',
        quantity_checked: quantity, quantity_passed: quantity, quantity_failed: 0,
    }, null);
    await goodsReceptionService.processReceptionApproval(reception.id, {});
    const [[line]] = await pool.query('SELECT id FROM reception_items WHERE reception_id = ?', [reception.id]);
    return { receptionId: reception.id, lineId: line.id };
}

async function services() {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const { SupplierCreditNoteService } = await import('../domains/procurement/SupplierCreditNoteService.js');
    const { default: financeService } = await import('../services/finance.service.js');
    return { invoices: new SupplierInvoiceService(), notes: new SupplierCreditNoteService(), finance: financeService };
}

const number = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

async function creditToReceive(...references) {
    const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS balance FROM journal_entries e
         JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '1.1.06.01'
         WHERE e.reference_id IN (?)`,
        [references]
    );
    return Number(row.balance);
}

function pay(finance, supplierId, invoiceId, amount) {
    return finance.registerBulkSupplierPayments({
        supplierId, allocations: [{ invoiceId, payments: [{ amount, method: 'transfer' }] }],
    }, null);
}

test('a Factura A that charges a unit of more: the unit waits in 1.1.06.01 and the credit note settles it', async () => {
    const { invoices, notes, finance } = await services();
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 100, salePrice: 200 });
    const { receptionId, lineId } = await receiveWithoutOrder(supplierId, productId, 2, 100);

    const items = [{ reception_item_id: lineId, quantity: 3, unit_cost: 100 }];
    const base = {
        invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21', reception_ids: [receptionId],
        net_amount: 300, vat_amount: 63, vat_rate: 21, total_amount: 363, items,
    };
    await assert.rejects(
        () => invoices.createSupplierInvoice({ ...base, invoice_number: number('A') }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'invoice_exceeds_reception'
    );
    const invoice = await invoices.createSupplierInvoice({ ...base, invoice_number: number('A'), expect_credit_note: true }, null);
    assert.equal(invoice.credit_expected, 100);
    assert.deepEqual(await ledgerOf('supplier_invoice', invoice.id), [
        ['1.1.05.02', 63, 0], ['1.1.06.01', 100, 0], ['2.1.01.01', 0, 363], ['2.1.01.02', 200, 0],
    ]);
    const [[line]] = await pool.query('SELECT invoiced_quantity FROM reception_items WHERE id = ?', [lineId]);
    assert.equal(Number(line.invoiced_quantity), 2, 'only the units received are taken from the delivery note');
    const [[item]] = await pool.query('SELECT quantity, excess_quantity FROM supplier_invoice_items WHERE supplier_invoice_id = ?', [invoice.id]);
    assert.deepEqual([Number(item.quantity), Number(item.excess_quantity)], [2, 1]);

    // 200 paid, then the credit note: 363 - 200 - 121 leaves 42 to pay.
    await pay(finance, supplierId, invoice.id, 200);
    const credit = await notes.createCreditNote({
        supplier_invoice_id: invoice.id, credit_note_number: number('NCA'), issue_date: '2026-10-22',
        net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121,
    }, null);
    assert.deepEqual([credit.applied_amount, credit.credit_left, credit.payment_status], [100, 0, 'partial']);
    assert.deepEqual(await ledgerOf('supplier_credit_note', credit.id), [['1.1.05.02', 0, 21], ['1.1.06.01', 0, 100], ['2.1.01.01', 121, 0]]);
    assert.equal(await creditToReceive(invoice.id, credit.id), 0);

    const [pending] = await invoices.getPendingSupplierInvoices({ supplier_id: supplierId });
    assert.deepEqual([pending.paid_amount, pending.credited_amount, pending.pending_amount], [200, 121, 42]);
    await assert.rejects(() => pay(finance, supplierId, invoice.id, 50), (err) => err.errorCode === 'PAYMENTS_EXCEED_TOTAL' && /notas de crédito/.test(err.message));
    await pay(finance, supplierId, invoice.id, 42);
    const [[status]] = await pool.query('SELECT payment_status FROM supplier_invoices WHERE id = ?', [invoice.id]);
    assert.equal(status.payment_status, 'paid');
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), 0);

    // Nothing left to receive: another note for this invoice is refused.
    await assert.rejects(
        () => notes.createCreditNote({
            supplier_invoice_id: invoice.id, credit_note_number: number('NCA'), issue_date: '2026-10-22', net_amount: 10, vat_amount: 2.1, vat_rate: 21,
        }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'no_credit_note_expected'
    );

    // The IVA book shows the note, negative.
    const book = await invoices.getPurchasesVatBook();
    const row = book.find((record) => record.type === 'Nota de crédito A' && record.supplier_name.startsWith('Proveedor QA') && record.total === -121);
    assert.ok(row);
    assert.deepEqual([row.subtotal, row.iva], [-100, -21]);
    const [listed] = await notes.getCreditNotes({ supplier_invoice_id: invoice.id });
    assert.equal(Number(listed.applied_amount), 100);
});

test('a delivery note invoiced twice by a Factura B: the second one waits whole; notes in parts and beyond it', async () => {
    const { invoices, notes } = await services();
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 50 });
    const { receptionId, lineId } = await receiveWithoutOrder(supplierId, productId, 2, 50);
    await invoices.createSupplierInvoice({
        invoice_number: number('B'), invoice_type: 'B', supplier_id: supplierId, issue_date: '2026-10-21', reception_ids: [receptionId],
        net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121,
    }, null);

    const again = {
        invoice_type: 'B', supplier_id: supplierId, issue_date: '2026-10-21', reception_ids: [receptionId],
        net_amount: 50, vat_amount: 10.5, vat_rate: 21, total_amount: 60.5, items: [{ reception_item_id: lineId, quantity: 1, unit_cost: 50 }],
    };
    await assert.rejects(
        () => invoices.createSupplierInvoice({ ...again, invoice_number: number('B') }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'reception_already_invoiced'
    );
    // The first Factura B left the cost at 60.50 (its VAT is cost); units never received do not move it.
    const [[before]] = await pool.query('SELECT purchase_price FROM products WHERE id = ?', [productId]);
    assert.equal(Number(before.purchase_price), 60.5);
    const twice = await invoices.createSupplierInvoice({ ...again, invoice_number: number('B'), expect_credit_note: true }, null);
    // A Factura B puts its VAT in the cost: all of it is owed back.
    assert.deepEqual(await ledgerOf('supplier_invoice', twice.id), [['1.1.06.01', 60.5, 0], ['2.1.01.01', 0, 60.5]]);
    const [[product]] = await pool.query('SELECT purchase_price FROM products WHERE id = ?', [productId]);
    assert.equal(Number(product.purchase_price), 60.5);

    const first = await notes.createCreditNote({
        supplier_invoice_id: twice.id, credit_note_number: number('NCB'), issue_date: '2026-10-22', net_amount: 30, vat_amount: 6.3, vat_rate: 21,
    }, null);
    assert.deepEqual([first.applied_amount, first.credit_left], [36.3, 24.2]);
    await assert.rejects(
        () => notes.createCreditNote({
            supplier_invoice_id: twice.id, credit_note_type: 'A', credit_note_number: number('NCA'), issue_date: '2026-10-22', net_amount: 30, vat_amount: 6.3,
        }, null),
        (err) => err.statusCode === 400 && err.responseBody.error === 'credit_note_type_mismatch'
    );
    const secondNumber = number('NCB');
    const second = await notes.createCreditNote({
        supplier_invoice_id: twice.id, credit_note_number: secondNumber, issue_date: '2026-10-22', net_amount: 30, vat_amount: 6.3, vat_rate: 21,
    }, null);
    // 24.20 were left: the other 12.10 are a better price than invoiced (holding result).
    assert.deepEqual(await ledgerOf('supplier_credit_note', second.id), [['1.1.06.01', 0, 24.2], ['2.1.01.01', 36.3, 0], ['4.2.02.01', 0, 12.1]]);
    assert.equal(await creditToReceive(twice.id, first.id, second.id), 0);
    await assert.rejects(
        () => notes.createCreditNote({
            supplier_invoice_id: twice.id, credit_note_number: secondNumber, issue_date: '2026-10-22', net_amount: 1, vat_amount: 0.21,
        }, null),
        (err) => err.statusCode === 409 && ['duplicate_credit_note', 'no_credit_note_expected'].includes(err.responseBody.error)
    );
});

test('two notes for the same credit at the same time: one settles it, the other is refused; a payment beside them waits', async () => {
    const { invoices, notes, finance } = await services();
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 80 });
    const { receptionId, lineId } = await receiveWithoutOrder(supplierId, productId, 1, 80);
    const invoice = await invoices.createSupplierInvoice({
        invoice_number: number('A'), invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21', reception_ids: [receptionId],
        net_amount: 160, vat_amount: 33.6, vat_rate: 21, total_amount: 193.6, expect_credit_note: true,
        items: [{ reception_item_id: lineId, quantity: 2, unit_cost: 80 }],
    }, null);
    const note = () => notes.createCreditNote({
        supplier_invoice_id: invoice.id, credit_note_number: number('NCA'), issue_date: '2026-10-22', net_amount: 80, vat_amount: 16.8, vat_rate: 21,
    }, null);
    const results = await Promise.allSettled([note(), note(), pay(finance, supplierId, invoice.id, 96.8)]);
    const [a, b, payment] = results;
    assert.equal(payment.status, 'fulfilled', String(payment.reason));
    const settled = [a, b].filter((result) => result.status === 'fulfilled');
    const refused = [a, b].filter((result) => result.status === 'rejected');
    assert.equal(settled.length, 1);
    assert.equal(refused[0].reason.responseBody.error, 'no_credit_note_expected');
    assert.equal(await creditToReceive(invoice.id, settled[0].value.id), 0);
    const [[status]] = await pool.query('SELECT payment_status FROM supplier_invoices WHERE id = ?', [invoice.id]);
    assert.equal(status.payment_status, 'paid');
});

test.after(async () => {
    await closePool();
});
