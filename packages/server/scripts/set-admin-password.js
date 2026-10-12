import '../config/loadEnv.js';
import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import { isStrongPassword, getPasswordPolicyMessage } from '../utils/passwordPolicy.js';

// Usage: node scripts/set-admin-password.js <email> <newPassword>
// The password is never hardcoded nor echoed back.
async function run() {
    const [email, password] = process.argv.slice(2);

    if (!email || !password) {
        console.error('Usage: node scripts/set-admin-password.js <email> <newPassword>');
        process.exitCode = 1;
        return;
    }

    if (!isStrongPassword(password)) {
        console.error(getPasswordPolicyMessage());
        process.exitCode = 1;
        return;
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        // token_version + 1 revokes every active session of this user
        const [result] = await pool.query(
            'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE email = ?',
            [hashedPassword, email]
        );

        if (result.affectedRows === 0) {
            console.error(`No user found with email ${email}`);
            process.exitCode = 1;
            return;
        }
        console.log(`Password updated for ${email} (active sessions revoked).`);
    } catch (err) {
        console.error(err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
