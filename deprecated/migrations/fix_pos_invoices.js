import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function fixTablesForPOS() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Adding missing columns for POS invoices...\n");

        // Add columns to invoices table
        const invoiceColumns = [
            { name: 'invoice_type', type: "VARCHAR(10) DEFAULT 'TK'" },
            { name: 'point_of_sale', type: 'INT DEFAULT 1' },
            { name: 'client_tax_id', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'client_tax_condition', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'net_amount', type: 'DECIMAL(15,2) DEFAULT 0' },
            { name: 'vat_amount', type: 'DECIMAL(15,2) DEFAULT 0' },
            { name: 'status', type: "VARCHAR(20) DEFAULT 'issued'" },
            { name: 'issue_date', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
            { name: 'created_by', type: 'VARCHAR(36) DEFAULT NULL' },
            { name: 'cae', type: 'VARCHAR(50) DEFAULT NULL' }
        ];

        console.log("INVOICES table:");
        for (const col of invoiceColumns) {
            try {
                await pool.query(`ALTER TABLE invoices ADD COLUMN ${col.name} ${col.type}`);
                console.log(`  ✓ Added: ${col.name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`  - Exists: ${col.name}`);
                } else {
                    console.log(`  ✗ Error (${col.name}):`, e.message);
                }
            }
        }

        // Add columns to invoice_items table
        const itemColumns = [
            { name: 'vat_rate', type: 'DECIMAL(5,2) DEFAULT 0' },
            { name: 'description', type: 'TEXT' }
        ];

        console.log("\nINVOICE_ITEMS table:");
        for (const col of itemColumns) {
            try {
                await pool.query(`ALTER TABLE invoice_items ADD COLUMN ${col.name} ${col.type}`);
                console.log(`  ✓ Added: ${col.name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`  - Exists: ${col.name}`);
                } else {
                    console.log(`  ✗ Error (${col.name}):`, e.message);
                }
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

fixTablesForPOS();
