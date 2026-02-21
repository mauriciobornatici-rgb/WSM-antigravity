import pool from './config/db.js';

async function checkWarranties() {
    try {
        const [w] = await pool.query('SELECT COUNT(*) as count FROM warranty_claims');
        console.log('Warranty Claims Count:', w[0].count);

        const [r] = await pool.query('SELECT COUNT(*) as count FROM client_returns');
        console.log('Client Returns Count:', r[0].count);

        if (w[0].count > 0) {
            const [sample] = await pool.query('SELECT * FROM warranty_claims LIMIT 1');
            console.log('Sample Warranty:', sample[0]);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkWarranties();
