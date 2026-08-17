import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const RETENTION_COUNT = 10;

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = `backup-${timestamp}.sql`;
const filepath = path.join(backupDir, filename);

// Note: This requires mysqldump to be installed in the system.
// The password travels via MYSQL_PWD env (not the process argument list) and
// --single-transaction keeps InnoDB dumps consistent without locking tables.
const args = [
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    `-h`, process.env.DB_HOST || 'localhost',
    `-P`, process.env.DB_PORT || '3306',
    `-u`, process.env.DB_USER || 'root'
];
if (String(process.env.DB_SSL || '').toLowerCase() === 'true') {
    args.push('--ssl');
}
args.push(process.env.DB_NAME || 'sports_erp');

const childEnv = { ...process.env };
if (process.env.DB_PASSWORD) {
    childEnv.MYSQL_PWD = process.env.DB_PASSWORD;
}

console.log('--- Starting Database Backup ---');
console.log(`Target: ${filename}`);

execFile('mysqldump', args, { env: childEnv, maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
    if (error) {
        console.error(`Backup Failed: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    try {
        fs.writeFileSync(filepath, stdout);
    } catch (writeErr) {
        console.error(`Backup Failed to write file: ${writeErr.message}`);
        process.exitCode = 1;
        return;
    }
    if (stderr) {
        console.log(`Backup Warning: ${stderr}`);
    }
    console.log(`Backup Successful! File saved at: ${filepath}`);

    // Retention: keep only the newest RETENTION_COUNT backups.
    try {
        const backups = fs.readdirSync(backupDir)
            .filter((f) => f.startsWith('backup-') && f.endsWith('.sql'))
            .sort();
        const stale = backups.slice(0, Math.max(0, backups.length - RETENTION_COUNT));
        for (const f of stale) {
            fs.unlinkSync(path.join(backupDir, f));
        }
        if (stale.length > 0) {
            console.log(`Retention: removed ${stale.length} old backup(s).`);
        }
    } catch (retentionErr) {
        console.warn(`Retention cleanup failed: ${retentionErr.message}`);
    }
});
