import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const backupDir = path.join(process.cwd(), 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = `backup-${timestamp}.sql`;
const filepath = path.join(backupDir, filename);

// Note: This requires mysqldump to be installed in the system
const command = `mysqldump -u ${process.env.DB_USER || 'root'} ${process.env.DB_PASSWORD ? `-p${process.env.DB_PASSWORD}` : ''} ${process.env.DB_NAME || 'sports_erp'} > "${filepath}"`;

console.log('--- Starting Database Backup ---');
console.log(`Target: ${filename}`);

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error(`Backup Failed: ${error.message}`);
        return;
    }
    if (stderr) {
        console.log(`Backup Warning: ${stderr}`);
    }
    console.log(`Backup Successful! File saved at: ${filepath}`);
});
