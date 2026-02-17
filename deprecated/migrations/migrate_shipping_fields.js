import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function addShippingFields() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    const columns = [
        { name: 'shipping_method', def: "ENUM('pickup', 'delivery') DEFAULT NULL" },
        { name: 'tracking_number', def: 'VARCHAR(100) DEFAULT NULL' },
        { name: 'estimated_delivery', def: 'DATE DEFAULT NULL' },
        { name: 'dispatched_at', def: 'DATETIME DEFAULT NULL' },
        { name: 'delivered_at', def: 'DATETIME DEFAULT NULL' },
        { name: 'recipient_name', def: 'VARCHAR(255) DEFAULT NULL' },
        { name: 'recipient_dni', def: 'VARCHAR(20) DEFAULT NULL' },
        { name: 'delivery_notes', def: 'TEXT DEFAULT NULL' }
    ];

    try {
        console.log("Adding shipping fields to orders table...");

        for (const col of columns) {
            try {
                await pool.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.def}`);
                console.log(`✓ Added ${col.name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`  ${col.name} already exists`);
                } else {
                    console.error(`  Error adding ${col.name}:`, e.message);
                }
            }
        }

        const [cols] = await pool.query('DESCRIBE orders');
        console.log("\nOrders table now has columns:", cols.map(c => c.Field).join(', '));

        await pool.end();
        console.log("\n✓ Migration completed!");
        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

addShippingFields();
