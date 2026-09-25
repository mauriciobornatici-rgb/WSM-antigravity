import '../config/loadEnv.js';
import pool from '../config/db.js';

async function run() {
    try {
        console.log(`Querying users from database ${process.env.DB_NAME} at ${process.env.DB_HOST}...`);
        const [rows] = await pool.query('SELECT id, name, email, role, status FROM users');
        console.log('--- USERS IN DATABASE ---');
        console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
