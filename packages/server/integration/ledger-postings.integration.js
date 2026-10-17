import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedClientWithInvoice, seedProduct, stockOf } from './helpers/qaDb.js';
import financeService from '../services/finance.service.js';
import accountingService from '../services/accounting.service.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';
import { creditNotesService, warrantiesService } from '../services/warranties.service.js';
import inventoryService from '../services/inventory.service.js';

test.after(async () => {
    await closePool();
});

// Lines posted for a reference, as { account: signed amount (debit − credit) }.
async function postedLines(referenceType, referenceId) {
    const [rows] = await pool.query(
        `SELECT jl.account_code, SUM(jl.debit) - SUM(jl.credit) AS net
         FROM journal_entries je JOIN journal_entry_lines jl ON jl.journal_entry_id = je.id
         WHERE je.reference_type = ? AND je.reference_id = ?
         GROUP BY jl.account_code`,
        [referenceType, referenceId]
    );
    return Object.fromEntries(rows.map((row) => [row.account_code, Number(row.net)]));
}

test('C1: a supplier payment from the suppliers screen is posted and may leave a balance in our favour', async () => {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name, account_balance) VALUES (?, ?, 100)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);

    // ADR-014: cash comes out of an open drawer (this test's own register).
    const registerId = crypto.randomUUID();
    const shiftId = crypto.randomUUID();
    await pool.query("INSERT INTO cash_registers (id, name, status, current_shift_id) VALUES (?, 'Caja QA', 'open', ?)", [registerId, shiftId]);
    await pool.query("INSERT INTO cash_shifts (id, cash_register_id, opening_balance, expected_balance, status) VALUES (?, ?, 60, 60, 'open')", [shiftId, registerId]);

    const result = await supplierPaymentService.createSupplierPayment({
        supplier_id: supplierId,
        cash_register_id: registerId,
        payments: [{ amount: 80, payment_method: 'transfer' }, { amount: 50, payment_method: 'Efectivo' }],
    }, null);

    const [[shift]] = await pool.query('SELECT expected_balance FROM cash_shifts WHERE id = ?', [shiftId]);
    assert.equal(Number(shift.expected_balance), 10, 'only the cash line leaves the drawer');
    await assert.rejects(
        () => supplierPaymentService.createSupplierPayment({ supplier_id: supplierId, cash_register_id: registerId, payments: [{ amount: 11, payment_method: 'Efectivo' }] }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'insufficient_cash'
    );
    await pool.query("UPDATE cash_shifts SET status = 'closed' WHERE id = ?", [shiftId]);

    assert.deepEqual(await postedLines('supplier_payment', result.ids[0]), { '1.1.02.01': -80, '2.1.01.01': 80 });
    assert.deepEqual(await postedLines('supplier_payment', result.ids[1]), { '1.1.01.01': -50, '2.1.01.01': 50 });
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), -30, 'overpayment stays as a credit (ADR-011), not clamped to 0');
});

test('C2/ADR-014: a manual credit note on an invoice lowers sales and VAT in the invoice proportion', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice({ total: 1210, vat: 210, type: 'A' });

    const note = await creditNotesService.createManualCreditNote({ client_id: clientId, invoice_id: invoiceId, amount: 121, reference_type: 'discount' }, null, null);

    assert.equal(note.credit_note_type, 'A');
    assert.deepEqual(await postedLines('credit_note', note.id), { '1.1.03.01': -121, '2.1.02.02': 21, '4.1.01.01': 100 });
    const [[row]] = await pool.query('SELECT invoice_id, credit_note_type FROM credit_notes WHERE id = ?', [note.id]);
    assert.deepEqual([row.invoice_id, row.credit_note_type], [invoiceId, 'A']);
});

