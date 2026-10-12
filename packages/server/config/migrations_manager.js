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

const DOCUMENT_SEQUENCE_MIGRATION = '002_create_document_sequences.sql';
const DOCUMENT_SEQUENCE_CREATE_SIGNATURE = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+document_sequences\s+\(\s+scope\s+VARCHAR\(120\)\s+PRIMARY\s+KEY,\s+last_value\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+0,\s+updated_at\s+TIMESTAMP\s+DEFAULT\s+CURRENT_TIMESTAMP\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP\s+\)$/i;
const PRODUCT_CATALOG_OPTIONS_MIGRATION = '039_create_product_catalog_options.sql';

const PRODUCT_CATALOG_OPTION_SEEDS = Object.freeze([
    ['group', 'category'],
    ['brand', 'brand'],
    ['size', 'size'],
    ['color', 'color'],
].map(([type, column]) => Object.freeze({
    original: `INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name) SELECT UUID(), SHA2(CONCAT('${type}||', LOWER(TRIM(${column}))), 256), '${type}', MIN(TRIM(${column})), LOWER(TRIM(${column})) FROM products WHERE deleted_at IS NULL AND NULLIF(TRIM(${column}), '') IS NOT NULL GROUP BY LOWER(TRIM(${column})) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    prepared: `INSERT INTO product_catalog_options (id, option_key, type, name, normalized_name) SELECT UUID(), SHA2(CONCAT('${type}||', LOWER(MIN(TRIM(${column})))), 256), '${type}', MIN(TRIM(${column})), LOWER(MIN(TRIM(${column}))) FROM products WHERE deleted_at IS NULL AND NULLIF(TRIM(${column}), '') IS NOT NULL GROUP BY LOWER(TRIM(${column})) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
})));

function normalizeMigrationStatement(statement) {
    return statement.replace(/\s+/g, ' ').trim();
}

function prepareMigrationStatement(file, statement) {
    const normalizedStatement = normalizeMigrationStatement(statement);

    if (file === DOCUMENT_SEQUENCE_MIGRATION && DOCUMENT_SEQUENCE_CREATE_SIGNATURE.test(normalizedStatement)) {
        return statement.replace(
            /(\bscope\s+VARCHAR\(120\)\s+PRIMARY\s+KEY\s*,\s*)(last_value)(\s+BIGINT\s+NOT\s+NULL\s+DEFAULT\s+0\b)/i,
            (_match, prefix, columnName, suffix) => `${prefix}\`${columnName}\`${suffix}`
        );
    }

    if (file !== PRODUCT_CATALOG_OPTIONS_MIGRATION) return statement;
    return PRODUCT_CATALOG_OPTION_SEEDS.find(({ original }) => original === normalizedStatement)?.prepared ?? statement;
}

function skipSqlTrivia(sql, start = 0) {
    let index = start;

    while (index < sql.length) {
        while (index < sql.length && /\s/.test(sql[index])) index += 1;

        if (sql.startsWith('--', index) || sql[index] === '#') {
            const lineEnd = sql.indexOf('\n', index + (sql[index] === '#' ? 1 : 2));
            index = lineEnd === -1 ? sql.length : lineEnd + 1;
            continue;
        }

        if (sql.startsWith('/*', index)) {
            const commentEnd = sql.indexOf('*/', index + 2);
            index = commentEnd === -1 ? sql.length : commentEnd + 2;
            continue;
        }

        break;
    }

    return index;
}

function readSqlIdentifier(sql, start = 0) {
    let index = skipSqlTrivia(sql, start);
    if (index >= sql.length) return null;

    const tokenStart = index;
    let quote = null;
    while (index < sql.length) {
        const character = sql[index];
        if (quote) {
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === quote) {
                if (sql[index + 1] === quote) {
                    index += 2;
                    continue;
                }
                quote = null;
            }
            index += 1;
            continue;
        }

        if (character === '`' || character === '"') {
            quote = character;
            index += 1;
            continue;
        }
        if (/\s/.test(character)) break;
        index += 1;
    }

    const token = sql.slice(tokenStart, index);
    if (!token) return null;

    let lastSegmentStart = 0;
    quote = null;
    for (let position = 0; position < token.length; position += 1) {
        const character = token[position];
        if (quote) {
            if (character === quote && token[position + 1] === quote) {
                position += 1;
                continue;
            }
            if (character === quote) quote = null;
            continue;
        }
        if (character === '`' || character === '"') {
            quote = character;
        } else if (character === '.') {
            lastSegmentStart = position + 1;
        }
    }

    let name = token.slice(lastSegmentStart).trim();
    if ((name.startsWith('`') && name.endsWith('`')) || (name.startsWith('"') && name.endsWith('"'))) {
        name = name.slice(1, -1).replaceAll(name[0] + name[0], name[0]);
    }

    return { token, name, end: index, qualified: lastSegmentStart > 0 };
}

