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
    const productId = await seedProduct({ stock: [
        { location: 'General', quantity: 5, reserved: 3 },
        { location: 'Devoluciones a Proveedores', quantity: 2 },
    ] });
    const returnId = await seedSupplierReturn(productId, 3);

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

async function postSupplierInvoice(supplierId, { net, vat, type = 'A' }) {
    const invoiceId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO supplier_invoices (id, invoice_number, invoice_type, supplier_id, issue_date, net_amount, vat_amount, total_amount)
         VALUES (?, ?, ?, ?, CURDATE(), ?, ?, ?)`,
        [invoiceId, uniqueId('FC'), type, supplierId, net, vat, net + vat]
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
    const productId = await seedProduct({ stock: [{ location: 'General', quantity: 5 }] });
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

test('a supplier return to a Factura C supplier reverses no VAT', async () => {
    const productId = await seedProduct({ stock: [{ location: 'General', quantity: 5 }] });
    const returnId = await seedSupplierReturn(productId, 2);
    const [[{ supplier_id: supplierId }]] = await pool.query('SELECT supplier_id FROM supplier_returns WHERE id = ?', [returnId]);
    await postSupplierInvoice(supplierId, { net: 50, vat: 0, type: 'C' });

    await supplierReturnService.approveSupplierReturn(returnId, null);

    assert.deepEqual(await returnEntryLines(returnId), [['2.1.01.01', 20, 0], ['1.1.04.01', 0, 20]]);
});
