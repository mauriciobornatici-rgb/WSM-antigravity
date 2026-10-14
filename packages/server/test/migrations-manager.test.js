import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pool from '../config/db.js';
import { runMigrations } from '../config/migrations_manager.js';
import { migrationInternals } from '../config/migrations_manager.js';

async function getMigrationManifest() {
    const directory = new URL('../migrations/', import.meta.url);
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
    return Promise.all(files.map(async (name) => {
        const content = await fs.readFile(new URL(name, directory), 'utf8');
        return { name, content, checksum: migrationInternals.checksum(content) };
    }));
}

function silenceMigrationLogs(t) {
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    t.after(() => Object.assign(console, original));
}

test('migration checksums are deterministic and content-sensitive', () => {
    assert.equal(migrationInternals.checksum('SELECT 1'), migrationInternals.checksum('SELECT 1'));
    assert.notEqual(migrationInternals.checksum('SELECT 1'), migrationInternals.checksum('SELECT 2'));
});

test('migration statement splitter ignores empty trailing statements', () => {
    assert.deepEqual(
        migrationInternals.splitStatements('SELECT 1;\n\nUPDATE x SET y = 2;;'),
        ['SELECT 1', 'UPDATE x SET y = 2']
    );
});

test('legacy document sequence quoting is scoped to migration 002 and preserves the original statement', async () => {
    const manifest = await getMigrationManifest();
    const target = manifest.find(({ name }) => name === '002_create_document_sequences.sql');
    const originalStatement = migrationInternals.splitStatements(target.content)[0];
    const preparedStatement = migrationInternals.prepareMigrationStatement(target.name, originalStatement);

    assert.match(preparedStatement, /CREATE TABLE IF NOT EXISTS document_sequences/);
    assert.match(preparedStatement, /`last_value` BIGINT NOT NULL DEFAULT 0/);
    assert.notEqual(preparedStatement, originalStatement);
    assert.equal(
        migrationInternals.prepareMigrationStatement('003_add_user_token_version.sql', originalStatement),
        originalStatement
    );
    assert.equal(
        migrationInternals.prepareMigrationStatement(target.name, 'CREATE TABLE IF NOT EXISTS other_table (last_value BIGINT)'),
        'CREATE TABLE IF NOT EXISTS other_table (last_value BIGINT)'
    );
});

test('migration 039 catalog seeds use deterministic aggregate representatives under strict grouping', async () => {
    const manifest = await getMigrationManifest();
    const target = manifest.find(({ name }) => name === '039_create_product_catalog_options.sql');
    const seedStatements = migrationInternals.splitStatements(target.content)
        .filter((statement) => statement.startsWith('INSERT INTO product_catalog_options'));
    const expectedSeeds = [
        ['group', 'category'],
        ['brand', 'brand'],
        ['size', 'size'],
        ['color', 'color'],
    ];

    assert.equal(seedStatements.length, expectedSeeds.length);
    for (const [index, [type, column]] of expectedSeeds.entries()) {
        const originalStatement = seedStatements[index];
        const preparedStatement = migrationInternals.prepareMigrationStatement(target.name, originalStatement);
        assert.match(preparedStatement, new RegExp(
            `SHA2\\(CONCAT\\('${type}\\|\\|', LOWER\\(MIN\\(TRIM\\(${column}\\)\\)\\)\\), 256\\)`
        ));
        assert.match(preparedStatement, new RegExp(
            `'${type}', MIN\\(TRIM\\(${column}\\)\\), LOWER\\(MIN\\(TRIM\\(${column}\\)\\)\\)`
        ));
        assert.match(preparedStatement, new RegExp(`GROUP BY LOWER\\(TRIM\\(${column}\\)\\)`));
        assert.doesNotMatch(preparedStatement, new RegExp(
            `SHA2\\(CONCAT\\('${type}\\|\\|', LOWER\\(TRIM\\(${column}\\)\\)\\), 256\\)`
        ));
        assert.equal(
            migrationInternals.prepareMigrationStatement('038_create_product_families.sql', originalStatement),
            originalStatement
        );
        assert.equal(
            migrationInternals.prepareMigrationStatement(target.name, originalStatement.replaceAll('product_catalog_options', 'other_table')),
            originalStatement.replaceAll('product_catalog_options', 'other_table')
        );
        assert.notEqual(preparedStatement, originalStatement);
    }

    const updateStatement = migrationInternals.splitStatements(target.content)
        .find((statement) => statement.startsWith('UPDATE products'));
    assert.equal(migrationInternals.prepareMigrationStatement(target.name, updateStatement), updateStatement);
});

