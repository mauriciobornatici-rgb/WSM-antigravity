import pool from './config/db.js';

async function checkColumns() {
    try {
        const [rows] = await pool.query('DESCRIBE products');
        console.log('Columns:', rows.map(r => r.Field));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkColumns();
