
import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function debug() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        const [clients] = await pool.query('SELECT id, name FROM clients LIMIT 5');
        const [orders] = await pool.query('SELECT id, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5');

        const output = {
            clients,
            orders
        };

        fs.writeFileSync('debug_output.json', JSON.stringify(output, null, 2));
        console.log("Written to debug_output.json");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
debug();