test('ALTER action splitter keeps commas inside types, strings, backticks and comments', () => {
    const tick = String.fromCharCode(96);
    const parsed = migrationInternals.parseAlterTableStatement(`
        ALTER TABLE ${tick}quoted_table${tick}
            MODIFY COLUMN amount DECIMAL(12,2) NOT NULL,
            ADD COLUMN IF NOT EXISTS ${tick}state,code${tick} ENUM('a,b','c') NULL,
            /* comment, with a comma */ ADD COLUMN IF NOT EXISTS notes TEXT NULL;
    `);

    assert.equal(parsed.tableName, 'quoted_table');
    assert.equal(parsed.actions.length, 3);
    assert.match(parsed.actions[0], /DECIMAL\(12,2\)/);
    assert.match(parsed.actions[1], /ENUM\('a,b','c'\)/);
    assert.match(parsed.actions[2], /comment, with a comma/);
});

test('conditional ALTER preparation skips present columns and removes only the conditional clause', async () => {
    const calls = [];
    const connection = {
        async query(sql, params) {
            calls.push({ sql: String(sql), params });
            return [[{ COLUMN_NAME: 'already_there' }]];
        },
    };

    const skipped = await migrationInternals.prepareAlterTableStatement(
        connection,
        'ALTER TABLE example ADD COLUMN IF NOT EXISTS already_there VARCHAR(30) NULL'
    );
    assert.equal(skipped.sql, null);
    assert.equal(skipped.transformed, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /INFORMATION_SCHEMA\.COLUMNS/);
    assert.deepEqual(calls[0].params, ['example', 'already_there']);

    calls.length = 0;
    const added = await migrationInternals.prepareAlterTableStatement(
        connection,
        'ALTER TABLE example ADD COLUMN IF NOT EXISTS new_column VARCHAR(30) NULL'
    );
    assert.equal(added.transformed, true);
    assert.match(added.sql, /ADD COLUMN new_column VARCHAR\(30\) NULL/);
    assert.doesNotMatch(added.sql, /IF NOT EXISTS/);
});

test('conditional ALTER preparation preserves MODIFY order and filters mixed actions', async () => {
    const tick = String.fromCharCode(96);
    const connection = {
        async query() {
            return [[{ COLUMN_NAME: 'state,code' }]];
        },
    };
    const prepared = await migrationInternals.prepareAlterTableStatement(
        connection,
        `ALTER TABLE ${tick}widgets${tick}
            MODIFY COLUMN amount DECIMAL(12,2) NOT NULL,
            ADD COLUMN IF NOT EXISTS ${tick}state,code${tick} ENUM('a,b','c') NULL,
            ADD COLUMN IF NOT EXISTS notes TEXT NULL`
    );

    assert.equal(prepared.transformed, true);
    assert.match(prepared.sql, new RegExp(`^ALTER TABLE ${tick}widgets${tick} MODIFY COLUMN amount DECIMAL\\(12,2\\) NOT NULL,`));
    assert.doesNotMatch(prepared.sql, /state,code/);
    assert.match(prepared.sql, /ADD COLUMN notes TEXT NULL/);
    assert.doesNotMatch(prepared.sql, /IF NOT EXISTS/);
});

test('conditional ALTER metadata failures remain fatal', async () => {
    const failure = new Error('metadata unavailable');
    const connection = {
        async query() {
            throw failure;
        },
    };

    await assert.rejects(
        () => migrationInternals.prepareAlterTableStatement(
            connection,
            'ALTER TABLE example ADD COLUMN IF NOT EXISTS new_column VARCHAR(30) NULL'
        ),
        failure
    );
});

