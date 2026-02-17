import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const sql = await fs.readFile(schemaPath, 'utf8');

        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute.`);

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            for (const statement of statements) {
                await connection.query(statement);
            }

            await connection.commit();
            console.log('Migration completed successfully.');
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
