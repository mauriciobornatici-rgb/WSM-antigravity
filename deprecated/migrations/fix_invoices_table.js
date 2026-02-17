import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function fixInvoicesTable() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Checking invoices table structure...");

        // Check current columns
        const [columns] = await pool.query("SHOW COLUMNS FROM invoices");
        const columnNames = columns.map(c => c.Field);
        console.log("Current columns:", columnNames.join(', '));

        // Add missing columns
        const columnsToAdd = [
            { name: 'customer_name', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'client_id', type: 'VARCHAR(36) DEFAULT NULL' },
            { name: 'order_id', type: 'VARCHAR(36) DEFAULT NULL' },
            { name: 'subtotal', type: 'DECIMAL(15,2) DEFAULT 0' },
            { name: 'tax_amount', type: 'DECIMAL(15,2) DEFAULT 0' },
            { name: 'total_amount', type: 'DECIMAL(15,2) DEFAULT 0' },
            { name: 'payment_method', type: "VARCHAR(50) DEFAULT 'cash'" },
            { name: 'payment_status', type: "VARCHAR(20) DEFAULT 'paid'" },
            { name: 'notes', type: 'TEXT' }
        ];

        for (const col of columnsToAdd) {
            if (!columnNames.includes(col.name)) {
                try {
                    await pool.query(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.type}`);
                    console.log(`✓ Added column: ${col.name}`);
                } catch (e) {
                    if (e.code === 'ER_DUP_FIELDNAME') {
                        console.log(`  Column ${col.name} already exists`);
                    } else {
                        console.log(`  Error adding ${col.name}:`, e.message);
                    }
                }
            } else {
                console.log(`  Column ${col.name} already exists`);
            }
        }

        await pool.end();
        console.log("\n✓ Done!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
}

fixInvoicesTable();
