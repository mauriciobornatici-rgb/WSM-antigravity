import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function migrateOrdersTable() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Migrating orders table to add missing columns...");

        // Add payment_status column if not exists
        try {
            await pool.query(`
                ALTER TABLE orders 
                ADD COLUMN payment_status ENUM('pending', 'partial', 'paid') DEFAULT 'pending'
            `);
            console.log("✓ Added payment_status column");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  payment_status column already exists");
            } else {
                throw e;
            }
        }

        // Add payment_method column if not exists
        try {
            await pool.query(`
                ALTER TABLE orders 
                ADD COLUMN payment_method ENUM('cash', 'transfer', 'credit_account', 'card') DEFAULT 'cash'
            `);
            console.log("✓ Added payment_method column");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  payment_method column already exists");
            } else {
                throw e;
            }
        }

        // Add shipping_address column if not exists
        try {
            await pool.query(`
                ALTER TABLE orders 
                ADD COLUMN shipping_address TEXT
            `);
            console.log("✓ Added shipping_address column");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  shipping_address column already exists");
            } else {
                throw e;
            }
        }

        // Add updated_at column if not exists
        try {
            await pool.query(`
                ALTER TABLE orders 
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            `);
            console.log("✓ Added updated_at column");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  updated_at column already exists");
            } else {
                throw e;
            }
        }

        // Verify final structure
        const [columns] = await pool.query('DESCRIBE orders');
        console.log("\nFinal orders table structure:");
        console.log(columns.map(c => `  ${c.Field}: ${c.Type}`).join('\n'));

        await pool.end();
        console.log("\n✓ Migration completed successfully!");
        process.exit(0);
    } catch (e) {
        console.error("Migration error:", e);
        process.exit(1);
    }
}

migrateOrdersTable();
