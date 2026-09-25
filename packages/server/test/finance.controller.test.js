import test from 'node:test';
import assert from 'node:assert/strict';

import { addShiftPayment, closeShift, openShift } from '../controllers/financeController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import { calculateShiftExpectedBalance } from '../services/cashShift.service.js';

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function runHandler(handler, overrides = {}) {
    const req = {
        params: {},
        query: {},
        body: {},
        headers: {},
        ip: '127.0.0.1',
        ...overrides
    };

    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };

        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    });
}

function createTrackedConnection(queryMock) {
    const calls = [];
    let beginCount = 0;
    let commitCount = 0;
    let rollbackCount = 0;
    let releaseCount = 0;
    const connection = {
        async beginTransaction() {
            beginCount += 1;
        },
        async commit() {
            commitCount += 1;
        },
        async rollback() {
            rollbackCount += 1;
        },
        release() {
            releaseCount += 1;
        },
        async query(sql, params = []) {
            const statement = normalizeSql(sql);
            calls.push({ statement, params });
            return queryMock(statement, params);
        }
    };

    return {
        connection,
        calls,
        counts: () => ({
            begin: beginCount,
            commit: commitCount,
            rollback: rollbackCount,
            release: releaseCount
        })
    };
}

function installPool(t, tracked) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    pool.query = async (sql) => {
        throw new Error(`Unexpected pool SQL: ${normalizeSql(sql)}`);
    };
    pool.getConnection = async () => tracked.connection;
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
    });
}

function installAudit(t, logMock) {
    const previousLog = auditService.log;
    auditService.log = logMock;
    t.after(() => {
        auditService.log = previousLog;
    });
}

function unexpectedSql(statement) {
    throw new Error(`Unexpected SQL: ${statement}`);
}

test('cash-shift expected balance only includes cash movements', async () => {
    const queries = [];
    const connection = {
        async query(sql) {
            const statement = String(sql);
            queries.push(statement);
            if (statement.includes('FROM shift_payments')) {
                return [[{ inflow: 350, outflow: 20 }]];
            }
            if (statement.includes('SELECT opening_balance')) {
                return [[{ opening_balance: 100 }]];
            }
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    };

    const result = await calculateShiftExpectedBalance(connection, 'shift-1');

    assert.equal(result.expected_balance, 430);
    assert.match(queries[0], /payment_method = 'cash'/);
});

test('cash-shift expected balance defaults missing shift and aggregates to zero', async () => {
    const connection = {
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('FROM shift_payments')) return [[]];
            if (statement.includes('SELECT opening_balance')) return [[]];
            return unexpectedSql(normalizeSql(statement));
        }
    };
    assert.deepEqual(await calculateShiftExpectedBalance(connection, 'missing'), {
        opening_balance: 0, inflow: 0, outflow: 0, expected_balance: 0
    });
});

test('openShift rolls back and returns 404 when the register does not exist', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_registers WHERE id = ? FOR UPDATE') return [[]];
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    const response = await runHandler(openShift, {
        params: { id: 'register-missing' },
        body: { opening_balance: 100 }
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'not_found');
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('INSERT') || statement.startsWith('UPDATE')), false);
});

test('openShift rolls back and returns 409 when the register is already open', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_registers WHERE id = ? FOR UPDATE') {
            return [[{ id: 'register-open', status: 'open' }]];
        }
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    const response = await runHandler(openShift, {
        params: { id: 'register-open' },
        body: { opening_balance: 100 }
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'already_open');
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('INSERT') || statement.startsWith('UPDATE')), false);
});

test('openShift inserts the shift, updates the register, audits, and commits', async (t) => {
    let auditCall;
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_registers WHERE id = ? FOR UPDATE') {
            return [[{ id: 'register-1', status: 'closed' }]];
        }
        if (statement.startsWith('INSERT INTO cash_shifts')) return [{ affectedRows: 1 }];
        if (statement === 'UPDATE cash_registers SET status = "open", current_shift_id = ? WHERE id = ?') {
            return [{ affectedRows: 1 }];
        }
        return unexpectedSql(statement);
    });
    installPool(t, tracked);
    installAudit(t, async (data, executor) => {
        auditCall = { data, executor };
    });

    const response = await runHandler(openShift, {
        params: { id: 'register-1' },
        body: { opening_balance: 1250, opened_by: 'operator-1' },
        user: { id: 'user-1' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.match(response.body.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('INSERT INTO cash_shifts')), true);
    assert.deepEqual(
        tracked.calls.find(({ statement }) => statement.startsWith('UPDATE cash_registers'))?.params,
        [response.body.id, 'register-1']
    );
    assert.equal(auditCall.executor, tracked.connection);
    assert.equal(auditCall.data.action, 'OPEN_SHIFT');
    assert.equal(auditCall.data.new_values.opening_balance, 1250);
});

