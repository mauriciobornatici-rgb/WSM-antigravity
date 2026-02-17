import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function migrateOrderStatus() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Starting migration to fix order status enum...");

        // First, let's see what we're dealing with
        const [currentOrders] = await pool.query("SELECT id, status FROM orders");
        console.log(`Found ${currentOrders.length} orders with current status values`);

        // ALTER the table to add the correct enum values
        console.log("Altering orders table to fix status enum...");
        await pool.query(`
            ALTER TABLE orders 
            MODIFY COLUMN status ENUM('pending', 'picking', 'packed', 'dispatched', 'delivered', 'cancelled') DEFAULT 'pending'
        `);

        console.log("✓ Migration completed successfully!");
        console.log("The orders table now supports all order lifecycle states.");

        await pool.end();
        process.exit(0);
    } catch (e) {
        console.error("Migration failed:", e);
        process.exit(1);
    }
}

migrateOrderStatus();
