import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');
const MIGRATION_LOCK = 'wsm_schema_migrations';
const ACCEPTED_HISTORICAL_CHECKSUMS = new Map([
    [
        '028_add_core_referential_integrity.sql',
        new Set(['702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'])
    ]
]);

function checksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function isAcceptedHistoricalChecksum(file, recordedChecksum) {
    return ACCEPTED_HISTORICAL_CHECKSUMS.get(file)?.has(recordedChecksum) === true;
}

function splitStatements(sql) {
    return sql.split(';').map((statement) => statement.trim()).filter(Boolean);
}

function isDdlStatement(statement) {
    const withoutLeadingComments = statement
        .replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/g, '')
        .trim();
    return /^(CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i.test(withoutLeadingComments);
}

function isRecoverableAlreadyAppliedDdl(error, statement) {
    const normalized = statement.toUpperCase();
    return (
        (error?.code === 'ER_DUP_FIELDNAME' && normalized.includes('ADD COLUMN'))
        || (error?.code === 'ER_DUP_KEYNAME' && normalized.includes('ADD UNIQUE KEY'))
        || (error?.code === 'ER_FK_DUP_NAME' && normalized.includes('ADD CONSTRAINT'))
        || (error?.code === 'ER_CANT_CREATE_TABLE' && /errno:\s*121\b/i.test(String(error?.sqlMessage || '')) && normalized.includes('ADD CONSTRAINT'))
        || (error?.code === 'ER_TRG_ALREADY_EXISTS' && normalized.startsWith('CREATE TRIGGER'))
    );
}

export const migrationInternals = Object.freeze({
    checksum,
    splitStatements,
    isDdlStatement,
    isRecoverableAlreadyAppliedDdl,
    isAcceptedHistoricalChecksum
});

export const runMigrations = async () => {
    const connection = await pool.getConnection();
    let lockAcquired = false;

    try {
        console.log('--- Starting Database Migrations ---');
        const [[lockResult]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION_LOCK]);
        lockAcquired = Number(lockResult?.acquired) === 1;
        if (!lockAcquired) throw new Error('Could not acquire the database migration lock within 30 seconds');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                checksum CHAR(64) NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await connection.query('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64) NULL AFTER name');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS _migration_steps (
                migration_name VARCHAR(255) NOT NULL,
                statement_index INT NOT NULL,
                statement_checksum CHAR(64) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (migration_name, statement_index)
            )
        `);

        const [executedRows] = await connection.query('SELECT name, checksum FROM _migrations');
        const executedMigrations = new Map(executedRows.map((row) => [row.name, row.checksum]));
        const files = (await fs.readdir(MIGRATIONS_DIR))
            .filter((file) => file.endsWith('.sql'))
            .sort();

        for (const file of files) {
            const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
            const fileChecksum = checksum(sql);
            const recordedChecksum = executedMigrations.get(file);

            if (recordedChecksum !== undefined) {
                if (recordedChecksum && recordedChecksum !== fileChecksum) {
                    if (!isAcceptedHistoricalChecksum(file, recordedChecksum)) {
                        throw new Error(`Migration ${file} changed after execution; create a new migration instead`);
                    }
                    console.warn(`Migration ${file} matches an explicitly accepted historical checksum. Skipping.`);
                    continue;
                }
                if (!recordedChecksum) {
                    await connection.query('UPDATE _migrations SET checksum = ? WHERE name = ?', [fileChecksum, file]);
                }
                console.log(`Migration ${file} already executed. Skipping.`);
                continue;
            }

            console.log(`Executing migration: ${file}...`);
            const statements = splitStatements(sql);
            const [completedRows] = await connection.query(
                'SELECT statement_index, statement_checksum FROM _migration_steps WHERE migration_name = ?',
                [file]
            );
            const completedSteps = new Map(
                completedRows.map((row) => [Number(row.statement_index), row.statement_checksum])
            );

            for (const [index, statement] of statements.entries()) {
                const statementChecksum = checksum(statement);
                const completedChecksum = completedSteps.get(index);
                if (completedChecksum) {
                    if (completedChecksum !== statementChecksum) {
                        throw new Error(`Statement ${index + 1} of ${file} changed after partial execution`);
                    }
                    continue;
                }

                const transactional = !isDdlStatement(statement);
                if (transactional) await connection.beginTransaction();
                try {
                    try {
                        await connection.query(statement);
                    } catch (error) {
                        if (!isRecoverableAlreadyAppliedDdl(error, statement)) throw error;
                        console.warn(`Statement ${index + 1} of ${file} was already applied; recording recovery state.`);
                    }

                    await connection.query(
                        'INSERT INTO _migration_steps (migration_name, statement_index, statement_checksum) VALUES (?, ?, ?)',
                        [file, index, statementChecksum]
                    );
                    if (transactional) await connection.commit();
                } catch (error) {
                    if (transactional) await connection.rollback();
                    throw error;
                }
            }

            await connection.query('INSERT INTO _migrations (name, checksum) VALUES (?, ?)', [file, fileChecksum]);
            console.log(`Migration ${file} completed successfully.`);
        }

        console.log('--- All migrations are up to date ---');
    } catch (error) {
        console.error('Migration systemic failure:', error);
        throw error;
    } finally {
        if (lockAcquired) {
            try {
                await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
            } catch (releaseError) {
                console.error('Failed to release migration lock:', releaseError);
            }
        }
        connection.release();
    }
};
