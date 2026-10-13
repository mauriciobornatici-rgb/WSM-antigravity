import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import salesService from '../services/sales.service.js';
import inventoryService from '../services/inventory.service.js';
import { returnsService } from '../services/warranties.service.js';
import { SupplierInvoiceService } from '../domains/procurement/SupplierInvoiceService.js';
import { SupplierReturnService } from '../domains/procurement/SupplierReturnService.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });
const cents = (value) => Math.round(Number(value) * 100);

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

test('ADR-017: a charged shipping is billed and a return can give it back once', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await createOrder.execute({
        shipping_method: 'delivery',
        shipping_charge: { amount: 3000, charge_customer: true },
        items: [{ product_id: productId, quantity: 2 }],
    }, null);
    const [[orderRow]] = await pool.query('SELECT total_amount FROM orders WHERE id = ?', [order.id]);
    assert.equal(Number(orderRow.total_amount), 3242);

    // Not picked: an order never picked bills what it ordered.
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 95 }, null);
    const [[invoiceRow]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(invoiceRow.total_amount), 3242);
    const [[shippingLine]] = await pool.query("SELECT total_line FROM invoice_items WHERE invoice_id = ? AND adjustment_kind = 'shipping'", [invoice.id]);
    assert.equal(Number(shippingLine.total_line), 3000);

    const first = await returnsService.createReturn({ order_id: order.id, reason: 'Arrepentimiento', refund_shipping: true, items: [{ product_id: productId, quantity: 1 }] });
    const approved = await returnsService.approveReturn(first.id, null);
    assert.equal(approved.total_amount, 3121, 'one unit (121) plus the shipping (3000)');
    assert.equal(approved.shipping_refund_amount, 3000);
    const lines = await entryLines('client_return', first.id);
    assert.equal(lines.reduce((sum, line) => sum + cents(line.debit), 0), lines.reduce((sum, line) => sum + cents(line.credit), 0));

    // The shipping is given back once: a second return asking for it gets only the product.
    const second = await returnsService.createReturn({ order_id: order.id, reason: 'Arrepentimiento', refund_shipping: true, items: [{ product_id: productId, quantity: 1 }] });
    const secondApproved = await returnsService.approveReturn(second.id, null);
    assert.equal(secondApproved.total_amount, 121);
    const [[credited]] = await pool.query('SELECT SUM(amount) AS total FROM credit_notes WHERE invoice_id = ?', [invoice.id]);
    assert.equal(cents(credited.total), 324200, 'everything back: exactly the invoice');
});

test('ADR-017: a shipping absorbed by the business is kept on the order but never billed', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await createOrder.execute({
        shipping_method: 'delivery',
        shipping_charge: { amount: 2500, charge_customer: false },
        items: [{ product_id: productId, quantity: 1 }],
    }, null);
    const [[orderRow]] = await pool.query('SELECT total_amount FROM orders WHERE id = ?', [order.id]);
    assert.equal(Number(orderRow.total_amount), 121);
    const [[adjustment]] = await pool.query('SELECT amount, billable FROM order_adjustments WHERE order_id = ?', [order.id]);
    assert.deepEqual([Number(adjustment.amount), Number(adjustment.billable)], [2500, 0]);

    // Charging it later (before invoicing) updates the total.
    const updated = await salesService.updateOrderShipping(order.id, { amount: 2500, charge_customer: true }, null);
    assert.equal(updated.total_amount, 2621);
    const back = await salesService.updateOrderShipping(order.id, { amount: 2500, charge_customer: false }, null);
    assert.equal(back.total_amount, 121);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 95 }, null);
    const [[invoiceRow]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(invoiceRow.total_amount), 121);
});

