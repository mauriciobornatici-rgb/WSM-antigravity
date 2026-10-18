import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, uniqueId } from './helpers/qaDb.js';
import supplierReturnService from '../domains/procurement/SupplierReturnService.js';
import accountingService from '../services/accounting.service.js';

test.after(async () => {
    await closePool();
});

async function seedSupplierReturn(productId, quantity) {
    const supplierId = crypto.randomUUID();
    const returnId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    await pool.query(
        "INSERT INTO supplier_returns (id, return_number, supplier_id, status) VALUES (?, ?, ?, 'draft')",
        [returnId, uniqueId('DEV'), supplierId]
    );
    await pool.query(
        'INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?, 10)',
        [crypto.randomUUID(), returnId, productId, quantity]
    );
    return returnId;
}

async function rowsOf(productId) {
    const [rows] = await pool.query(
        'SELECT location, quantity, reserved_quantity FROM inventory WHERE product_id = ? ORDER BY location',
        [productId]
    );
    return rows.map((row) => [row.location, row.quantity, row.reserved_quantity]);
}

test('a supplier return takes unreserved stock, prefers the return location and traces the real location', async () => {
    const productId = await seedProduct({ cost: 10, stock: [
        { location: 'General', quantity: 5, reserved: 3 },
        { location: 'Devoluciones a Proveedores', quantity: 2 },
    ] });
    const returnId = await seedSupplierReturn(productId, 3);
    // D7: without a delivery note, the supplier must have invoiced goods already.
    const [[{ supplier_id: supplierId }]] = await pool.query('SELECT supplier_id FROM supplier_returns WHERE id = ?', [returnId]);
    await postSupplierInvoice(supplierId, { net: 100, vat: 21 });

    await supplierReturnService.approveSupplierReturn(returnId, null);

    assert.deepEqual(await rowsOf(productId), [['Devoluciones a Proveedores', 0, 0], ['General', 4, 3]]);
    const [movements] = await pool.query(
        "SELECT from_location, quantity FROM inventory_movements WHERE reference_id = ? AND type = 'return' ORDER BY from_location",
        [returnId]
    );
    assert.deepEqual(movements.map((row) => [row.from_location, row.quantity]), [['Devoluciones a Proveedores', 2], ['General', 1]]);
});

test('a supplier return never consumes stock reserved for customer orders', async () => {
    const productId = await seedProduct({ stock: [{ location: 'General', quantity: 4, reserved: 3 }] });
    const returnId = await seedSupplierReturn(productId, 2);

    await assert.rejects(
        () => supplierReturnService.approveSupplierReturn(returnId, null),
        (err) => err.errorCode === 'INSUFFICIENT_STOCK' && err.statusCode === 409
    );
    assert.deepEqual(await rowsOf(productId), [['General', 4, 3]]);
    const [[row]] = await pool.query('SELECT status FROM supplier_returns WHERE id = ?', [returnId]);
    assert.equal(row.status, 'draft');
});

async function postSupplierInvoice(supplierId, { net, vat, type = 'A', purchaseOrderId = null }) {
    const invoiceId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO supplier_invoices (id, invoice_number, invoice_type, supplier_id, purchase_order_id, issue_date, net_amount, vat_amount, total_amount)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
        [invoiceId, uniqueId('FC'), type, supplierId, purchaseOrderId, net, vat, net + vat]
    );
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await accountingService.createJournalEntry(connection, {
            date: new Date(), description: 'Factura QA', reference_type: 'supplier_invoice', reference_id: invoiceId,
            lines: [
                { account_code: '1.1.04.01', debit: net, credit: 0 },
                ...(vat > 0 ? [{ account_code: '1.1.05.02', debit: vat, credit: 0 }] : []),
                { account_code: '2.1.01.01', debit: 0, credit: net + vat },
            ],
        });
        await connection.commit();
    } finally {
        connection.release();
    }
}

async function returnEntryLines(returnId) {
    const [rows] = await pool.query(
        `SELECT l.account_code, l.debit, l.credit
         FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id
         WHERE e.reference_type = 'supplier_return' AND e.reference_id = ?
         ORDER BY l.debit DESC, l.account_code`,
        [returnId]
    );
    return rows.map((row) => [row.account_code, Number(row.debit), Number(row.credit)]);
}

test('a supplier return mirrors the Factura A purchase: Proveedores gross / Mercadería + IVA CF, balance may go negative', async () => {
    const productId = await seedProduct({ cost: 10, stock: [{ location: 'General', quantity: 5 }] });
    const returnId = await seedSupplierReturn(productId, 3); // 3 × 10 = 30 net
    const [[{ supplier_id: supplierId }]] = await pool.query('SELECT supplier_id FROM supplier_returns WHERE id = ?', [returnId]);
    await postSupplierInvoice(supplierId, { net: 100, vat: 21 });

    await supplierReturnService.approveSupplierReturn(returnId, null);

    assert.deepEqual(await returnEntryLines(returnId), [
        ['2.1.01.01', 36.3, 0],
        ['1.1.04.01', 0, 30],
        ['1.1.05.02', 0, 6.3],
    ]);
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), -36.3, 'no invoice debt was registered on the supplier row in this seed: the credit stays');
});