test('closeShift rolls back and returns 404 when the shift does not exist', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_shifts WHERE id = ? FOR UPDATE') return [[]];
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    const response = await runHandler(closeShift, {
        params: { id: 'shift-missing' },
        body: { actual_balance: 100 }
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'not_found');
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('closeShift rolls back and returns 409 when the shift is already closed', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_shifts WHERE id = ? FOR UPDATE') {
            return [[{ id: 'shift-closed', status: 'closed', cash_register_id: 'register-1' }]];
        }
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    const response = await runHandler(closeShift, {
        params: { id: 'shift-closed' },
        body: { actual_balance: 100 }
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'already_closed');
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('UPDATE')), false);
});

test('closeShift calculates the expected balance, records the difference, audits, and commits', async (t) => {
    let auditCall;
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT * FROM cash_shifts WHERE id = ? FOR UPDATE') {
            return [[{
                id: 'shift-1',
                status: 'open',
                cash_register_id: 'register-1',
                expected_balance: 100,
                opening_balance: 100
            }]];
        }
        if (statement.startsWith('SELECT COALESCE(SUM(') && statement.includes('FROM shift_payments')) {
            return [[{ inflow: 50, outflow: 5 }]];
        }
        if (statement === 'SELECT opening_balance FROM cash_shifts WHERE id = ? LIMIT 1') {
            return [[{ opening_balance: 100 }]];
        }
        if (statement.startsWith("UPDATE cash_shifts SET status = 'closed'")) return [{ affectedRows: 1 }];
        if (statement === 'UPDATE cash_registers SET status = "closed", current_shift_id = NULL WHERE id = ?') {
            return [{ affectedRows: 1 }];
        }
        return unexpectedSql(statement);
    });
    installPool(t, tracked);
    installAudit(t, async (data, executor) => {
        auditCall = { data, executor };
    });

    const response = await runHandler(closeShift, {
        params: { id: 'shift-1' },
        body: { actual_balance: 140, notes: 'cierre', closed_by: 'operator-1' },
        user: { id: 'user-1' }
    });

    assert.deepEqual(response, {
        status: 200,
        body: { success: true, expected_balance: 145, actual_balance: 140, difference: -5 }
    });
    const closeUpdate = tracked.calls.find(({ statement }) => statement.startsWith("UPDATE cash_shifts SET status = 'closed'"));
    assert.deepEqual(closeUpdate?.params, ['operator-1', 145, 140, -5, 'cierre', 'shift-1']);
    assert.equal(auditCall.executor, tracked.connection);
    assert.equal(auditCall.data.action, 'CLOSE_SHIFT');
    assert.equal(auditCall.data.new_values.difference, -5);
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('addShiftPayment rolls back and returns 404 when the shift is closed or absent', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1 FOR UPDATE') return [[]];
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    const response = await runHandler(addShiftPayment, {
        params: { id: 'shift-closed' },
        body: { order_id: 'order-1', amount: 50 }
    });

    assert.equal(response.status, 404);
    assert.equal(response.body.error, 'not_found');
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('INSERT INTO shift_payments')), false);
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('addShiftPayment replays an existing order payment without inserting again', async (t) => {
    let auditCalls = 0;
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1 FOR UPDATE') {
            return [[{ id: 'shift-1' }]];
        }
        if (statement.startsWith('SELECT id FROM shift_payments')) return [[{ id: 'payment-existing' }]];
        if (statement.startsWith('SELECT COALESCE(SUM(') && statement.includes('FROM shift_payments')) {
            return [[{ inflow: 40, outflow: 0 }]];
        }
        if (statement === 'SELECT opening_balance FROM cash_shifts WHERE id = ? LIMIT 1') {
            return [[{ opening_balance: 100 }]];
        }
        return unexpectedSql(statement);
    });
    installPool(t, tracked);
    installAudit(t, async () => {
        auditCalls += 1;
    });

    const response = await runHandler(addShiftPayment, {
        params: { id: 'shift-1' },
        body: { order_id: 'order-1', payment_method: 'cash', amount: 40, type: 'sale' }
    });

    assert.deepEqual(response, {
        status: 200,
        body: { id: 'payment-existing', expected_balance: 140, idempotent_replay: true }
    });
    assert.equal(tracked.calls.some(({ statement }) => statement.startsWith('INSERT INTO shift_payments')), false);
    assert.equal(auditCalls, 0);
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('addShiftPayment rolls back and releases when the insert SQL fails', async (t) => {
    const expectedError = new Error('insert failed');
    const tracked = createTrackedConnection((statement) => {
        if (statement === 'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1 FOR UPDATE') {
            return [[{ id: 'shift-1' }]];
        }
        if (statement.startsWith('INSERT INTO shift_payments')) throw expectedError;
        return unexpectedSql(statement);
    });
    installPool(t, tracked);

    await assert.rejects(
        runHandler(addShiftPayment, {
            params: { id: 'shift-1' },
            body: { amount: 40 }
        }),
        (error) => error === expectedError
    );
    assert.deepEqual(tracked.counts(), { begin: 1, commit: 0, rollback: 1, release: 1 });
});
