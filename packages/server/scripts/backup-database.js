#!/usr/bin/env node

/**
 * WSM SportsERP — Native Database Backup & Restore Utility
 *
 * Produces clean, self-contained SQL dumps with DDL and data for all tables
 * without requiring external mysqldump installation.
 * Includes gzip compression and SHA-256 integrity checksums.
 *
 * Usage:
 *   node scripts/backup-database.js               # Creates timestamped backup in backups/
 *   node scripts/backup-database.js --gzip        # Creates gzipped backup (.sql.gz)
 *   node scripts/backup-database.js --restore=<file.sql> # Restores database from dump
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { getEnvConfig } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repositoryRoot = path.resolve(__dirname, '../../..');

const rootEnvPath = path.join(repositoryRoot, '.env');
dotenv.config({ path: rootEnvPath });

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        gzip: false,
        outputDir: path.join(repositoryRoot, 'backups'),
        restoreFile: null
    };

    for (const arg of args) {
        if (arg === '--gzip') {
            options.gzip = true;
        } else if (arg.startsWith('--output=')) {
            options.outputDir = path.resolve(arg.split('=')[1]);
        } else if (arg.startsWith('--restore=')) {
            options.restoreFile = path.resolve(arg.split('=')[1]);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
WSM SportsERP — Database Backup & Restore Tool

Usage:
  node scripts/backup-database.js                     Create timestamped SQL dump
  node scripts/backup-database.js --gzip              Create compressed .sql.gz dump
  node scripts/backup-database.js --restore=<file>    Restore database from dump
  --output=<dir>                                      Set output directory (default: backups/)
`);
            process.exit(0);
        }
    }

    return options;
}

function escapeSqlValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'boolean') return val ? '1' : '0';
    if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
    if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
    if (typeof val === 'object') return mysql.escape(JSON.stringify(val));
    return mysql.escape(String(val));
}

async function runBackup(options) {
    const env = getEnvConfig();
    console.log('================================================================');
    console.log('WSM SportsERP — Database Backup');
    console.log('================================================================');
    console.log(`- Host:     ${process.env.DB_HOST || 'localhost'}:${env.dbPort}`);
    console.log(`- Database: ${process.env.DB_NAME || 'sports_erp'}`);
    console.log(`- Output:   ${options.outputDir}`);

    fs.mkdirSync(options.outputDir, { recursive: true });

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: env.dbPort,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'sports_erp',
        ...(env.dbSsl ? { ssl: { rejectUnauthorized: env.dbSslRejectUnauthorized } } : {})
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `wsm_backup_${process.env.DB_NAME || 'db'}_${timestamp}`;
    const sqlFilePath = path.join(options.outputDir, `${baseFilename}.sql`);
    const writeStream = fs.createWriteStream(sqlFilePath, { encoding: 'utf8' });

    try {
        const startedAt = Date.now();

        writeStream.write(`-- ==============================================================================\n`);
        writeStream.write(`-- WSM SportsERP — Database Backup Dump\n`);
        writeStream.write(`-- Generated: ${new Date().toISOString()}\n`);
        writeStream.write(`-- Database:  ${process.env.DB_NAME}\n`);
        writeStream.write(`-- ==============================================================================\n\n`);
        writeStream.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
        writeStream.write(`SET NAMES utf8mb4;\n`);
        writeStream.write(`SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n`);

        const [tables] = await connection.query(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
        const tableNames = tables.map((r) => Object.values(r)[0]);

        console.log(`[INFO] Exporting ${tableNames.length} tables...`);
        let totalRows = 0;

        for (const tableName of tableNames) {
            const [[createRow]] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
            const createSql = createRow['Create Table'];

            writeStream.write(`-- ------------------------------------------------------------------------------\n`);
            writeStream.write(`-- Structure & Data for table \`${tableName}\`\n`);
            writeStream.write(`-- ------------------------------------------------------------------------------\n`);
            writeStream.write(`DROP TABLE IF EXISTS \`${tableName}\`;\n`);
            writeStream.write(`${createSql};\n\n`);

            const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
            if (rows.length > 0) {
                totalRows += rows.length;
                const columns = Object.keys(rows[0]).map((col) => `\`${col}\``).join(', ');

                const BATCH_SIZE = 250;
                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, i + BATCH_SIZE);
                    const valuesList = batch.map((row) => {
                        const values = Object.values(row).map(escapeSqlValue).join(', ');
                        return `(${values})`;
                    }).join(',\n');

                    writeStream.write(`INSERT INTO \`${tableName}\` (${columns}) VALUES\n${valuesList};\n\n`);
                }
            }
        }

        writeStream.write(`SET FOREIGN_KEY_CHECKS = 1;\n`);
        writeStream.write(`-- Dump completed at: ${new Date().toISOString()}\n`);
        await new Promise((resolve) => writeStream.end(resolve));

        const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
        const stats = fs.statSync(sqlFilePath);
        console.log(`[SUCCESS] SQL Dump created: ${path.basename(sqlFilePath)} (${(stats.size / 1024).toFixed(1)} KB, ${totalRows} rows in ${durationSec}s)`);

        // Compute SHA-256 Checksum
        const fileBuffer = fs.readFileSync(sqlFilePath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        fs.writeFileSync(`${sqlFilePath}.sha256`, `${hash}  ${path.basename(sqlFilePath)}\n`);
        console.log(`- SHA-256: ${hash}`);

        // Gzip compression if requested
        if (options.gzip) {
            const gzPath = `${sqlFilePath}.gz`;
            const gzipped = zlib.gzipSync(fileBuffer);
            fs.writeFileSync(gzPath, gzipped);
            const gzStats = fs.statSync(gzPath);
            console.log(`- Compressed: ${path.basename(gzPath)} (${(gzStats.size / 1024).toFixed(1)} KB)`);
        }

        console.log('================================================================');
    } finally {
        await connection.end();
    }
}

async function runRestore(filePath) {
    const env = getEnvConfig();
    console.log('================================================================');
    console.log('WSM SportsERP — Database Restore');
    console.log('================================================================');
    console.log(`- Target DB: ${process.env.DB_NAME || 'sports_erp'}`);
    console.log(`- Dump file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Dump file does not exist: ${filePath}`);
    }

    let sqlContent = '';
    if (filePath.endsWith('.gz')) {
        const compressed = fs.readFileSync(filePath);
        sqlContent = zlib.gunzipSync(compressed).toString('utf8');
    } else {
        sqlContent = fs.readFileSync(filePath, 'utf8');
    }

    const shaFile = `${filePath.replace(/\.gz$/, '')}.sha256`;
    if (fs.existsSync(shaFile)) {
        const expectedHash = fs.readFileSync(shaFile, 'utf8').split(' ')[0].trim();
        const uncompressedBuffer = filePath.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(filePath)) : fs.readFileSync(filePath);
        const actualHash = crypto.createHash('sha256').update(uncompressedBuffer).digest('hex');
        if (actualHash === expectedHash) {
            console.log(`[INFO] Checksum verified: SHA-256 matches expected.`);
        } else {
            console.warn(`[WARNING] Checksum mismatch! Expected ${expectedHash}, got ${actualHash}`);
        }
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: env.dbPort,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'sports_erp',
        multipleStatements: true,
        ...(env.dbSsl ? { ssl: { rejectUnauthorized: env.dbSslRejectUnauthorized } } : {})
    });

    try {
        console.log('[INFO] Executing restore SQL script...');
        const startedAt = Date.now();
        await connection.query(sqlContent);
        const durationSec = ((Date.now() - startedAt) / 1000).toFixed(2);
        console.log(`[SUCCESS] Database restore completed successfully in ${durationSec}s.`);
        console.log('================================================================');
    } finally {
        await connection.end();
    }
}

async function main() {
    const options = parseArgs();
    try {
        if (options.restoreFile) {
            await runRestore(options.restoreFile);
        } else {
            await runBackup(options);
        }
    } catch (err) {
        console.error('\n[FATAL ERROR] Backup/Restore operation failed:', err.message);
        process.exit(1);
    }
}

main();
