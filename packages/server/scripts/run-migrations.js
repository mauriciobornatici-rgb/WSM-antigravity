import { runMigrations } from '../config/migrations_manager.js';
import { closePool } from '../config/db.js';

try {
    await runMigrations();
    console.log('Migrations completed successfully.');
} catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
} finally {
    await closePool();
}