test('conditional ALTER rejects qualified table names before metadata lookup', async () => {
    let metadataLookups = 0;
    const connection = {
        async query() {
            metadataLookups += 1;
            return [[]];
        },
    };

    await assert.rejects(
        () => migrationInternals.prepareAlterTableStatement(
            connection,
            'ALTER TABLE other_schema.example ADD COLUMN IF NOT EXISTS new_column VARCHAR(30) NULL'
        ),
        /requires an unqualified table name/
    );
    assert.equal(metadataLookups, 0);
});

test('migration runner distinguishes implicit-commit DDL from transactional data changes', () => {
    assert.equal(migrationInternals.isDdlStatement('ALTER TABLE x ADD COLUMN y INT'), true);
    assert.equal(migrationInternals.isDdlStatement('-- schema\nCREATE TABLE x (id INT)'), true);
    assert.equal(migrationInternals.isDdlStatement('CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW SET @x = 1'), true);
    assert.equal(migrationInternals.isDdlStatement('UPDATE x SET y = 2'), false);
});

test('partial migration recovery only accepts matching duplicate DDL errors', () => {
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_DUP_KEYNAME' },
            'ALTER TABLE x ADD UNIQUE KEY uq_x (id)'
        ),
        true
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_PARSE_ERROR' },
            'ALTER TABLE x ADD UNIQUE KEY uq_x (id)'
        ),
        false
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_CANT_CREATE_TABLE', errno: 1005, sqlMessage: "errno: 121 Duplicate key on write or update" },
            'ALTER TABLE x ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES y(id)'
        ),
        true
    );
    assert.equal(
        migrationInternals.isRecoverableAlreadyAppliedDdl(
            { code: 'ER_CANT_CREATE_TABLE', errno: 1005, sqlMessage: "errno: 150 Foreign key is incorrectly formed" },
            'ALTER TABLE x ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES y(id)'
        ),
        false
    );
});

test('historical checksum compatibility is narrowly scoped to the applied migration variant', () => {
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '028_add_core_referential_integrity.sql',
            '702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'
        ),
        true
    );
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '028_add_core_referential_integrity.sql',
            'different-checksum'
        ),
        false
    );
    assert.equal(
        migrationInternals.isAcceptedHistoricalChecksum(
            '027_make_journal_entries_immutable.sql',
            '702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'
        ),
        false
    );
});

test('runMigrations executes every pending migration and releases its advisory lock', async (t) => {
    const originalGetConnection = pool.getConnection;
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const calls = [];
    let began = 0;
    let committed = 0;
    let released = false;
    const recordedSteps = [];
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') return [[]];
            if (statement.includes('SELECT statement_index')) return [[]];
            if (statement.startsWith('INSERT INTO _migration_steps')) recordedSteps.push(params);
            return [[]];
        },
        async beginTransaction() { began += 1; },
        async commit() { committed += 1; },
        async rollback() {},
        release() { released = true; }
    };
    pool.getConnection = async () => connection;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    t.after(() => {
        pool.getConnection = originalGetConnection;
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    });
    await runMigrations();
    assert.equal(released, true);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO _migrations')));
    assert.ok(calls.some((call) => call.sql.includes('RELEASE_LOCK')));
    assert.equal(began, committed);
    const target = (await getMigrationManifest()).find(({ name }) => name === '004_add_products_barcode.sql');
    const targetStatement = migrationInternals.splitStatements(target.content)[0];
    assert.ok(recordedSteps.some(([name, index, statementChecksum]) => (
        name === target.name
        && index === 0
        && statementChecksum === migrationInternals.checksum(targetStatement)
    )));

    const sequenceTarget = (await getMigrationManifest()).find(({ name }) => name === '002_create_document_sequences.sql');
    const sequenceStatement = migrationInternals.splitStatements(sequenceTarget.content)[0];
    const sequenceQuery = calls.find(({ sql }) => sql.startsWith('CREATE TABLE IF NOT EXISTS document_sequences'));
    assert.ok(sequenceQuery);
    assert.match(sequenceQuery.sql, /`last_value` BIGINT NOT NULL DEFAULT 0/);
    assert.ok(recordedSteps.some(([name, index, statementChecksum]) => (
        name === sequenceTarget.name
        && index === 0
        && statementChecksum === migrationInternals.checksum(sequenceStatement)
    )));

    const optionTarget = (await getMigrationManifest()).find(({ name }) => name === '039_create_product_catalog_options.sql');
    const optionEntries = migrationInternals.splitStatements(optionTarget.content)
        .map((statement, index) => ({ statement, index }))
        .filter(({ statement }) => statement.startsWith('INSERT INTO product_catalog_options'));
    const optionQueries = calls.filter(({ sql }) => sql.startsWith('INSERT INTO product_catalog_options'));
    assert.equal(optionQueries.length, 4);
    assert.equal(optionQueries.filter(({ sql }) => sql.includes('LOWER(MIN')).length, 4);
    assert.equal(optionQueries.filter(({ sql }) => sql.includes('GROUP BY LOWER')).length, 4);
    for (const { statement, index } of optionEntries) {
        assert.ok(recordedSteps.some(([name, statementIndex, statementChecksum]) => (
            name === optionTarget.name
            && statementIndex === index
            && statementChecksum === migrationInternals.checksum(statement)
        )));
    }
});

