import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function checkOrderCreation() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        const data = {};

        // Check table structure
        const [columns] = await pool.query("DESCRIBE orders");
        data.table_structure = columns;

        // Check for triggers
        const [triggers] = await pool.query("SHOW TRIGGERS WHERE `Table` = 'orders'");
        data.triggers = triggers;

        // Check most recent order
        const [recent] = await pool.query("SELECT id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 1");
        data.most_recent_order = recent[0];

        fs.writeFileSync('order_diagnostic.json', JSON.stringify(data, null, 2));
        console.log("Data written to order_diagnostic.json");

        await pool.end();
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkOrderCreation();
