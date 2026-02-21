import pool from './config/db.js';

async function listTables() {
    try {
        const [rows] = await pool.query("SHOW TABLES");
        console.log(JSON.stringify(rows.map(r => Object.values(r)[0]), null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
listTables();
