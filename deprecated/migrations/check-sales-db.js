import pool from './server/db.js';

async function checkDb() {
    try {
        console.log("--- CHECKING DATABASE TABLES ---");

        const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5');
        console.log(`Orders found: ${orders.length}`);
        if (orders.length > 0) console.log("Latest orders:", JSON.stringify(orders, null, 2));

        const [invoices] = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 5');
        console.log(`Invoices found: ${invoices.length}`);
        if (invoices.length > 0) console.log("Latest invoices:", JSON.stringify(invoices, null, 2));

        const [items] = await pool.query('SELECT * FROM invoice_items LIMIT 5');
        console.log(`Invoice Items found: ${items.length}`);

        process.exit(0);
    } catch (err) {
        console.error("DB Error:", err);
        process.exit(1);
    }
}

checkDb();
