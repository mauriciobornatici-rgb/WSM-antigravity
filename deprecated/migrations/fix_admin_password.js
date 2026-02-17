import pool from './server/db.js';

const fixAdmin = async () => {
    try {
        console.log("Updating admin password...");
        const [result] = await pool.query(
            "UPDATE users SET password_hash = '123456' WHERE email = 'admin@sports.store'"
        );
        console.log("Update result:", result);

        const [rows] = await pool.query("SELECT * FROM users WHERE email = 'admin@sports.store'");
        console.log("Admin user after update:", rows[0]);
    } catch (error) {
        console.error('Error updating admin:', error);
    } finally {
        process.exit();
    }
};

fixAdmin();
