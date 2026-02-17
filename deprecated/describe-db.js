import pool from './server/db.js';

async function describeTables() {
    try {
        const [tables] = await pool.query("SHOW TABLES");
        console.log("Tables:", tables.map(t => Object.values(t)[0]));

        const [invoiceCols] = await pool.query("DESCRIBE invoices");
        console.log("Invoices Structure:", invoiceCols);

        const [orders] = await pool.query("SELECT * FROM orders LIMIT 1");
        console.log("Example Order:", orders[0]);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

describeTables();
