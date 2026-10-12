import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import { initDatabase } from '../config/initDb.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(serverDirectory, 'migrations');
const STRONG_PASSWORD = 'Str0ng!Passw0rd#2026';

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// Every migration is reported as already executed, so runMigrations only does bookkeeping.
function migrationRows() {
    return fs.readdirSync(migrationsDirectory)
        .filter((file) => file.endsWith('.sql'))
        .map((name) => ({
            name,
            checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDirectory, name), 'utf8')).digest('hex')
        }));
}

function installFakeDatabase(t, { admins = [], settings = [], tables = null } = {}) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    const previousPassword = process.env.ADMIN_DEFAULT_PASSWORD;
    const events = [];
    const inserts = [];
    const required = [];

    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => { events.push('release'); },
        async query(sql) {
            const statement = normalizeSql(sql);
            if (statement.startsWith('SELECT GET_LOCK')) {
                events.push('migrations');
                return [[{ acquired: 1 }]];
            }
            if (statement.startsWith('SELECT name, checksum FROM _migrations')) return [migrationRows()];
            if (statement.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ COLUMN_NAME: 'checksum' }]];
            return [[]];
        }
    };
    pool.getConnection = async () => connection;
    pool.query = async (sql, params) => {
        const statement = normalizeSql(sql);
        if (statement.includes('INFORMATION_SCHEMA.TABLES')) {
            required.push(...params[0]);
            const present = tables ?? params[0];
            return [present.map((TABLE_NAME) => ({ TABLE_NAME }))];
        }
        if (statement.startsWith("SELECT id FROM users WHERE role = 'admin'")) return [admins];
        if (statement.startsWith('SELECT id FROM company_settings')) return [settings];
        if (statement.startsWith('INSERT INTO')) {
            inserts.push({ statement, params });
            return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected SQL: ${statement}`);
    };
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
        if (previousPassword === undefined) delete process.env.ADMIN_DEFAULT_PASSWORD;
        else process.env.ADMIN_DEFAULT_PASSWORD = previousPassword;
    });
    return { events, inserts, required };
}

function silenceConsole(t) {
    const originals = { log: console.log, warn: console.warn, error: console.error };
    const errors = [];
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => errors.push(args);
    t.after(() => Object.assign(console, originals));
    return errors;
}

test('migrates, verifies required tables, then seeds the default admin and company settings', async (t) => {
    silenceConsole(t);
    process.env.ADMIN_DEFAULT_PASSWORD = `  ${STRONG_PASSWORD}  `;
    const db = installFakeDatabase(t);

    await initDatabase();

    assert.equal(db.events[0], 'migrations');
    assert.ok(db.required.includes('users') && db.required.includes('order_item_allocations'));
    assert.equal(db.inserts.length, 2);

    const adminInsert = db.inserts[0];
    assert.match(adminInsert.statement, /^INSERT INTO users/);
    const [id, name, email, hash, role] = adminInsert.params;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(name, 'Admin User');
    assert.equal(email, 'admin@sports.store');
    assert.equal(role, 'admin');
    // The trimmed password is stored hashed, never in clear.
    assert.notEqual(hash, STRONG_PASSWORD);
    assert.equal(await bcrypt.compare(STRONG_PASSWORD, hash), true);

    assert.match(db.inserts[1].statement, /^INSERT INTO company_settings/);
});

test('does not touch existing admin or company settings', async (t) => {
    silenceConsole(t);
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    const db = installFakeDatabase(t, { admins: [{ id: 'a1' }], settings: [{ id: 1 }] });

    await initDatabase();

    assert.deepEqual(db.inserts, []);
});

test('fails when no admin exists and ADMIN_DEFAULT_PASSWORD is missing', async (t) => {
    const errors = silenceConsole(t);
    delete process.env.ADMIN_DEFAULT_PASSWORD;
    const db = installFakeDatabase(t);

    await assert.rejects(initDatabase(), /ADMIN_DEFAULT_PASSWORD is required/);
    assert.deepEqual(db.inserts, []);
    assert.equal(errors.some(([label]) => label === 'Database Initialization Error:'), true);
});

test('fails when ADMIN_DEFAULT_PASSWORD is weak and creates nothing', async (t) => {
    silenceConsole(t);
    process.env.ADMIN_DEFAULT_PASSWORD = 'admin123';
    const db = installFakeDatabase(t);

    await assert.rejects(initDatabase(), /ADMIN_DEFAULT_PASSWORD invalida/);
    assert.deepEqual(db.inserts, []);
});

test('fails listing every missing required table, before seeding anything', async (t) => {
    silenceConsole(t);
    process.env.ADMIN_DEFAULT_PASSWORD = STRONG_PASSWORD;
    const db = installFakeDatabase(t, { tables: ['users', 'clients'] });

    await assert.rejects(initDatabase(), (error) => {
        assert.match(error.message, /^Missing required tables after migrations: /);
        assert.ok(error.message.includes('orders'));
        assert.equal(error.message.includes('users,'), false);
        return true;
    });
    assert.deepEqual(db.inserts, []);
});

test('propagates a migration failure without seeding', async (t) => {
    silenceConsole(t);
    process.env.ADMIN_DEFAULT_PASSWORD = STRONG_PASSWORD;
    const db = installFakeDatabase(t);
    pool.getConnection = async () => { throw new Error('connect ECONNREFUSED'); };

    await assert.rejects(initDatabase(), /ECONNREFUSED/);
    assert.deepEqual(db.inserts, []);
});

function runIsolated(envOverrides) {
    // Config is cached per process, so a different DB target needs its own process.
    const script = `
        const poolModule = await import(${JSON.stringify(pathToFileURL(path.join(serverDirectory, 'config', 'db.js')).href)});
        const pool = poolModule.default;
        const touched = [];
        pool.getConnection = async () => { touched.push('getConnection'); throw new Error('must not be reached'); };
        pool.query = async () => { touched.push('query'); throw new Error('must not be reached'); };
        const { initDatabase } = await import(${JSON.stringify(pathToFileURL(path.join(serverDirectory, 'config', 'initDb.js')).href)});
        console.log = () => {}; console.error = () => {};
        let message = null;
        try { await initDatabase(); } catch (error) { message = error.message; }
        process.stdout.write(JSON.stringify({ message, touched }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: serverDirectory,
        encoding: 'utf8',
        env: { ...process.env, ENV_FILE: '.env.example', NODE_ENV: 'development', ...envOverrides }
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('development with a remote DB_HOST refuses to start before running any migration', () => {
    delete process.env.ALLOW_REMOTE_DB;
    const outcome = runIsolated({ DB_HOST: 'prod-db.example.com', ALLOW_REMOTE_DB: '' });
    assert.match(outcome.message, /Refusing to start in development against non-local DB_HOST 'prod-db\.example\.com'/);
    assert.match(outcome.message, /ALLOW_REMOTE_DB=true/);
    // No connection was requested, so no migration could have run.
    assert.deepEqual(outcome.touched, []);
});

test('ALLOW_REMOTE_DB=true is the only opt-in that lets a remote host proceed to migrations', () => {
    const outcome = runIsolated({ DB_HOST: 'prod-db.example.com', ALLOW_REMOTE_DB: 'true' });
    // Past the guard it reaches the (stubbed) connection used by runMigrations.
    assert.deepEqual(outcome.touched, ['getConnection']);
    assert.equal(outcome.message, 'must not be reached');
});
