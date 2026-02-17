import pool from './server/db.js';

const checkUsers = async () => {
    try {
        const [rows] = await pool.query('SELECT id, name, email, role, status, password_hash FROM users');
        console.log('--- USERS DUMP ---');
        rows.forEach(u => {
            console.log(`ID: ${u.id}`);
            console.log(`Name: '${u.name}'`);
            console.log(`Email: '${u.email}'`);
            console.log(`Role: '${u.role}'`);
            console.log(`Status: '${u.status}'`);
            console.log(`Password Hash: '${u.password_hash}'`);
            console.log('-------------------');
        });
        if (rows.length === 0) console.log("No users found.");
    } catch (error) {
        console.error('Error querying users:', error);
    } finally {
        process.exit();
    }
};

checkUsers();
