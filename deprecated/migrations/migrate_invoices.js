import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function createInvoiceTables() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Creating invoices table...");

        // Create invoices table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id VARCHAR(36) PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                order_id VARCHAR(36),
                client_id VARCHAR(36),
                customer_name VARCHAR(255),
                subtotal DECIMAL(15,2) DEFAULT 0,
                tax_amount DECIMAL(15,2) DEFAULT 0,
                total_amount DECIMAL(15,2) DEFAULT 0,
                payment_method ENUM('cash', 'transfer', 'card', 'credit_account') DEFAULT 'cash',
                payment_status ENUM('pending', 'paid') DEFAULT 'paid',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✓ invoices table created");

        // Create invoice_items table for line items
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoice_items (
                id VARCHAR(36) PRIMARY KEY,
                invoice_id VARCHAR(36) NOT NULL,
                product_id VARCHAR(36),
                product_name VARCHAR(255),
                sku VARCHAR(100),
                quantity INT NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                subtotal DECIMAL(10,2) generated always as (quantity * unit_price) stored
            )
        `);
        console.log("✓ invoice_items table created");

        // Add invoice_id to orders table
        try {
            await pool.query(`ALTER TABLE orders ADD COLUMN invoice_id VARCHAR(36) DEFAULT NULL`);
            console.log("✓ invoice_id column added to orders");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  invoice_id already exists in orders");
            } else throw e;
        }

        // Get next invoice number
        const [lastInvoice] = await pool.query('SELECT invoice_number FROM invoices ORDER BY created_at DESC LIMIT 1');
        const nextNum = lastInvoice.length > 0
            ? parseInt(lastInvoice[0].invoice_number.replace('FC-', '')) + 1
            : 1;
        console.log(`\nNext invoice number will be: FC-${String(nextNum).padStart(6, '0')}`);

        await pool.end();
        console.log("\n✓ Migration completed!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

createInvoiceTables();
