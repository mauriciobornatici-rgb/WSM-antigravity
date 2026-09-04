import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../index.js';
import { closePool } from '../config/db.js';

test('Observability & Correlation ID Integration Suite', async (t) => {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await closePool();
    });

    await t.test('GET /api/live returns 200 and uptime', async () => {
        const res = await fetch(`${baseUrl}/api/live`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.status, 'ok');
        assert.equal(typeof body.uptime_seconds, 'number');
        assert.ok(body.uptime_seconds >= 0);

        // Header X-Request-Id generated automatically
        const requestId = res.headers.get('x-request-id');
        assert.ok(requestId, 'Expected X-Request-Id header');
        assert.match(
            requestId,
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            'Expected valid UUID for generated X-Request-Id'
        );
    });

    await t.test('Correlation ID header is preserved when supplied by client', async () => {
        const clientRequestId = 'custom-trace-uuid-12345';
        const res = await fetch(`${baseUrl}/api/live`, {
            headers: {
                'x-request-id': clientRequestId
            }
        });

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-request-id'), clientRequestId);
    });

    await t.test('GET /api/health returns database connectivity and runtime metrics', async () => {
        const res = await fetch(`${baseUrl}/api/health`);
        // If DB is reachable it returns 200; if temporarily offline in isolated testing it returns 503
        if (res.status === 200) {
            const body = await res.json();
            assert.equal(body.status, 'ok');
            assert.equal(body.database, 'connected');
            assert.equal(typeof body.db_latency_ms, 'number');
            assert.ok(body.db_latency_ms >= 0);
            assert.equal(typeof body.uptime_seconds, 'number');
            assert.equal(typeof body.memory_rss_mb, 'number');
            assert.equal(typeof body.memory_heap_mb, 'number');
        } else {
            assert.equal(res.status, 503);
            const body = await res.json();
            assert.equal(body.status, 'error');
            assert.equal(body.database, 'disconnected');
        }
    });
});
