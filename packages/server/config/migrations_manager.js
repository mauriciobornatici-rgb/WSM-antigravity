import pool from './db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

export const runMigrations = async () => {
    try {
        console.log("--- Starting Database Migrations ---");

        // 1. Create migrations table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Get executed migrations
        const [executedRows] = await pool.query("SELECT name FROM _migrations");
        const executedMigrations = new Set(executedRows.map(r => r.name));

        // 3. Read migration files
        const files = await fs.readdir(MIGRATIONS_DIR);
        const sqlFiles = files
            .filter(f => f.endsWith('.sql'))
            .sort(); // Sort by name (v1, v2, etc)

        for (const file of sqlFiles) {
            if (executedMigrations.has(file)) {
                console.log(`Migration ${file} already executed. Skipping.`);
                continue;
            }

            console.log(`Executing migration: ${file}...`);
            const filePath = path.join(MIGRATIONS_DIR, file);
            const sql = await fs.readFile(filePath, 'utf8');

            // Split by ';' but be careful with triggers/procedures if added later
            // For now simple split is fine for basic schema
            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                for (const statement of statements) {
                    await connection.query(statement);
                }

                await connection.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
                await connection.commit();
                console.log(`Migration ${file} completed successfully.`);
            } catch (err) {
                await connection.rollback();
                console.error(`Error in migration ${file}:`, err);
                throw err;
            } finally {
                connection.release();
            }
        }

        console.log("--- All migrations are up to date ---");
    } catch (err) {
        console.error("Migration systemic failure:", err);
        throw err;
    }
};
