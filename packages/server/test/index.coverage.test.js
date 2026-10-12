import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The server binds env.port at import time, so reserve a free port before importing it.
const freePort = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});
process.env.PORT = String(freePort);

const { app, startServer, shutdown } = await import('../index.js');
const { default: pool } = await import('../config/db.js');
const { getEnvConfig } = await import('../config/env.js');
const { default: tiendaNubeService } = await import('../services/tiendanube.service.js');
const { default: salesService } = await import('../services/sales.service.js');

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(serverDirectory, 'migrations');

function captureConsole(t, methods = ['log']) {
    const originals = {};
    const lines = {};
    for (const method of methods) {
        originals[method] = console[method];
        lines[method] = [];
        console[method] = (...args) => lines[method].push(args);
    }
    t.after(() => Object.assign(console, originals));
    return lines;
}

async function withServer(t) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

function stubPool(t, { query, getConnection } = {}) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    if (query) pool.query = query;
    if (getConnection) pool.getConnection = getConnection;
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
    });
}

test('HTTP surface without a database', async (t) => {
    const base = await withServer(t);

    await t.test('GET /api/health answers 200 with metrics when the ping succeeds', async (st) => {
        stubPool(st, { query: async () => [[{ 1: 1 }]] });
        const res = await fetch(`${base}/api/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(body.database, 'connected');
        assert.ok(body.db_latency_ms >= 0);
        assert.ok(body.memory_rss_mb > 0);
        assert.ok(body.memory_heap_mb > 0);
    });

    await t.test('GET /api/health answers 503 (and, in development, the reason) when the DB fails', async (st) => {
        stubPool(st, { query: async () => { throw new Error('ECONNREFUSED probe'); } });
        const res = await fetch(`${base}/api/health`);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { status: 'error', database: 'disconnected', error: 'ECONNREFUSED probe' });
    });

    await t.test('GET /api/health answers 503 within the timeout when the DB hangs', async (st) => {
        stubPool(st, { query: () => new Promise(() => {}) });
        const startedAt = Date.now();
        const res = await fetch(`${base}/api/health`);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).error, 'database ping timed out');
        assert.ok(Date.now() - startedAt < 5000);
    });

    await t.test('GET /api/routes lists registered routes in development', async () => {
        const res = await fetch(`${base}/api/routes`);
        assert.equal(res.status, 200);
        const routes = await res.json();
        assert.ok(routes.includes('GET /api/live'));
        assert.ok(routes.includes('POST /api/login'));
    });

    await t.test('protected routes reject requests without a session cookie', async () => {
        for (const url of ['/api/users', '/api/session', '/api/orders', '/api/accounting/accounts', '/api/does-not-exist']) {
            const res = await fetch(`${base}${url}`);
            assert.equal(res.status, 401, url);
        }
    });

    await t.test('POST /api/login rejects an invalid body with 400 validation_error before touching the DB', async (st) => {
        stubPool(st, { query: async () => { throw new Error('DB must not be queried'); } });
        const res = await fetch(`${base}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'nope', password: '' })
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'validation_error');
        assert.ok(body.details.length >= 1);
    });

    await t.test('malformed JSON is answered by the global error handler with a 400', async (st) => {
        captureConsole(st, ['error']);
        const res = await fetch(`${base}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-request-id': 'trace-abc' },
            body: '{"email":'
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(typeof body.message, 'string');
        assert.equal('stack' in body, true); // development only
    });

    await t.test('bodies over the 10kb default are rejected with 413 on regular routes', async (st) => {
        captureConsole(st, ['error']);
        const res = await fetch(`${base}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(20 * 1024) })
        });
        assert.equal(res.status, 413);
    });

    await t.test('the image-upload path uses the larger parser (reaches auth, not 413)', async () => {
        const res = await fetch(`${base}/api/products/image-upload`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: 'x'.repeat(20 * 1024) })
        });
        assert.equal(res.status, 401);
    });

    await t.test('security headers are set and /uploads sends cross-origin resource policy', async () => {
        const live = await fetch(`${base}/api/live`);
        assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(live.headers.get('x-powered-by'), null);

        const uploadsDir = path.join(serverDirectory, 'uploads');
        const created = !fs.existsSync(uploadsDir);
        fs.mkdirSync(uploadsDir, { recursive: true });
        const fileName = `coverage-${crypto.randomUUID()}.txt`;
        fs.writeFileSync(path.join(uploadsDir, fileName), 'hello');
        try {
            const res = await fetch(`${base}/uploads/${fileName}`);
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
            assert.equal(await res.text(), 'hello');
        } finally {
            fs.rmSync(path.join(uploadsDir, fileName), { force: true });
            if (created) fs.rmSync(uploadsDir, { recursive: true, force: true });
        }
    });

    await t.test('CORS only echoes allowed origins and exposes the pagination headers', async () => {
        const [allowedOrigin] = getEnvConfig().corsOrigins;
        const allowed = await fetch(`${base}/api/live`, { headers: { origin: allowedOrigin } });
        assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin);
        assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
        assert.match(allowed.headers.get('access-control-expose-headers'), /X-Request-ID/);

        const denied = await fetch(`${base}/api/live`, { headers: { origin: 'https://evil.example' } });
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });

    await t.test('access log redacts sensitive query parameters', async (st) => {
        const logs = captureConsole(st, ['log']);
        const res = await fetch(`${base}/api/live?token=SUPERSECRET&page=2&api_key=K&password=hunter2`);
        assert.equal(res.status, 200);
        await res.arrayBuffer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const entry = logs.log.map(([line]) => JSON.parse(line)).find((l) => l.path?.startsWith('/api/live?'));
        assert.ok(entry, 'expected an access log entry');
        assert.equal(entry.status, 200);
        assert.equal(entry.path.includes('SUPERSECRET'), false);
        assert.equal(entry.path.includes('hunter2'), false);
        assert.equal(entry.path.includes('api_key=K'), false);
        assert.ok(entry.path.includes('page=2'));
        assert.equal(typeof entry.duration_ms, 'number');
    });
});

