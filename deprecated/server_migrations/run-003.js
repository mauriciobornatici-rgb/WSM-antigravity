import pool from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    console.log('🚀 Starting Migration 003: Invoicing System (ESM Version)...');

    try {
        console.log(`🔌 Connected to database via pool`);

        // Read SQL file
        const sqlPath = path.join(__dirname, '003-invoicing.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon to handle multiple statements safely if needed, 
        // essentially mimicking run-002.js logic which is proven to work.
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute\n`);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            const tableName = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];

            console.log(`Executing statement ${i + 1}...`);
            if (tableName) console.log(`   -> Creating table: ${tableName}`);

            try {
                await pool.query(statement);
                console.log(`   ✅ Success`);
            } catch (err) {
                console.error(`   ❌ Failed: ${err.message}`);
                // Don't exit process, just log. Some statements might fail if they exist.
            }
        }

        // Verify/Add columns to clients table manually
        console.log('\n🔧 Updating clients table schema...');
        try {
            await pool.query(`
                ALTER TABLE clients 
                ADD COLUMN tax_condition_id VARCHAR(36),
                ADD COLUMN tax_id VARCHAR(20),
                ADD CONSTRAINT fk_client_tax_condition FOREIGN KEY (tax_condition_id) REFERENCES tax_conditions(id);
            `);
            console.log('   ✅ Added columns tax_condition_id and tax_id to clients.');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('   ℹ️  Columns already exist in clients table, skipping.');
            } else {
                console.warn('   ⚠️ Warning adapting clients table:', e.message);
            }
        }

        console.log('\n🎉 Migration 003 completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
