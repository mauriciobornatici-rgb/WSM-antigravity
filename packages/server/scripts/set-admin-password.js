import pool from '../config/db.js';
import bcrypt from 'bcrypt';

async function run() {
    try {
        const hashedPassword = await bcrypt.hash('Admin!1234', 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE email = ?', [hashedPassword, 'admin@system.com']);
        console.log('Password for admin@system.com updated to Admin!1234');
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
