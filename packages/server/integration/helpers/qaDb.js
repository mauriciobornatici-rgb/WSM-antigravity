import crypto from 'node:crypto';
import { assertQaDatabaseEnvironment } from '../../../../scripts/qa-env.js';

// Integration suites write real rows: refuse anything but the loopback QA database
// before the application's pool is even imported.
assertQaDatabaseEnvironment(process.env);

const { default: pool, closePool } = await import('../../config/db.js');

export { pool, closePool };

export function uniqueId(prefix) {
    return `${prefix}-${crypto.randomUUID()}`.slice(0, 36);
}

/** Creates a product with stock rows: [{ location, quantity, reserved }]. */
export async function seedProduct({ name = 'Producto QA', salePrice = 100, stock = [] } = {}) {
    const productId = crypto.randomUUID();
    await pool.query(
        'INSERT INTO products (id, sku, name, sale_price) VALUES (?, ?, ?, ?)',
        [productId, uniqueId('SKU'), name, salePrice]
    );
    for (const row of stock) {
        await pool.query(
            'INSERT INTO inventory (id, product_id, location, quantity, reserved_quantity) VALUES (?, ?, ?, ?, ?)',
            [crypto.randomUUID(), productId, row.location, row.quantity, row.reserved ?? 0]
        );
    }
    return productId;
}

/** Creates a client with one issued invoice (ADR-014: manual credit notes correct an invoice). */
export async function seedClientWithInvoice({ total = 1210, vat = 210, type = 'A' } = {}) {
    const clientId = crypto.randomUUID();
    await pool.query('INSERT INTO clients (id, name) VALUES (?, ?)', [clientId, `Cliente QA ${clientId.slice(0, 8)}`]);
    const invoiceId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO invoices (id, client_id, client_name, invoice_type, point_of_sale, invoice_number, net_amount, vat_amount, total_amount, status)
         VALUES (?, ?, 'Cliente QA', ?, 98, FLOOR(RAND() * 1000000000), ?, ?, ?, 'issued')`,
        [invoiceId, clientId, type, total - vat, vat, total]
    );
    return { clientId, invoiceId };
}

export async function stockOf(productId) {
    const [rows] = await pool.query(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(reserved_quantity), 0) AS reserved
         FROM inventory WHERE product_id = ?`,
        [productId]
    );
    return { quantity: Number(rows[0].quantity), reserved: Number(rows[0].reserved) };
}

export async function saleMovementsOf(productId) {
    const [rows] = await pool.query(
        "SELECT reference_id, from_location, quantity FROM inventory_movements WHERE product_id = ? AND type = 'sale'",
        [productId]
    );
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
}
