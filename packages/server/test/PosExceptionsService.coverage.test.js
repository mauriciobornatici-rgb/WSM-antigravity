import test from 'node:test';
import assert from 'node:assert/strict';

import defaultService, {
    PosExceptionsService,
    EXCEPTION_TYPES,
    REVIEW_ACTION
} from '../domains/sales/PosExceptionsService.js';

const normalizeSql = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function createDb({ rows = [], connectionQuery } = {}) {
    const queries = [];
    const counts = { begin: 0, commit: 0, rollback: 0, release: 0 };
    const connection = {
        async beginTransaction() { counts.begin += 1; },
        async commit() { counts.commit += 1; },
        async rollback() { counts.rollback += 1; },
        release() { counts.release += 1; },
        async query(sql, params) {
            const entry = { sql: normalizeSql(sql), params };
            connection.calls.push(entry);
            return connectionQuery(entry.sql, params);
        },
        calls: []
    };
    return {
        db: {
            async query(sql, params) {
                queries.push({ sql: normalizeSql(sql), params });
                return [rows];
            },
            async getConnection() { return connection; }
        },
        queries,
        connection,
        counts
    };
}

test('exports the constants and a default singleton service', () => {
    assert.deepEqual(EXCEPTION_TYPES, { PRICE: 'price', STOCK_SHORTAGE: 'stock_shortage', CHANNEL_SHORTAGE: 'channel_stock_shortage' });
    assert.equal(Object.isFrozen(EXCEPTION_TYPES), true);
    assert.equal(REVIEW_ACTION, 'POS_EXCEPTION_REVIEWED');
    assert.ok(defaultService instanceof PosExceptionsService);
});

