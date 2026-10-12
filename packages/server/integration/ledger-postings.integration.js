import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, stockOf } from './helpers/qaDb.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';
import { creditNotesService, warrantiesService } from '../services/warranties.service.js';

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

    const result = await supplierPaymentService.createSupplierPayment({
        supplier_id: supplierId,
        payments: [{ amount: 80, payment_method: 'transfer' }, { amount: 50, payment_method: 'Efectivo' }],
    }, null);

    assert.deepEqual(await postedLines('supplier_payment', result.ids[0]), { '1.1.02.01': -80, '2.1.01.01': 80 });
    assert.deepEqual(await postedLines('supplier_payment', result.ids[1]), { '1.1.01.01': -50, '2.1.01.01': 50 });
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), -30, 'overpayment stays as a credit (ADR-011), not clamped to 0');
});

test('C2: a manual credit note lowers sales and output VAT against receivables', async () => {
    const clientId = crypto.randomUUID();
    await pool.query('INSERT INTO clients (id, name) VALUES (?, ?)', [clientId, `Cliente QA ${clientId.slice(0, 8)}`]);
    const [[settings]] = await pool.query('SELECT tax_rate FROM company_settings WHERE id = 1');
    const raw = settings?.tax_rate == null ? 0.21 : Number(settings.tax_rate);
    const rate = raw > 1 ? raw / 100 : raw;

    const note = await creditNotesService.createManualCreditNote({ client_id: clientId, amount: 121, reference_type: 'discount' }, null, null);

    const net = Math.round((121 / (1 + rate)) * 100) / 100;
    const lines = await postedLines('credit_note', note.id);
    assert.equal(lines['1.1.03.01'], -121);
    assert.equal(lines['4.1.01.01'], net);
    assert.equal(Math.round((lines['2.1.02.02'] || 0) * 100) / 100, Math.round((121 - net) * 100) / 100);
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
    assert.deepEqual(await postedLines('warranty_claim', id), { '1.1.04.01': -40, '5.1.02.01': 40 });
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
