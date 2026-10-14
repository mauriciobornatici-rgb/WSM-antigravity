import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import salesService from '../services/sales.service.js';
import treasuryService from '../services/treasury.service.js';
import { returnsService } from '../services/warranties.service.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });

test.after(async () => {
    await closePool();
});

async function entryLines(referenceType, referenceId) {
    const [rows] = await pool.query(
        `SELECT jl.account_code, jl.debit, jl.credit FROM journal_entry_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.reference_type = ? AND je.reference_id = ?`,
        [referenceType, referenceId]
    );
    return rows.map((row) => ({ account: row.account_code, debit: Number(row.debit), credit: Number(row.credit) }));
}

const cents = (value) => Math.round(Number(value) * 100);

test('ADR-016: returning units one by one refunds exactly what the invoice charged', async () => {
    // 3 units at net 27.5482 (21 %) are charged 100.00: a third is not a whole cent.
    const productId = await seedProduct({ salePrice: 27.5482, stock: [{ location: 'QA-A', quantity: 10 }] });
    const order = await createOrder.execute({ external_source: 'pos', external_id: crypto.randomUUID(), items: [{ product_id: productId, quantity: 3 }] }, null);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 96 }, null);
    const [[stored]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(stored.total_amount), 100);

    const refunds = [];
    for (let unit = 0; unit < 3; unit++) {
        const created = await returnsService.createReturn({ order_id: order.id, reason: 'Cambio', items: [{ product_id: productId, quantity: 1 }] });
        const approved = await returnsService.approveReturn(created.id, null);
        refunds.push(approved.total_amount);
        const [[item]] = await pool.query('SELECT refund_amount FROM client_return_items WHERE return_id = ?', [created.id]);
        assert.equal(Number(item.refund_amount), approved.total_amount);
    }
    assert.deepEqual(refunds, [33.33, 33.34, 33.33]);
    const [[credited]] = await pool.query('SELECT SUM(amount) AS total FROM credit_notes WHERE invoice_id = ?', [invoice.id]);
    assert.equal(cents(credited.total), 10000, 'the notes add up to the invoice, not a cent more or less');
});

test('ADR-016: shipping and discounts of a channel order are invoiced next to the detail', async () => {
    const productA = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const productB = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    await pool.query('UPDATE products SET vat_rate = 10.5 WHERE id = ?', [productB]);
    // 121 + 110.50 of products, 1000 shipping, a 23.15 discount split by rate: paid 1208.35.
    const order = await createOrder.execute({
        external_source: 'tiendanube',
        external_id: crypto.randomUUID(),
        external_total_amount: 1208.35,
        items: [{ product_id: productA, quantity: 1, unit_price: 100 }, { product_id: productB, quantity: 1, unit_price: 100 }],
        adjustments: [
            { kind: 'shipping', description: 'Envío', amount: 1000, vat_rate: 21 },
            { kind: 'discount', description: 'Descuento IVA 10.5%', amount: -11.05, vat_rate: 10.5 },
            { kind: 'discount', description: 'Descuento IVA 21%', amount: -12.10, vat_rate: 21 },
        ],
    }, null);
    const [[orderRow]] = await pool.query('SELECT total_amount FROM orders WHERE id = ?', [order.id]);
    assert.equal(Number(orderRow.total_amount), 1208.35);

    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 96 }, null);
    const [[invoiceRow]] = await pool.query('SELECT total_amount, net_amount, vat_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(invoiceRow.total_amount), 1208.35, 'the invoice adds up to what the customer paid');
    assert.equal(cents(invoiceRow.net_amount) + cents(invoiceRow.vat_amount), cents(invoiceRow.total_amount));
    const [lines] = await pool.query('SELECT product_id, description, total_line, vat_rate FROM invoice_items WHERE invoice_id = ? ORDER BY total_line DESC', [invoice.id]);
    assert.equal(lines.length, 5);
    assert.deepEqual(lines.filter((line) => line.product_id === null).map((line) => line.description).sort(),
        ['Descuento IVA 10.5%', 'Descuento IVA 21%', 'Envío']);

    // Output VAT per rate, and the entry balances.
    const sale = await entryLines('invoice', invoice.id);
    const debit = sale.reduce((sum, line) => sum + cents(line.debit), 0);
    const credit = sale.reduce((sum, line) => sum + cents(line.credit), 0);
    assert.equal(debit, credit);
    assert.ok(sale.some((line) => line.account === '2.1.02.01' && line.credit > 0), 'IVA 10,5 % in its own account');
    assert.ok(sale.some((line) => line.account === '2.1.02.02' && line.credit > 0), 'IVA 21 % in its own account');
});