function splitTopLevelComma(sql) {
    const actions = [];
    let actionStart = 0;
    let depth = 0;
    let quote = null;
    let index = 0;

    while (index < sql.length) {
        const character = sql[index];

        if (quote) {
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === quote) {
                if (sql[index + 1] === quote) {
                    index += 2;
                    continue;
                }
                quote = null;
            }
            index += 1;
            continue;
        }

        if (sql.startsWith('/*', index)) {
            const commentEnd = sql.indexOf('*/', index + 2);
            index = commentEnd === -1 ? sql.length : commentEnd + 2;
            continue;
        }
        if (sql.startsWith('--', index) || character === '#') {
            const lineEnd = sql.indexOf('\n', index + (character === '#' ? 1 : 2));
            index = lineEnd === -1 ? sql.length : lineEnd + 1;
            continue;
        }
        if (character === '`' || character === '\'' || character === '"') {
            quote = character;
            index += 1;
            continue;
        }
        if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth = Math.max(0, depth - 1);
        } else if (character === ',' && depth === 0) {
            const action = sql.slice(actionStart, index).trim();
            if (action) actions.push(action);
            actionStart = index + 1;
        }
        index += 1;
    }

    const finalAction = sql.slice(actionStart).trim();
    if (finalAction) actions.push(finalAction);
    return actions;
}

function parseAlterTableStatement(statement) {
    const statementStart = skipSqlTrivia(statement);
    const alterMatch = /^ALTER\s+TABLE\b/i.exec(statement.slice(statementStart));
    if (!alterMatch) return null;

    const table = readSqlIdentifier(statement, statementStart + alterMatch[0].length);
    if (!table) return null;
    const actionStart = skipSqlTrivia(statement, table.end);
    const actionSql = statement.slice(actionStart);
    if (!actionSql.trim()) return null;

    return {
        tableToken: table.token,
        tableName: table.name,
        tableQualified: table.qualified,
        actions: splitTopLevelComma(actionSql),
    };
}

function parseConditionalAddColumn(action) {
    const actionStart = skipSqlTrivia(action);
    const body = action.slice(actionStart);
    const match = /^ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.exec(body);
    if (!match) return null;

    const column = readSqlIdentifier(body, match[0].length);
    if (!column) return null;
    return {
        columnName: column.name,
        actionStart,
        clauseLength: match[0].length,
    };
}

function removeConditionalClause(action, parsedAction) {
    const body = action.slice(parsedAction.actionStart);
    const addColumnPrefix = /^ADD\s+COLUMN/i.exec(body)?.[0];
    if (!addColumnPrefix) return action;
    return `${action.slice(0, parsedAction.actionStart)}${addColumnPrefix}${body.slice(parsedAction.clauseLength)}`;
}

async function findExistingColumns(connection, tableName, columns) {
    const placeholders = columns.map(() => '?').join(', ');
    const [rows] = await connection.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME IN (${placeholders})`,
        [tableName, ...columns]
    );
    return new Set(rows.map((row) => String(row.COLUMN_NAME ?? row.column_name).toLowerCase()));
}

async function prepareAlterTableStatement(connection, statement) {
    const parsed = parseAlterTableStatement(statement);
    if (!parsed) return { sql: statement, transformed: false };

    const conditionalActions = parsed.actions.map((action) => ({
        action,
        parsedAction: parseConditionalAddColumn(action),
    })).filter(({ parsedAction }) => parsedAction);
    if (conditionalActions.length === 0) return { sql: statement, transformed: false };
    if (parsed.tableQualified) {
        throw new Error(
            `Conditional ALTER TABLE requires an unqualified table name; received ${parsed.tableToken}`
        );
    }

    const existingColumns = await findExistingColumns(
        connection,
        parsed.tableName,
        conditionalActions.map(({ parsedAction }) => parsedAction.columnName)
    );
    const transformedActions = parsed.actions
        .filter((action) => {
            const parsedAction = parseConditionalAddColumn(action);
            return !parsedAction || !existingColumns.has(parsedAction.columnName.toLowerCase());
        })
        .map((action) => {
            const parsedAction = parseConditionalAddColumn(action);
            return parsedAction ? removeConditionalClause(action, parsedAction) : action;
        });

    if (transformedActions.length === 0) {
        return { sql: null, transformed: true, skipped: true };
    }

    return {
        sql: `ALTER TABLE ${parsed.tableToken} ${transformedActions.join(',\n')}`,
        transformed: true,
        skipped: false,
    };
}

function isDdlStatement(statement) {
    const withoutLeadingComments = statement.slice(skipSqlTrivia(statement)).trim();
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
    prepareMigrationStatement,
    splitAlterTableActions: splitTopLevelComma,
    parseAlterTableStatement,
    parseConditionalAddColumn,
    prepareAlterTableStatement,
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
        const migrationsChecksumStatement = await prepareAlterTableStatement(
            connection,
            'ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64) NULL AFTER name'
        );
        if (migrationsChecksumStatement.sql) {
            await connection.query(migrationsChecksumStatement.sql);
        }
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
                    const migrationStatement = prepareMigrationStatement(file, statement);
                    const preparedStatement = await prepareAlterTableStatement(connection, migrationStatement);
                    if (preparedStatement.sql) {
                        try {
                            await connection.query(preparedStatement.sql);
                        } catch (error) {
                            // A transformed ALTER was already checked against
                            // INFORMATION_SCHEMA. A failure must remain fatal;
                            // do not reinterpret it as a broad duplicate-DDL
                            // recovery case.
                            if (preparedStatement.transformed || !isRecoverableAlreadyAppliedDdl(error, statement)) {
                                throw error;
                            }
                            console.warn(`Statement ${index + 1} of ${file} was already applied; recording recovery state.`);
                        }
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
