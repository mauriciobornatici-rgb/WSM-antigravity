import pool from './server/db.js';

const testLogin = async () => {
    const email = 'admin@sports.store';
    const password = '123456';

    try {
        console.log(`Attempting login for ${email}...`);
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND status = "active"', [email]);

        if (users.length === 0) {
            console.log("LOGIN FAILED: User not found or inactive.");
        } else {
            const user = users[0];
            console.log("User found:", user.email, "ID:", user.id);
            console.log("Stored Hash:", user.password_hash);
            console.log("Provided Password:", password);

            if (user.password_hash !== password) {
                console.log("LOGIN FAILED: Password mismatch.");
                console.log(`Expected: '${password}', Got: '${user.password_hash}'`);
            } else {
                console.log("LOGIN SUCCESS: Credentials match.");
            }
        }
    } catch (err) {
        console.error("Error testing login:", err);
    } finally {
        process.exit();
    }
};

testLogin();
