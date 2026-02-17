import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function fixOrderStatus() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Fixing order status enum and empty values...");

        // Add 'completed' back to enum for backwards compatibility
        await pool.query(`
            ALTER TABLE orders 
            MODIFY COLUMN status ENUM('pending', 'picking', 'packed', 'dispatched', 'delivered', 'completed', 'cancelled') DEFAULT 'pending'
        `);
        console.log("✓ Added 'completed' back to enum");

        // Fix orders with empty status - set them to 'completed' (their original value)
        const [result] = await pool.query(`
            UPDATE orders SET status = 'completed' WHERE status = '' OR status IS NULL
        `);
        console.log(`✓ Fixed ${result.affectedRows} orders with empty status`);

        // Verify
        const [orders] = await pool.query("SELECT id, status FROM orders LIMIT 5");
        console.log("Sample orders after fix:", orders);

        await pool.end();
        console.log("✓ Migration fix completed!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

fixOrderStatus();