test('ADR-017: a purchase with two rates and its return reverse the fiscal credit per rate', async () => {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const invoice = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-12',
        vat_lines: [{ vat_rate: 21, net_amount: 1000, vat_amount: 210 }, { vat_rate: 10.5, net_amount: 1000, vat_amount: 105 }],
        total_amount: 2315,
    }, null);
    const purchase = await entryLines('supplier_invoice', invoice.id);
    assert.ok(purchase.some((line) => line.account === '1.1.05.02' && line.debit === 210));
    assert.ok(purchase.some((line) => line.account === '1.1.05.01' && line.debit === 105));

    // A return of goods costing 200 net: VAT 31.50 split 2/3 at 21 % and 1/3 at 10.5 %.
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const returnId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO supplier_returns (id, return_number, supplier_id, status) VALUES (?, ?, ?, 'draft')",
        [returnId, `SR-QA-${returnId.slice(0, 8)}`, supplierId]
    );
    await pool.query(
        'INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost, reason) VALUES (?, ?, ?, 2, 100, ?)',
        [crypto.randomUUID(), returnId, productId, 'Falla']
    );
    await new SupplierReturnService().approveSupplierReturn(returnId, null);
    const reversal = await entryLines('supplier_return', returnId);
    const byAccount = Object.fromEntries(reversal.filter((line) => line.credit > 0).map((line) => [line.account, line.credit]));
    assert.equal(cents(byAccount['1.1.05.02']) + cents(byAccount['1.1.05.01']), 3150);
    assert.equal(byAccount['1.1.05.02'], 21);
    assert.equal(byAccount['1.1.05.01'], 10.5);
});

test('ADR-017: a product created with opening stock records its origin, rate and ledger entry', async () => {
    const sku = `QA-ORIG-${crypto.randomUUID().slice(0, 8)}`;
    const created = await inventoryService.createProduct({
        sku, name: 'Producto con stock inicial', purchase_price: 50, sale_price: 100, vat_rate: 10.5, stock_initial: 4, location: 'QA-A',
    }, null);
    const [[product]] = await pool.query('SELECT origin, vat_rate FROM products WHERE id = ?', [created.id]);
    assert.deepEqual([product.origin, Number(product.vat_rate)], ['erp', 10.5]);
    const entry = await entryLines('initial_stock', created.id);
    assert.deepEqual(entry.map((line) => [line.account, line.debit, line.credit]).sort(), [
        ['1.1.04.01', 200, 0], ['3.1.01.01', 0, 200],
    ]);
});

test('ADR-017 / AUD-006: two returns approved at the same time give the shipping back only once', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await createOrder.execute({
        shipping_method: 'delivery',
        shipping_charge: { amount: 1000, charge_customer: true },
        items: [{ product_id: productId, quantity: 2 }],
    }, null);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 95 }, null);
    const first = await returnsService.createReturn({ order_id: order.id, reason: 'Cambio', refund_shipping: true, items: [{ product_id: productId, quantity: 1 }] });
    const second = await returnsService.createReturn({ order_id: order.id, reason: 'Cambio', refund_shipping: true, items: [{ product_id: productId, quantity: 1 }] });
    const results = await Promise.all([returnsService.approveReturn(first.id, null), returnsService.approveReturn(second.id, null)]);
    assert.equal(results.reduce((sum, result) => sum + cents(result.shipping_refund_amount), 0), 100000, 'the shipping once');
    const [[credited]] = await pool.query('SELECT SUM(amount) AS total FROM credit_notes WHERE invoice_id = ?', [invoice.id]);
    assert.equal(cents(credited.total), 124200, 'two units and the shipping: exactly the invoice');
});

test('ADR-017 / AUD-006: the shipping cannot change once the order has collections or returns', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await createOrder.execute({ items: [{ product_id: productId, quantity: 1 }] }, null);
    await pool.query("INSERT INTO transactions (id, type, amount, description, reference_id) VALUES (?, 'sale', 121, 'Cobro QA', ?)", [crypto.randomUUID(), order.id]);
    await assert.rejects(() => salesService.updateOrderShipping(order.id, { amount: 500, charge_customer: true }, null),
        (err) => err.responseBody?.error === 'order_has_payments');

    const other = await createOrder.execute({ items: [{ product_id: productId, quantity: 1 }] }, null);
    await returnsService.createReturn({ order_id: other.id, reason: 'Cambio', items: [{ product_id: productId, quantity: 1 }] });
    await assert.rejects(() => salesService.updateOrderShipping(other.id, { amount: 500, charge_customer: true }, null),
        (err) => err.responseBody?.error === 'order_has_returns');
});

test('ADR-017 / AUD-006: an open order keeps the VAT rate it was sold at', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await createOrder.execute({ items: [{ product_id: productId, quantity: 1 }] }, null);
    await pool.query('UPDATE products SET vat_rate = 10.5 WHERE id = ?', [productId]);
    const invoice = await salesService.createInvoice(order.id, { invoice_type: 'B', point_of_sale: 95 }, null);
    const [[row]] = await pool.query('SELECT total_amount FROM invoices WHERE id = ?', [invoice.id]);
    assert.equal(Number(row.total_amount), 121);
});
