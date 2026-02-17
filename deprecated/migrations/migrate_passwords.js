import pool from './server/db.js';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

const migratePasswords = async () => {
    try {
        console.log("Fetching users to migrate...");
        const [users] = await pool.query('SELECT id, password_hash FROM users');

        for (const user of users) {
            // Check if it looks like a bcrypt hash (starts with $2b$)
            if (user.password_hash.startsWith('$2b$')) {
                console.log(`User ${user.id} already has a hashed password. Skipping.`);
                continue;
            }

            console.log(`Hashing password for user ${user.id}...`);
            const hashedPassword = await bcrypt.hash(user.password_hash, SALT_ROUNDS);

            await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, user.id]);
        }

        console.log("Migration complete.");
    } catch (error) {
        console.error("Migration error:", error);
    } finally {
        process.exit();
    }
};

migratePasswords();