test('runMigrations rejects lock contention and still releases the connection', async (t) => {
    const originalGetConnection = pool.getConnection;
    const originalError = console.error;
    let released = false;
    pool.getConnection = async () => ({
        query: async () => [[{ acquired: 0 }]],
        release: () => { released = true; }
    });
    console.error = () => {};
    t.after(() => {
        pool.getConnection = originalGetConnection;
        console.error = originalError;
    });
    await assert.rejects(() => runMigrations(), /Could not acquire/);
    assert.equal(released, true);
});

test('runMigrations updates legacy null checksums and accepts the explicitly supported historical checksum', async (t) => {
    const manifest = await getMigrationManifest();
    const originalGetConnection = pool.getConnection;
    const updates = [];
    let releasedLock = false;
    silenceMigrationLogs(t);

    const executedRows = manifest.map(({ name, checksum }, index) => ({
        name,
        checksum: name === '028_add_core_referential_integrity.sql'
            ? '702573c87363580f9d6e21199125c9c1b0570bfe099a69ca4bd4e0f56bc28d52'
            : index === 0 ? null : checksum,
    }));
    pool.getConnection = async () => ({
        async query(sql, params) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') return [executedRows];
            if (statement.startsWith('UPDATE _migrations SET checksum')) updates.push(params);
            if (statement.includes('RELEASE_LOCK')) releasedLock = true;
            return [[]];
        },
        release() {},
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await runMigrations();
    assert.deepEqual(updates, [[manifest[0].checksum, manifest[0].name]]);
    assert.equal(releasedLock, true);
});

test('runMigrations fails fast when an executed migration was modified', async (t) => {
    const manifest = await getMigrationManifest();
    const originalGetConnection = pool.getConnection;
    let released = false;
    silenceMigrationLogs(t);
    pool.getConnection = async () => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [[{ name: manifest[0].name, checksum: 'invalid-checksum' }]];
            }
            return [[]];
        },
        release() { released = true; },
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await assert.rejects(() => runMigrations(), /changed after execution/);
    assert.equal(released, true);
});

test('runMigrations detects a changed statement after partial execution', async (t) => {
    const manifest = await getMigrationManifest();
    const originalGetConnection = pool.getConnection;
    silenceMigrationLogs(t);
    pool.getConnection = async () => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [manifest.slice(1).map(({ name, checksum }) => ({ name, checksum }))];
            }
            if (statement.includes('SELECT statement_index')) {
                return [[{ statement_index: 0, statement_checksum: 'outdated-step' }]];
            }
            return [[]];
        },
        release() {},
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await assert.rejects(() => runMigrations(), /Statement 1 .* changed after partial execution/);
});

