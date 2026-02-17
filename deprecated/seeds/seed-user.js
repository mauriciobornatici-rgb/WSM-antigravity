import pool from './server/db.js';

async function seedUserAndFix() {
    try {
        console.log("--- SEEDING SYSTEM USER ---");

        // 1. Double check users table columns
        const [cols] = await pool.query("DESCRIBE users");
        console.log("Users Columns:", cols.map(c => c.Field));

        const hasUsername = cols.some(c => c.Field === 'username');
        const hasName = cols.some(c => c.Field === 'name');

        const userId = '00000000-0000-0000-0000-000000000000';

        // Try to insert a system user
        if (hasUsername) {
            await pool.query(
                "INSERT IGNORE INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
                [userId, 'admin', 'admin123', 'admin']
            );
        } else if (hasName) {
            await pool.query(
                "INSERT IGNORE INTO users (id, name, email, role) VALUES (?, ?, ?, ?)",
                [userId, 'Admin System', 'admin@system.com', 'admin']
            );
        }

        console.log("System User Seeded with ID:", userId);

        // Also check if taxes exist, sometimes that's another FK
        // (Tax conditions were seeded in my previous turns)

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seedUserAndFix();
