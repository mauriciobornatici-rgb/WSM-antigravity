import pool, { closePool } from '../config/db.js';

const relationships = [
    ['products', 'supplier_id', 'suppliers', 'id'],
    ['inventory', 'product_id', 'products', 'id'],
    ['inventory_movements', 'product_id', 'products', 'id'],
    ['inventory_movements', 'performed_by', 'users', 'id'],
    ['orders', 'client_id', 'clients', 'id'],
    ['order_items', 'order_id', 'orders', 'id'],
    ['order_items', 'product_id', 'products', 'id'],
    ['invoices', 'order_id', 'orders', 'id'],
    ['invoices', 'client_id', 'clients', 'id'],
    ['invoice_items', 'invoice_id', 'invoices', 'id'],
    ['invoice_items', 'product_id', 'products', 'id'],
    ['purchase_orders', 'supplier_id', 'suppliers', 'id'],
    ['purchase_order_items', 'purchase_order_id', 'purchase_orders', 'id'],
    ['purchase_order_items', 'product_id', 'products', 'id'],
    ['receptions', 'purchase_order_id', 'purchase_orders', 'id'],
    ['reception_items', 'reception_id', 'receptions', 'id'],
    ['reception_items', 'product_id', 'products', 'id'],
    ['cash_shifts', 'cash_register_id', 'cash_registers', 'id'],
    ['shift_payments', 'shift_id', 'cash_shifts', 'id'],
    ['shift_payments', 'order_id', 'orders', 'id'],
];

async function countOrphans(childTable, childColumn, parentTable, parentColumn) {
    const [rows] = await pool.query(`
        SELECT COUNT(*) AS orphan_count
        FROM \`${childTable}\` child
        LEFT JOIN \`${parentTable}\` parent ON parent.\`${parentColumn}\` = child.\`${childColumn}\`
        WHERE child.\`${childColumn}\` IS NOT NULL
          AND parent.\`${parentColumn}\` IS NULL
    `);
    return Number(rows[0]?.orphan_count || 0);
}

async function main() {
    const failures = [];
    for (const relationship of relationships) {
        const count = await countOrphans(...relationship);
        const [childTable, childColumn, parentTable, parentColumn] = relationship;
        const result = { child: `${childTable}.${childColumn}`, parent: `${parentTable}.${parentColumn}`, orphans: count };
        console.log(JSON.stringify(result));
        if (count > 0) failures.push(result);
    }

    const [duplicatePickingRows] = await pool.query(`
        SELECT order_id, COUNT(*) AS active_sessions
        FROM picking_sessions
        WHERE status = 'in_progress'
        GROUP BY order_id
        HAVING COUNT(*) > 1
    `);
    if (duplicatePickingRows.length > 0) {
        const result = { check: 'duplicate_active_picking_sessions', rows: duplicatePickingRows };
        console.log(JSON.stringify(result));
        failures.push(result);
    }

    const [duplicateExternalOrderRows] = await pool.query(`
        SELECT external_source, external_id, COUNT(*) AS duplicate_count
        FROM orders
        WHERE external_source IS NOT NULL AND external_id IS NOT NULL
        GROUP BY external_source, external_id
        HAVING COUNT(*) > 1
    `);
    if (duplicateExternalOrderRows.length > 0) {
        const result = { check: 'duplicate_external_orders', rows: duplicateExternalOrderRows };
        console.log(JSON.stringify(result));
        failures.push(result);
    }

    const [duplicateInvoiceRows] = await pool.query(`
        SELECT order_id, COUNT(*) AS duplicate_count
        FROM invoices
        WHERE order_id IS NOT NULL
        GROUP BY order_id
        HAVING COUNT(*) > 1
    `);
    if (duplicateInvoiceRows.length > 0) {
        const result = { check: 'duplicate_invoices_per_order', rows: duplicateInvoiceRows };
        console.log(JSON.stringify(result));
        failures.push(result);
    }

    const [duplicateShiftPaymentRows] = await pool.query(`
        SELECT shift_id, order_id, payment_method, type, COUNT(*) AS duplicate_count
        FROM shift_payments
        WHERE order_id IS NOT NULL
        GROUP BY shift_id, order_id, payment_method, type
        HAVING COUNT(*) > 1
    `);
    if (duplicateShiftPaymentRows.length > 0) {
        const result = { check: 'duplicate_shift_payments_per_order', rows: duplicateShiftPaymentRows };
        console.log(JSON.stringify(result));
        failures.push(result);
    }

    if (failures.length > 0) {
        console.error(JSON.stringify({ status: 'blocked', orphan_relationships: failures }));
        process.exitCode = 1;
        return;
    }
    console.log(JSON.stringify({ status: 'ok', message: 'Referential-integrity preflight passed' }));
}

main()
    .catch((error) => {
        console.error(JSON.stringify({ status: 'error', message: error.message }));
        process.exitCode = 1;
    })
    .finally(() => closePool());