test('shutdown without a running server only closes the pool and logs both events', async (t) => {
    const logs = captureConsole(t, ['log']);
    await shutdown('SIGTERM');
    const events = logs.log.map(([line]) => JSON.parse(line).event);
    assert.deepEqual(events, ['shutdown_started', 'shutdown_completed']);
    assert.equal(JSON.parse(logs.log[0][0]).signal, 'SIGTERM');
});

test('startServer exits with code 1 when database initialization fails', async (t) => {
    const logs = captureConsole(t, ['log', 'error']);
    const previousExit = process.exit;
    const exits = [];
    process.exit = (code) => { exits.push(code); };
    t.after(() => { process.exit = previousExit; });
    stubPool(t, { getConnection: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1'); } });

    const result = await startServer();

    assert.equal(result, undefined);
    assert.deepEqual(exits, [1]);
    assert.ok(logs.error.some(([label]) => label === 'Critical Database Initialization Failure:'));
});

test('startServer boots after a successful init, schedules background workers, and shuts down gracefully', async (t) => {
    const logs = captureConsole(t, ['log', 'error']);
    const migrationRows = fs.readdirSync(migrationsDirectory)
        .filter((file) => file.endsWith('.sql'))
        .map((name) => ({
            name,
            checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDirectory, name), 'utf8')).digest('hex')
        }));
    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (statement.includes('FROM _migrations')) return [migrationRows];
            if (statement.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ COLUMN_NAME: 'checksum' }]];
            return [[]];
        }
    };
    stubPool(t, {
        getConnection: async () => connection,
        query: async (sql, params) => {
            const statement = String(sql);
            if (statement.includes('INFORMATION_SCHEMA.TABLES')) return [params[0].map((TABLE_NAME) => ({ TABLE_NAME }))];
            if (statement.includes("role = 'admin'")) return [[{ id: 'admin-1' }]];
            if (statement.includes('FROM company_settings')) return [[{ id: 1 }]];
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    });

    // Capture the worker callbacks instead of waiting minutes for the real timers.
    const timers = [];
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = (fn, ms) => {
        const handle = realSetInterval(() => {}, 1 << 30);
        const unref = handle.unref.bind(handle);
        timers.push({ fn, ms, handle, unrefCalls: 0 });
        handle.unref = () => { timers.at(-1).unrefCalls += 1; return unref(); };
        return handle;
    };
    const workerCalls = [];
    const previousFailed = tiendaNubeService.processFailedSyncs;
    const previousPending = tiendaNubeService.processPendingWebhookEvents;
    let failNext = false;
    tiendaNubeService.processFailedSyncs = async () => {
        workerCalls.push('failed');
        if (failNext) throw new Error('sync boom');
    };
    tiendaNubeService.processPendingWebhookEvents = async (service) => {
        workerCalls.push({ pending: service });
        if (failNext) throw new Error('webhook boom');
    };
    t.after(() => {
        globalThis.setInterval = realSetInterval;
        tiendaNubeService.processFailedSyncs = previousFailed;
        tiendaNubeService.processPendingWebhookEvents = previousPending;
        for (const { handle } of timers) clearInterval(handle);
    });

    const server = await startServer();
    assert.ok(server.listening);
    assert.equal(server.address().port, freePort);

    const res = await fetch(`http://127.0.0.1:${freePort}/api/live`);
    assert.equal(res.status, 200);
    assert.ok(logs.log.some(([line]) => String(line).includes('WSM SportsERP Backend Started')));

    // Workers: failed syncs every 5 min, webhook recovery every minute; both unref'd.
    assert.deepEqual(timers.map((timer) => timer.ms), [5 * 60 * 1000, 60 * 1000]);
    assert.ok(timers.every((timer) => timer.unrefCalls === 1));
    timers[0].fn();
    timers[1].fn();
    assert.equal(workerCalls[0], 'failed');
    assert.equal(workerCalls[1].pending, salesService);

    failNext = true;
    timers[0].fn();
    timers[1].fn();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(logs.error.some(([label]) => label === '[TiendaNube Background Sync] Error:'));
    assert.ok(logs.error.some(([label]) => label === '[TiendaNube Webhook Worker] Error:'));

    // Graceful shutdown stops the workers and the HTTP server.
    const clearedBefore = timers.length;
    await shutdown('SIGINT');
    assert.equal(server.listening, false);
    assert.equal(clearedBefore, 2);
    const events = logs.log.map(([line]) => { try { return JSON.parse(line).event; } catch { return null; } });
    assert.ok(events.includes('shutdown_started'));
    assert.ok(events.includes('shutdown_completed'));
});

test('SIGTERM triggers a graceful shutdown that exits 0; a failing shutdown exits 1', async (t) => {
    const logs = captureConsole(t, ['log', 'error']);
    const previousExit = process.exit;
    const exits = [];
    let notify;
    const exited = () => new Promise((resolve) => { notify = resolve; });
    process.exit = (code) => { exits.push(code); notify?.(); };
    t.after(() => { process.exit = previousExit; });

    // Handlers are registered with once(): the first emit consumes the SIGTERM handler.
    let waiting = exited();
    process.emit('SIGTERM');
    await waiting;
    assert.deepEqual(exits, [0]);

    // Make the second shutdown fail: process.once handler for SIGINT is still registered.
    const { closePool } = await import('../config/db.js');
    assert.equal(typeof closePool, 'function');
    stubPool(t, {});
    waiting = exited();
    // Break shutdown by making console.log throw on the first call (inside shutdown's try chain).
    const realLog = console.log;
    console.log = () => { throw new Error('log sink broken'); };
    try {
        process.emit('SIGINT');
        await waiting;
    } finally {
        console.log = realLog;
    }
    assert.deepEqual(exits, [0, 1]);
    assert.ok(logs.error.some(([label]) => label === 'Graceful shutdown failed:'));
});
