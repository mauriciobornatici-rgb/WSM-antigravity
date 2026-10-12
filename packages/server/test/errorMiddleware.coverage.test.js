import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import globalErrorHandler from '../middleware/errorMiddleware.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function invoke(err, reqOverrides = {}, handler = globalErrorHandler) {
    const req = { requestId: 'req-1', method: 'POST', path: '/api/x', ...reqOverrides };
    const state = { status: null, body: null };
    const res = {
        status(code) {
            state.status = code;
            return this;
        },
        json(body) {
            state.body = body;
            return this;
        }
    };
    const logged = [];
    const original = console.error;
    console.error = (line) => logged.push(line);
    try {
        handler(err, req, res, () => {});
    } finally {
        console.error = original;
    }
    return { ...state, logged };
}

test('development: exposes message, stack and request id, and honours statusCode/status', () => {
    const err = Object.assign(new Error('Stock insuficiente'), { statusCode: 409, status: 'fail' });
    const { status, body } = invoke(err);
    assert.equal(status, 409);
    assert.equal(body.status, 'fail');
    assert.equal(body.message, 'Stock insuficiente');
    assert.equal(body.request_id, 'req-1');
    assert.equal(body.stack, err.stack);
});

test('development: a plain error defaults to 500/"error" and falls back to a generic message', () => {
    const { status, body } = invoke(new Error('boom'), { requestId: undefined });
    assert.equal(status, 500);
    assert.equal(body.status, 'error');
    assert.equal(body.message, 'boom');
    assert.equal(body.request_id, null);

    const empty = invoke(Object.assign(new Error(''), {}));
    assert.equal(empty.body.message, 'Error interno del servidor');
});

test('always writes a structured error log with request id, route and stack server-side', () => {
    const err = new Error('SQL syntax near SELECT * FROM users');
    const { logged } = invoke(err);
    assert.equal(logged.length, 1);
    const entry = JSON.parse(logged[0]);
    assert.equal(entry.level, 'error');
    assert.equal(entry.request_id, 'req-1');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.path, '/api/x');
    assert.equal(entry.message, err.message);
    assert.equal(entry.stack, err.stack);
    assert.ok(entry.timestamp);
});

test('staging: 5xx hides message, SQL details and stack; 4xx keeps the message but never the stack', () => {
    const script = `
        const { default: handler } = await import(${JSON.stringify(pathToFileURL(path.join(serverDirectory, 'middleware', 'errorMiddleware.js')).href)});
        console.error = () => {};
        const run = (err, req = { requestId: 'rid', method: 'GET', path: '/p' }) => {
            let status; let body;
            handler(err, req, { status(c) { status = c; return this; }, json(b) { body = b; return this; } }, () => {});
            return { status, body };
        };
        const sqlError = Object.assign(new Error("ER_BAD_FIELD_ERROR: Unknown column 'secret' in 'field list'"), { sql: 'SELECT secret FROM users' });
        const clientError = Object.assign(new Error('Cliente invalido'), { statusCode: 422 });
        const explicit500 = Object.assign(new Error('internal detail'), { statusCode: 503 });
        process.stdout.write(JSON.stringify({ server: run(sqlError), client: run(clientError), unavailable: run(explicit500), noId: run(new Error('x'), { method: 'GET', path: '/p' }) }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: serverDirectory,
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_ENV: 'staging',
            ENV_FILE: '.env.example',
            ALLOW_INSECURE_NON_DEV: 'true',
            APP_BASE_URL: 'https://erp.example.test',
            CORS_ORIGINS: 'https://erp.example.test',
            TRUST_PROXY: '1',
            ENCRYPTION_KEY: 'aa'.repeat(32)
        }
    });
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);

    assert.equal(out.server.status, 500);
    assert.equal(out.server.body.message, 'Internal Server Error');
    assert.equal(out.server.body.request_id, 'rid');
    assert.equal('stack' in out.server.body, false);
    assert.equal(JSON.stringify(out.server.body).includes('secret'), false);

    assert.equal(out.client.status, 422);
    assert.equal(out.client.body.message, 'Cliente invalido');
    assert.equal('stack' in out.client.body, false);

    assert.equal(out.unavailable.status, 503);
    assert.equal(out.unavailable.body.message, 'Internal Server Error');
    assert.equal(out.noId.body.request_id, null);
});
