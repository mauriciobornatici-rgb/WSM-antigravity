import pool from './server/db.js';
import crypto from 'crypto';

const resetUsers = async () => {
    try {
        console.log("Deleting all users...");
        // Disable foreign key checks momentarily if needed, but risky. 
        // Let's try simple delete first.
        try {
            await pool.query('DELETE FROM users');
        } catch (e) {
            console.log("Delete failed, trying to update existing admin if exists...");
            // If delete fails, maybe we just update the admin?
        }

        // Check if admin exists
        const [existing] = await pool.query("SELECT id FROM users WHERE email = 'admin@sports.store'");

        if (existing.length > 0) {
            console.log("Admin exists, updating password...");
            await pool.query("UPDATE users SET password_hash = '123456', status = 'active', role = 'admin' WHERE email = 'admin@sports.store'");
        } else {
            console.log("Inserting admin user...");
            const adminId = crypto.randomUUID();
            await pool.query(`
                INSERT INTO users (id, name, email, password_hash, role, status)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [adminId, 'Admin User', 'admin@sports.store', '123456', 'admin', 'active']);
        }

        console.log("Admin setup complete.");

        const [rows] = await pool.query('SELECT id, email, password_hash, role, status FROM users');
        console.log("Current Users:", rows);

    } catch (error) {
        console.error('Error resetting users:', error);
    } finally {
        process.exit();
    }
};

resetUsers();
