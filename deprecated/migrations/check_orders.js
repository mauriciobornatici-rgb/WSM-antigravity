import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function checkOrders() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        const [orders] = await pool.query('SELECT id, status, client_id, customer_name, created_at FROM orders ORDER BY created_at DESC LIMIT 5');
        fs.writeFileSync('orders_check.json', JSON.stringify(orders, null, 2));
        console.log("Written to orders_check.json");
        await pool.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkOrders();
