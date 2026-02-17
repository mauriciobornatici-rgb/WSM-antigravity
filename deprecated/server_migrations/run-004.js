import pool from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
    try {
        console.log("--- RUNNING MIGRATION 004: CASH MANAGEMENT ---");
        const sqlPath = path.join(__dirname, '004-cash-management.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon but ignore inside comments/strings if any
        // For simple migrations, splitting by ; is usually enough if not using procedures
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

        for (const statement of statements) {
            await pool.query(statement);
            console.log("Executed statement successfully.");
        }

        console.log("Migration 004 COMPLETED SUCCESSFULLY.");
        process.exit(0);
    } catch (err) {
        console.error("Migration 004 FAILED:", err);
        process.exit(1);
    }
}

runMigration();
