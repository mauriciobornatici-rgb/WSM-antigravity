import pool from './config/db.js';

async function run() {
    try {
        console.log('Connecting to DB...');

        // Check Products
        const [total] = await pool.query('SELECT COUNT(*) as count FROM products');
        console.log('Total Products in users DB:', total[0].count);

        const [active] = await pool.query('SELECT COUNT(*) as count FROM products WHERE deleted_at IS NULL');
        console.log('Active Products (deleted_at IS NULL):', active[0].count);

        if (total[0].count > 0 && active[0].count === 0) {
            console.log('WARNING: All products are soft-deleted!');
        }

        // Check Inventory
        const [inv] = await pool.query('SELECT COUNT(*) as count FROM inventory');
        console.log('Total Inventory Records:', inv[0].count);

        if (active[0].count > 0) {
            const [sample] = await pool.query('SELECT * FROM products WHERE deleted_at IS NULL LIMIT 1');
            console.log('Sample Active Product:', sample[0]);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error querying DB:', err);
        process.exit(1);
    }
}

run();