test('a supplier return to a Factura C supplier reverses no VAT; the goods leave at their book value', async () => {
    const productId = await seedProduct({ cost: 8, stock: [{ location: 'General', quantity: 5 }] });
    const returnId = await seedSupplierReturn(productId, 2);
    const [[{ supplier_id: supplierId }]] = await pool.query('SELECT supplier_id FROM supplier_returns WHERE id = ?', [returnId]);
    await postSupplierInvoice(supplierId, { net: 50, vat: 0, type: 'C' });

    await supplierReturnService.approveSupplierReturn(returnId, null);

    // ADR-027: 2 × 8 leave inventory; the supplier credits 2 × 10, so 4 is holding result.
    assert.deepEqual(await returnEntryLines(returnId), [['2.1.01.01', 20, 0], ['1.1.04.01', 0, 16], ['4.2.02.01', 0, 4]]);
});

test('a return against a delivery note not invoiced yet lowers what is owed for it, and the invoice clears only the rest (D7)', async () => {
    const { default: receptionService } = await import('../domains/procurement/ReceptionService.js');
    const { QualityCheckService } = await import('../domains/procurement/QualityCheckService.js');
    const { default: goodsReceptionService } = await import('../domains/procurement/GoodsReceptionService.js');
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const productId = await seedProduct({ cost: 40 });
    const reception = await receptionService.createReception({
        supplier_id: supplierId, items: [{ product_id: productId, quantity_received: 5, unit_cost: 40, location_assigned: 'General' }],
    }, null);
    await new QualityCheckService().createQualityCheck({ reception_id: reception.id, product_id: productId, result: 'partial', quantity_checked: 5, quantity_passed: 3, quantity_failed: 2 }, null);
    await goodsReceptionService.processReceptionApproval(reception.id, {});

    const created = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: reception.id, items: [{ product_id: productId, quantity: 2, unit_cost: 40, reason: 'Falla' }],
    }, null);
    await supplierReturnService.approveSupplierReturn(created.id, null);
    assert.deepEqual(await returnEntryLines(created.id), [['2.1.01.02', 80, 0], ['1.1.04.01', 0, 80]]);
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), 0, 'nothing owed to the supplier yet');

    // The invoice charges the 3 kept: it clears 120 and 2.1.01.02 ends at 0 for this delivery note.
    const invoice = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-17',
        reception_ids: [reception.id], net_amount: 120, vat_amount: 25.2, vat_rate: 21, total_amount: 145.2,
    }, null);
    assert.equal(invoice.receptions_net, 120);
    const [[bridge]] = await pool.query(
        `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS balance FROM journal_entries e
         JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '2.1.01.02'
         WHERE (e.reference_type = 'goods_received' AND e.reference_id = ?) OR (e.reference_type = 'supplier_return' AND e.reference_id = ?)
            OR (e.reference_type = 'supplier_invoice' AND e.reference_id = ?)`,
        [reception.id, created.id, invoice.id]
    );
    assert.equal(Number(bridge.balance), 0);

    // Never more than what is left of the delivery note (5 received, 2 returned).
    const tooMany = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: reception.id, items: [{ product_id: productId, quantity: 4, unit_cost: 40 }],
    }, null);
    await assert.rejects(
        () => supplierReturnService.approveSupplierReturn(tooMany.id, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'return_exceeds_reception'
    );
});

test('a delivery note its purchase order invoiced (before ADR-019) counts as invoiced: the return lowers the debt (AUD-016)', async () => {
    const { default: receptionService } = await import('../domains/procurement/ReceptionService.js');
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const productId = await seedProduct({ cost: 10, stock: [{ location: 'General', quantity: 5 }] });
    // The old way: a received order, its delivery note approved with no entry of its own, and an
    // invoice of the order that names no delivery note.
    const orderId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO purchase_orders (id, po_number, supplier_id, order_date, status) VALUES (?, ?, ?, CURDATE(), 'received')",
        [orderId, uniqueId('OC'), supplierId]
    );
    const receptionId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO receptions (id, reception_number, purchase_order_id, supplier_id, status) VALUES (?, ?, ?, ?, 'approved')",
        [receptionId, uniqueId('REC'), orderId, supplierId]
    );
    await pool.query(
        'INSERT INTO reception_items (id, reception_id, product_id, quantity_received, unit_cost) VALUES (?, ?, ?, 5, 10)',
        [crypto.randomUUID(), receptionId, productId]
    );
    await postSupplierInvoice(supplierId, { net: 50, vat: 10.5, purchaseOrderId: orderId });

    // The lists show it as invoiced, not "sin facturar".
    const [listed] = (await receptionService.getReceptions({ supplier_id: supplierId })).filter((row) => row.id === receptionId);
    assert.equal(Number(listed.invoiced_by_order), 1);
    assert.equal(listed.supplier_invoice_id, null);

    const created = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: receptionId, items: [{ product_id: productId, quantity: 2, unit_cost: 10, reason: 'Falla' }],
    }, null);
    await supplierReturnService.approveSupplierReturn(created.id, null);
    // It used to leave the stock with no entry and the debt untouched.
    assert.deepEqual(await returnEntryLines(created.id), [['2.1.01.01', 24.2, 0], ['1.1.04.01', 0, 20], ['1.1.05.02', 0, 4.2]]);
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), -24.2);
});

test('goods the supplier never invoiced are not returned without their delivery note (D7)', async () => {
    const productId = await seedProduct({ cost: 10, stock: [{ location: 'General', quantity: 5 }] });
    const returnId = await seedSupplierReturn(productId, 1);
    await assert.rejects(
        () => supplierReturnService.approveSupplierReturn(returnId, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'supplier_return_requires_reception'
    );
    assert.deepEqual(await rowsOf(productId), [['General', 5, 0]], 'nothing left the stock');
});
