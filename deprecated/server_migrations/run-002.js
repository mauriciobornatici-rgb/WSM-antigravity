import pool from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    try {
        console.log('🔄 Running reception system migration...\n');

        // Read SQL file
        const sqlPath = path.join(__dirname, '002-reception-system.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split by semicolon and filter empty statements
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute\n`);

        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            const tableName = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];

            if (tableName) {
                console.log(`${i + 1}. Creating table: ${tableName}...`);
                await pool.query(statement);
                console.log(`   ✅ ${tableName} created successfully\n`);
            }
        }

        console.log('✅ Migration completed successfully!');
        console.log('\nTables created:');
        console.log('  - purchase_orders');
        console.log('  - purchase_order_items');
        console.log('  - receptions');
        console.log('  - reception_items');
        console.log('  - quality_checks');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

runMigration();
