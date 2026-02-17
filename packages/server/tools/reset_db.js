import pool from '../config/db.js';
import { initDatabase } from '../config/initDb.js';

const resetDatabase = async () => {
    try {
        console.log("!!! WARNING: STARTING DATABASE RESET !!!");
        console.log("This will delete ALL data.");

        // Disable foreign key checks to drop tables easily
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');

        const [tables] = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ?
        `, [process.env.DB_NAME]);

        for (const table of tables) {
            console.log(`Dropping table: ${table.table_name}...`);
            await pool.query(`DROP TABLE IF EXISTS ${table.table_name}`);
        }

        await pool.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log("Database cleared. Re-initializing schema...");
        await initDatabase();

        console.log("!!! DATABASE RESET COMPLETED SUCCESSFULLY !!!");
        process.exit(0);
    } catch (err) {
        console.error("CRITICAL ERROR DURING RESET:", err);
        process.exit(1);
    }
};

resetDatabase();