test('ADR-014: a warranty refused by the supplier takes the defective unit through quarantine and writes it off', async () => {
    const productId = await seedProduct({ stock: [] });
    await pool.query('UPDATE products SET purchase_price = 25 WHERE id = ?', [productId]);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO warranty_claims (id, product_id, issue_description, status) VALUES (?, ?, 'Falla', 'initiated')", [id, productId]);

    await warrantiesService.updateWarrantyStatus(id, { status: 'received' }, null, null);
    await warrantiesService.updateWarrantyStatus(id, { status: 'received' }, null, null); // repeated: no second intake
    const [[quarantined]] = await pool.query("SELECT quantity FROM inventory WHERE product_id = ? AND location = 'Cuarentena'", [productId]);
    assert.equal(Number(quarantined.quantity), 1);

    await warrantiesService.updateWarrantyStatus(id, { status: 'sent_to_supplier' }, null, null);
    await warrantiesService.updateWarrantyStatus(id, { status: 'supplier_rejected' }, null, null);

    assert.equal((await stockOf(productId)).quantity, 0);
    const [movements] = await pool.query('SELECT type, from_location, to_location FROM inventory_movements WHERE reference_id = ? ORDER BY created_at, type', [id]);
    assert.deepEqual(movements.map((m) => m.type).sort(), ['warranty_intake', 'warranty_to_supplier', 'warranty_writeoff']);
    // Intake (Inventario / Costo de garantías) and write-off (Costo de garantías / Inventario) net to zero on inventory.
    assert.deepEqual(await postedLines('warranty_claim', id), { '1.1.04.01': 0, '5.1.02.03': 0 });
});

test('ADR-014: a repaired warranty hands the unit back: no phantom unit stays in quarantine', async () => {
    const productId = await seedProduct({ stock: [] });
    await pool.query('UPDATE products SET purchase_price = 30 WHERE id = ?', [productId]);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO warranty_claims (id, product_id, issue_description, status) VALUES (?, ?, 'Falla', 'initiated')", [id, productId]);

    await warrantiesService.updateWarrantyStatus(id, { status: 'received' }, null, null);
    // The cost changes meanwhile: the unit in quarantine is revalued with the rest (ADR-027).
    await inventoryService.updateProduct(productId, { purchase_price: 45 }, null, null, 'admin');
    await warrantiesService.updateWarrantyStatus(id, { status: 'resolved', resolution_type: 'repaired' }, null, null);
    await warrantiesService.updateWarrantyStatus(id, { status: 'closed' }, null, null);

    assert.equal((await stockOf(productId)).quantity, 0);
    // Written off at today's cost (45), the value it had in the ledger: in at 30, revalued by 15,
    // out at 45. Inventory nets to zero; the 15 is warranty cost against the holding gain.
    assert.deepEqual(await postedLines('warranty_claim', id), { '1.1.04.01': -15, '5.1.02.03': 15 });
    assert.deepEqual(await postedLines('stock_revaluation', productId), { '1.1.04.01': 15, '4.2.02.01': -15 });
});

test('ADR-014: a refunded warranty keeps the defective unit (ours now) in quarantine at cost', async () => {
    const productId = await seedProduct({ stock: [] });
    await pool.query('UPDATE products SET purchase_price = 30 WHERE id = ?', [productId]);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO warranty_claims (id, product_id, issue_description, status) VALUES (?, ?, 'Falla', 'initiated')", [id, productId]);

    await warrantiesService.updateWarrantyStatus(id, { status: 'received' }, null, null);
    await warrantiesService.updateWarrantyStatus(id, { status: 'resolved', resolution_type: 'refunded' }, null, null);

    const [[row]] = await pool.query("SELECT quantity FROM inventory WHERE product_id = ? AND location = 'Cuarentena'", [productId]);
    assert.equal(Number(row.quantity), 1);
});

test('ADR-014: a manual note on a cancelled invoice is refused', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice();
    await pool.query("UPDATE invoices SET status = 'cancelled' WHERE id = ?", [invoiceId]);
    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: clientId, invoice_id: invoiceId, amount: 10 }, null, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'invoice_cancelled'
    );
});

