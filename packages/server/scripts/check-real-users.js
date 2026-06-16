import pool from '../config/db.js';

async function run() {
    try {
        const [rows] = await pool.query('SELECT id, email, role, status FROM users LIMIT 5');
        console.log('--- USERS IN DATABASE ---');
        console.log(rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
