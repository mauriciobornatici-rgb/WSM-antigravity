import pool from '../config/db.js';

async function check() {
    try {
        console.log("Querying suppliers...");
        const [suppliers] = await pool.query("SELECT * FROM suppliers WHERE deleted_at IS NULL");
        console.log("Suppliers count:", suppliers.length);
        console.log(suppliers.map(sup => ({
            id: sup.id,
            name: sup.name,
            account_balance: sup.account_balance
        })));
    } catch (e) {
        console.error("Error querying db:", e);
    } finally {
        pool.end();
    }
}
check();