test('ADR-014: card settlements move the pending card balance to the bank, never more than pending', async () => {
    // A card collection of 1000 waiting to be deposited.
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await accountingService.createJournalEntry(connection, {
            date: new Date(), description: 'QA cobro con tarjeta', reference_type: 'qa', reference_id: crypto.randomUUID(),
            lines: [{ account_code: '1.1.02.03', debit: 1000, credit: 0 }, { account_code: '1.1.03.01', debit: 0, credit: 1000 }],
        });
        await connection.commit();
    } finally {
        connection.release();
    }
    const [[before]] = await pool.query("SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS v FROM journal_entry_lines WHERE account_code = '1.1.02.03'");
    const pending = Number(before.v);
    await assert.rejects(
        () => financeService.createCardSettlement({ amount: pending + 1000 }, null, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'exceeds_pending_card_balance'
    );
    const half = Math.floor(pending / 2);
    // Two concurrent settlements of more than half the balance: only one fits.
    const results = await Promise.allSettled([
        financeService.createCardSettlement({ amount: half + 1, fee_amount: 1 }, null, null),
        financeService.createCardSettlement({ amount: half + 1, fee_amount: 1 }, null, null),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const settled = results.find((r) => r.status === 'fulfilled').value;
    // ADR-015: the processor's fee (1, VAT included) splits into 0.83 net + 0.17 VAT fiscal credit.
    assert.deepEqual(await postedLines('card_settlement', settled.id), { '1.1.02.01': half, '1.1.02.03': -(half + 1), '5.1.02.04': 0.83, '1.1.05.02': 0.17 });
});

test('U1: resolving a warranty by replacement takes one unit out of stock at cost, once', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-W', quantity: 3 }] });
    await pool.query('UPDATE products SET purchase_price = 40 WHERE id = ?', [productId]);
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO warranty_claims (id, product_id, issue_description, status) VALUES (?, ?, 'Falla', 'in_progress')", [id, productId]);

    await warrantiesService.updateWarrantyStatus(id, { status: 'resolved', resolution_type: 'replaced', notes: 'Unidad nueva' }, null, null);
    // Saving the same resolution again does not hand out a second unit...
    await warrantiesService.updateWarrantyStatus(id, { status: 'resolved', resolution_type: 'replaced' }, null, null);
    // ...nor does moving the claim out of "resolved" from the status form and back again.
    await warrantiesService.updateWarrantyStatus(id, { status: 'sent_to_supplier', notes: 'Reclamo al proveedor' }, null, null);
    await warrantiesService.updateWarrantyStatus(id, { status: 'resolved' }, null, null);

    assert.equal((await stockOf(productId)).quantity, 2);
    const [movements] = await pool.query("SELECT type, from_location, quantity, unit_cost FROM inventory_movements WHERE reference_id = ?", [id]);
    assert.deepEqual(movements.map((m) => [m.type, m.from_location, Number(m.quantity), Number(m.unit_cost)]), [['warranty_replacement', 'QA-W', 1, 40]]);
    assert.deepEqual(await postedLines('warranty_claim', id), { '1.1.04.01': -40, '5.1.02.03': 40 });
    const [[claim]] = await pool.query('SELECT status, resolution_type, resolution_notes FROM warranty_claims WHERE id = ?', [id]);
    assert.deepEqual([claim.status, claim.resolution_type, claim.resolution_notes], ['resolved', 'replaced', 'Reclamo al proveedor']);
});

test('a manual credit note on a return that already has its note is refused', async () => {
    const clientId = crypto.randomUUID();
    await pool.query('INSERT INTO clients (id, name) VALUES (?, ?)', [clientId, `Cliente QA ${clientId.slice(0, 8)}`]);
    const returnId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO credit_notes (id, number, client_id, reference_type, reference_id, amount, status)
         VALUES (?, ?, ?, 'return', ?, 121, 'issued')`,
        [crypto.randomUUID(), `NC-QA-${returnId.slice(0, 8)}`, clientId, returnId]
    );

    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: clientId, amount: 121, reference_type: 'return', reference_id: returnId }, null, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'return_already_credited'
    );
});

test('U1: a replacement without stock is refused and changes nothing', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-W', quantity: 1, reserved: 1 }] });
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO warranty_claims (id, product_id, issue_description, status) VALUES (?, ?, 'Falla', 'in_progress')", [id, productId]);

    await assert.rejects(
        () => warrantiesService.updateWarrantyStatus(id, { status: 'resolved', resolution_type: 'replaced' }, null, null),
        (err) => err.statusCode === 409
    );
    const [[claim]] = await pool.query('SELECT status FROM warranty_claims WHERE id = ?', [id]);
    assert.equal(claim.status, 'in_progress');
    assert.equal((await stockOf(productId)).quantity, 1);
});