test('list defaults to pending exceptions (NOT EXISTS review) with limit 100', async () => {
    const { db, queries } = createDb();
    const result = await new PosExceptionsService({ db }).list();
    assert.deepEqual(result, []);
    assert.match(queries[0].sql, /AND NOT EXISTS \(/);
    assert.deepEqual(queries[0].params, [REVIEW_ACTION, REVIEW_ACTION, 100]);
});

test('list with status reviewed requires an existing review', async () => {
    const { db, queries } = createDb();
    await new PosExceptionsService({ db }).list({ status: 'reviewed' });
    assert.match(queries[0].sql, /AND EXISTS \(/);
    assert.equal(queries[0].sql.includes('NOT EXISTS'), false);
});

test('list clamps the limit to 1..500 and falls back to 100 for non-numeric input', async () => {
    const limits = [];
    const { db, queries } = createDb();
    const service = new PosExceptionsService({ db });
    for (const limit of [0, -5, 9999, 'abc', 25, '40']) {
        await service.list({ limit });
        limits.push(queries.at(-1).params[2]);
    }
    // 0 and 'abc' are falsy/NaN so they take the 100 default; negatives clamp to 1.
    assert.deepEqual(limits, [100, 1, 500, 100, 25, 40]);
});

test('list maps rows: type, numeric total, parsed JSON details and review metadata', async () => {
    const createdAt = new Date('2026-03-01T10:00:00Z');
    const reviewedAt = new Date('2026-03-02T10:00:00Z');
    const rows = [
        {
            id: 1, action: 'ORDER_PRICE_OVERRIDE', order_id: 'o1', user_id: 'u1', user_name: 'Ana',
            customer_name: 'Cliente', total_amount: '1500.50', created_at: createdAt,
            new_values: '{"source":"offline_pos","unit_price":10}',
            review: '{"decision":"approved","notes":null}', reviewed_by: 'u9', reviewed_at: reviewedAt
        },
        {
            id: 2, action: 'OFFLINE_SALE_STOCK_SHORTAGE', order_id: 'o2', user_id: 'u2', user_name: null,
            customer_name: null, total_amount: null, created_at: createdAt,
            new_values: { shortages: [{ product_id: 'p1' }] }, review: null
        },
        {
            id: 3, action: 'ORDER_PRICE_OVERRIDE', order_id: 'o3', user_id: 'u3', user_name: 'Eva',
            customer_name: 'X', total_amount: 0, created_at: createdAt,
            new_values: null, review: null
        },
        {
            id: 4, action: 'ORDER_PRICE_OVERRIDE', order_id: 'o4', user_id: 'u4', user_name: 'Eva',
            customer_name: 'X', total_amount: 5, created_at: createdAt,
            new_values: '{not json', review: null
        }
    ];
    const { db } = createDb({ rows });
    const result = await new PosExceptionsService({ db }).list();

    assert.equal(result[0].type, EXCEPTION_TYPES.PRICE);
    assert.equal(result[0].total_amount, 1500.5);
    assert.deepEqual(result[0].details, { source: 'offline_pos', unit_price: 10 });
    assert.deepEqual(result[0].review, { decision: 'approved', notes: null, reviewed_by: 'u9', reviewed_at: reviewedAt });
    assert.equal(result[0].user_name, 'Ana');

    assert.equal(result[1].type, EXCEPTION_TYPES.STOCK_SHORTAGE);
    assert.equal(result[1].total_amount, null);
    assert.deepEqual(result[1].details, { shortages: [{ product_id: 'p1' }] });
    assert.equal(result[1].review, null);

    assert.equal(result[2].total_amount, 0);
    assert.equal(result[2].details, null);
    // Corrupt audit JSON must not break the listing.
    assert.equal(result[3].details, null);
});

test('review writes one audit entry inside the transaction and returns the decision', async () => {
    const auditCalls = [];
    const { db, connection, counts } = createDb({
        connectionQuery: (sql) => {
            if (sql.startsWith('SELECT a.id, a.entity_id FROM audit_logs a')) return [[{ id: 5, entity_id: 'order-5' }]];
            if (sql.startsWith('SELECT id FROM audit_logs')) return [[]];
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    });
    const auditService = { log: async (data, executor) => { auditCalls.push({ data, executor }); } };
    const service = new PosExceptionsService({ db, auditService });

    const result = await service.review(5, { decision: 'approved', notes: 'ok' }, 'manager-1');

    assert.deepEqual(result, { id: 5, decision: 'approved', notes: 'ok' });
    assert.deepEqual(counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.equal(connection.calls[0].sql.endsWith('FOR UPDATE'), true);
    assert.deepEqual(connection.calls[0].params, [5]);
    assert.deepEqual(connection.calls[1].params, [REVIEW_ACTION, '5']);
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].executor, connection);
    assert.deepEqual(auditCalls[0].data, {
        user_id: 'manager-1',
        action: REVIEW_ACTION,
        entity_type: 'audit_log',
        entity_id: '5',
        new_values: { decision: 'approved', notes: 'ok', order_id: 'order-5' }
    });
});

test('review defaults notes to null and coerces a string id in the result', async () => {
    const { db } = createDb({
        connectionQuery: (sql) => (sql.startsWith('SELECT a.id') ? [[{ id: 8, entity_id: 'o' }]] : [[]])
    });
    const auditService = { log: async () => {} };
    const result = await new PosExceptionsService({ db, auditService }).review('8', { decision: 'rejected' }, 'u1');
    assert.deepEqual(result, { id: 8, decision: 'rejected', notes: null });
});

test('review answers 404 POS_EXCEPTION_NOT_FOUND, rolls back and writes no audit entry', async () => {
    let audited = 0;
    const { db, counts } = createDb({ connectionQuery: () => [[]] });
    const service = new PosExceptionsService({ db, auditService: { log: async () => { audited += 1; } } });

    await assert.rejects(
        service.review(99, { decision: 'approved' }, 'u1'),
        (error) => error.statusCode === 404 && error.errorCode === 'POS_EXCEPTION_NOT_FOUND'
    );
    assert.equal(audited, 0);
    assert.deepEqual(counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('review answers 409 POS_EXCEPTION_ALREADY_REVIEWED for a second review and does not double-audit', async () => {
    let audited = 0;
    const { db, counts } = createDb({
        connectionQuery: (sql) => (sql.startsWith('SELECT a.id') ? [[{ id: 5, entity_id: 'o' }]] : [[{ id: 77 }]])
    });
    const service = new PosExceptionsService({ db, auditService: { log: async () => { audited += 1; } } });

    await assert.rejects(
        service.review(5, { decision: 'approved' }, 'u1'),
        (error) => error.statusCode === 409 && error.errorCode === 'POS_EXCEPTION_ALREADY_REVIEWED'
    );
    assert.equal(audited, 0);
    assert.deepEqual(counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('review rolls back and releases when the audit write fails', async () => {
    const failure = new Error('audit unavailable');
    const { db, counts } = createDb({
        connectionQuery: (sql) => (sql.startsWith('SELECT a.id') ? [[{ id: 5, entity_id: 'o' }]] : [[]])
    });
    const service = new PosExceptionsService({ db, auditService: { log: async () => { throw failure; } } });
    await assert.rejects(service.review(5, { decision: 'approved' }, 'u1'), (error) => error === failure);
    assert.deepEqual(counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});