test('ADR-016: bank debits leave the bank with their VAT credit and the opening balance is admin-only', async () => {
    const before = (await treasuryService.getBankSummary()).balance;
    const result = await treasuryService.createBankCharges({
        idempotency_key: crypto.randomUUID(),
        charges: [{ concept: 'commission', amount: 121 }, { concept: 'debits_credits_tax', amount: 6 }],
    }, null);
    assert.equal(result.total, 127);
    const after = (await treasuryService.getBankSummary()).balance;
    assert.equal(cents(before) - cents(after), 12700);
    const lines = await entryLines('bank_charge', result.id);
    assert.ok(lines.some((line) => line.account === '1.1.05.02' && line.debit === 21));

    await assert.rejects(
        () => treasuryService.transfer({ from: 'initial', to: 'treasury', amount: 10, idempotency_key: crypto.randomUUID() }, null, null, { role: 'manager' }),
        (err) => err.statusCode === 403
    );
});

test('ADR-016: with a coupon over three products, returning them one by one credits exactly the invoice', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await seedProduct({ salePrice: 82.6446, stock: [{ location: 'QA-A', quantity: 3 }] }));
    const order = await createOrder.execute({
        external_source: 'tiendanube',
        external_id: crypto.randomUUID(),
        external_total_amount: 200,
        items: ids.map((id) => ({ product_id: id, quantity: 1, unit_price: 82.6446 })),
        adjustments: [{ kind: 'discount', description: 'Descuento', amount: -100, vat_rate: 21 }],
    }, null);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 96 }, null);
    const [[stored]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(stored.total_amount), 200);
    for (const productId of ids) {
        const created = await returnsService.createReturn({ order_id: order.id, reason: 'Arrepentimiento', items: [{ product_id: productId, quantity: 1 }] });
        await returnsService.approveReturn(created.id, null);
    }
    const [[credited]] = await pool.query('SELECT SUM(amount) AS total FROM credit_notes WHERE invoice_id = ?', [invoice.id]);
    assert.equal(cents(credited.total), 20000, 'the three notes add up to the invoice exactly');
});

test('ADR-016: a partially picked order keeps the discount percentage and can only return what was invoiced', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 10 }] });
    // 4 units of 121 = 484, a 10 % coupon (-48.40): paid 435.60.
    const order = await createOrder.execute({
        external_source: 'tiendanube',
        external_id: crypto.randomUUID(),
        external_total_amount: 435.6,
        items: [{ product_id: productId, quantity: 4, unit_price: 100 }],
        adjustments: [{ kind: 'discount', description: 'Descuento', amount: -48.4, vat_rate: 21 }],
    }, null);
    // Only 2 units picked: the invoice bills 242 - 24.20 (still 10 %).
    await pool.query('UPDATE order_items SET picked_quantity = 2 WHERE order_id = ?', [order.id]);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 96 }, null);
    const [[stored]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(stored.total_amount), 217.8);
    await assert.rejects(
        () => returnsService.createReturn({ order_id: order.id, reason: 'Cambio', items: [{ product_id: productId, quantity: 3 }] }),
        (err) => err.statusCode === 409
    );
});
