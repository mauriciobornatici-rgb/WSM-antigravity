import mysql from 'mysql2/promise';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

async function testOrderCreation() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'admin',
        database: process.env.DB_NAME || 'wsm_antigravity'
    });

    try {
        // Count orders before
        const [before] = await pool.query('SELECT COUNT(*) as count FROM orders');
        console.log(`Orders before: ${before[0].count}`);

        // Create a test order directly
        const orderId = `test-${Date.now()}`;
        await pool.query(`
            INSERT INTO orders (id, client_id, customer_name, total_amount, status, payment_status, payment_method)
            VALUES (?, NULL, 'Test Order Direct', 100, 'pending', 'pending', 'cash')
        `, [orderId]);
        console.log(`Created test order: ${orderId}`);

        // Count orders after
        const [after] = await pool.query('SELECT COUNT(*) as count FROM orders');
        console.log(`Orders after: ${after[0].count}`);

        // Check the new order
        const [newOrder] = await pool.query('SELECT id, status, customer_name FROM orders WHERE id = ?', [orderId]);
        console.log('New order:', JSON.stringify(newOrder[0], null, 2));

        // List all orders
        const [allOrders] = await pool.query('SELECT id, status, customer_name, created_at FROM orders ORDER BY created_at DESC LIMIT 10');
        fs.writeFileSync('all_orders.json', JSON.stringify(allOrders, null, 2));
        console.log('All orders written to all_orders.json');

        await pool.end();
        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

testOrderCreation();
