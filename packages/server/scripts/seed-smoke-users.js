import pool from '../config/db.js';

const smokeUsers = [
    {
        id: '00000000-0000-0000-0000-00000000000a',
        name: 'Smoke Admin',
        email: 'smoke+admin@test.local',
        role: 'admin',
        password_hash: '$2b$10$xyzinvalidhashplaceholderfortesting'
    },
    {
        id: '00000000-0000-0000-0000-00000000000b',
        name: 'Smoke Manager',
        email: 'smoke+manager@test.local',
        role: 'manager',
        password_hash: '$2b$10$xyzinvalidhashplaceholderfortesting'
    },
    {
        id: '00000000-0000-0000-0000-00000000000c',
        name: 'Smoke Cashier',
        email: 'smoke+cashier@test.local',
        role: 'cashier',
        password_hash: '$2b$10$xyzinvalidhashplaceholderfortesting'
    },
    {
        id: '00000000-0000-0000-0000-00000000000d',
        name: 'Smoke Warehouse',
        email: 'smoke+warehouse@test.local',
        role: 'warehouse',
        password_hash: '$2b$10$xyzinvalidhashplaceholderfortesting'
    }
];

async function run() {
    try {
        console.log('Seeding smoke test users into DB...');
        for (const user of smokeUsers) {
            // Check if user exists
            const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [user.id]);
            if (existing.length > 0) {
                console.log(`User ${user.email} (${user.role}) already exists. Updating...`);
                await pool.query('UPDATE users SET role = ?, email = ?, name = ?, status = "active", deleted_at = NULL WHERE id = ?', [user.role, user.email, user.name, user.id]);
            } else {
                console.log(`Inserting user ${user.email} (${user.role})...`);
                await pool.query(
                    'INSERT INTO users (id, name, email, password_hash, role, status, token_version) VALUES (?, ?, ?, ?, ?, "active", 0)',
                    [user.id, user.name, user.email, user.password_hash, user.role]
                );
            }
        }
        console.log('Smoke test users seeded successfully.');
    } catch (err) {
        console.error('Error seeding smoke users:', err);
    } finally {
        await pool.end();
    }
}

run();
