import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function addPickedQuantity() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        console.log("Adding picked_quantity column to order_items...");

        try {
            await pool.query(`
                ALTER TABLE order_items 
                ADD COLUMN picked_quantity INT DEFAULT 0
            `);
            console.log("✓ Added picked_quantity column");
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log("  picked_quantity column already exists");
            } else {
                throw e;
            }
        }

        // Verify
        const [columns] = await pool.query('DESCRIBE order_items');
        console.log("\nOrder_items table structure:");
        console.log(columns.map(c => `  ${c.Field}: ${c.Type}`).join('\n'));

        await pool.end();
        console.log("\n✓ Migration completed!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

addPickedQuantity();
