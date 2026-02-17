import mysql from 'mysql2/promise';
import pool from './server/db.js';

async function test() {
    try {
        const [rows] = await pool.query('SELECT * FROM invoices');
        console.log('Invoices count:', rows.length);
        console.log(JSON.stringify(rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

test();
