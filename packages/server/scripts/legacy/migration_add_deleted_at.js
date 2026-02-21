import pool from './config/db.js';

async function addDeletedAt() {
    const tables = ['warranty_claims', 'client_returns', 'credit_notes'];

    for (const table of tables) {
        try {
            // Check if column exists
            const [cols] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE 'deleted_at'`);
            if (cols.length === 0) {
                console.log(`Adding deleted_at to ${table}...`);
                await pool.query(`ALTER TABLE ${table} ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`);
            } else {
                console.log(`deleted_at already exists in ${table}.`);
            }
        } catch (e) {
            console.log(`Table ${table} might not exist or error:`, e.message);
        }
    }
    process.exit(0);
}

addDeletedAt();
