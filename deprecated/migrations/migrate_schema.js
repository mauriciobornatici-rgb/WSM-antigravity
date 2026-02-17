
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'admin',
    database: process.env.DB_NAME || 'wsm_antigravity',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function migrate() {
    try {
        const connection = await pool.getConnection();
        console.log("Connected to DB");

        const queries = [
            "ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)",
            "ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)",
            "ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)"
        ];

        for (const q of queries) {
            try {
                await connection.query(q);
                console.log("Executed:", q);
            } catch (e) {
                console.log("Error or already exists:", e.message);
            }
        }

        console.log("Migration done");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

migrate();