test('runMigrations records a recoverable already-applied DDL statement', async (t) => {
    const manifest = await getMigrationManifest();
    const target = manifest.find(({ name }) => name === '003_add_user_token_version.sql');
    const originalGetConnection = pool.getConnection;
    const recordedSteps = [];
    silenceMigrationLogs(t);
    pool.getConnection = async () => ({
        async query(sql, params) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [manifest.filter(({ name }) => name !== target.name).map(({ name, checksum }) => ({ name, checksum }))];
            }
            if (statement.includes('SELECT statement_index')) return [[]];
            if (statement.trim().startsWith('ALTER TABLE users')) {
                const error = new Error('duplicate column');
                error.code = 'ER_DUP_FIELDNAME';
                throw error;
            }
            if (statement.startsWith('INSERT INTO _migration_steps')) recordedSteps.push(params);
            return [[]];
        },
        release() {},
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await runMigrations();
    assert.equal(recordedSteps.length, 1);
    assert.equal(recordedSteps[0][0], target.name);
});

test('runMigrations does not recover a transformed ALTER failure as duplicate DDL', async (t) => {
    const manifest = await getMigrationManifest();
    const target = manifest.find(({ name }) => name === '004_add_products_barcode.sql');
    const originalGetConnection = pool.getConnection;
    const recordedSteps = [];
    silenceMigrationLogs(t);
    pool.getConnection = async () => ({
        async query(sql, params) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [manifest.filter(({ name }) => name !== target.name).map(({ name, checksum }) => ({ name, checksum }))];
            }
            if (statement.includes('SELECT statement_index')) return [[]];
            if (statement.includes('INFORMATION_SCHEMA.COLUMNS')) return [[]];
            if (statement.trim().startsWith('ALTER TABLE products ADD COLUMN barcode')) {
                const error = new Error('duplicate column after metadata check');
                error.code = 'ER_DUP_FIELDNAME';
                throw error;
            }
            if (statement.startsWith('INSERT INTO _migration_steps')) recordedSteps.push(params);
            return [[]];
        },
        release() {},
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await assert.rejects(() => runMigrations(), /duplicate column after metadata check/);
    assert.equal(recordedSteps.length, 0);
});

test('runMigrations rolls back failed transactional statements and tolerates lock-release errors', async (t) => {
    const manifest = await getMigrationManifest();
    const target = manifest.find(({ name }) => name === '040_customer_advances_account.sql');
    const originalGetConnection = pool.getConnection;
    let rolledBack = 0;
    let released = 0;
    silenceMigrationLogs(t);

    pool.getConnection = async () => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [manifest.filter(({ name }) => name !== target.name).map(({ name, checksum }) => ({ name, checksum }))];
            }
            if (statement.includes('SELECT statement_index')) return [[]];
            if (statement.trim().startsWith('INSERT IGNORE INTO chart_of_accounts')) throw new Error('write failed');
            return [[]];
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() { rolledBack += 1; },
        release() { released += 1; },
    });
    await assert.rejects(() => runMigrations(), /write failed/);
    assert.equal(rolledBack, 1);
    assert.equal(released, 1);

    pool.getConnection = async () => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') {
                return [manifest.map(({ name, checksum }) => ({ name, checksum }))];
            }
            if (statement.includes('RELEASE_LOCK')) throw new Error('connection closed');
            return [[]];
        },
        release() { released += 1; },
    });
    t.after(() => { pool.getConnection = originalGetConnection; });

    await runMigrations();
    assert.equal(released, 2);
});

test('a migration recorded with other line endings is the same migration; a real change is not', () => {
    const { checksum, matchesIgnoringLineEndings } = migrationInternals;
    const lf = 'ALTER TABLE t ADD COLUMN a INT NULL;\nALTER TABLE t ADD COLUMN b INT NULL;\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.equal(matchesIgnoringLineEndings(checksum(crlf), lf), true, 'recorded on Windows (CRLF), read as LF');
    assert.equal(matchesIgnoringLineEndings(checksum(lf), crlf), true, 'recorded as LF, read as CRLF');
    assert.equal(matchesIgnoringLineEndings(checksum(lf), lf), true);
    assert.equal(matchesIgnoringLineEndings(checksum(lf), lf.replace('b INT', 'b BIGINT')), false, 'a real change still fails');
});