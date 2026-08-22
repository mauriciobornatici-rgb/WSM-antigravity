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
    const connection = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement === 'SELECT name, checksum FROM _migrations') return [[]];
            if (statement.includes('SELECT statement_index')) return [[]];
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
