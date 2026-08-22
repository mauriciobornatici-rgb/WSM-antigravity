import test from 'node:test';
import assert from 'node:assert/strict';

import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('audit log serializes changes and accepts an explicit transactional executor', async () => {
    let call;
    const executor = { query: async (sql, params) => { call = { sql: String(sql), params }; } };
    await auditService.log({
        user_id: 'u', action: 'UPDATE', entity_type: 'product', entity_id: 'p',
        old_values: { stock: 1 }, new_values: { stock: 2 }, ip_address: '127.0.0.1'
    }, executor);
    assert.ok(call.sql.includes('INSERT INTO audit_logs'));
    assert.equal(call.params[4], '{"stock":1}');
    assert.equal(call.params[5], '{"stock":2}');
});

test('audit failures are fatal in a transaction and best-effort on the shared pool', async (t) => {
    const originalError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalError; });
    const failure = new Error('audit unavailable');
    await assert.rejects(() => auditService.log({ action: 'X', entity_type: 'x' }, { query: async () => { throw failure; } }), failure);
    mockPool(t, async () => { throw failure; });
    await auditService.log({ action: 'X', entity_type: 'x' });
});

test('audit queries support filtered pagination, totals and legacy defaults', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params: [...params] });
        if (String(sql).includes('COUNT(*)')) return [[{ total: '15' }]];
        return [[{ id: 'a-1' }]];
    });
    const paged = await auditService.getLogs(
        { entity_type: 'order', entity_id: 'o-1' },
        { includeTotal: true, limit: 10, offset: 5 }
    );
    const legacy = await auditService.getLogs();
    assert.deepEqual(paged, { rows: [{ id: 'a-1' }], total: 15 });
    assert.deepEqual(legacy, [{ id: 'a-1' }]);
    assert.ok(calls.some((call) => call.sql.includes('LIMIT ? OFFSET ?')));
    assert.ok(calls.some((call) => call.sql.includes('LIMIT 100')));
});
