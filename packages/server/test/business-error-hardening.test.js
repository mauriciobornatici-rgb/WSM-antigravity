import test from 'node:test';
import assert from 'node:assert/strict';

import { BusinessError, businessError, isBusinessError, sendBusinessError } from '../utils/businessError.js';
import catchAsync from '../utils/catchAsync.js';
import { creditNotesService } from '../services/warranties.service.js';
import cashRegisterService from '../services/cashRegister.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

function fakeResponse({ headersSent = false } = {}) {
    return {
        headersSent,
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
}

test('only real 4xx business errors are answered with their body', () => {
    const res = fakeResponse();
    assert.equal(sendBusinessError(res, businessError(409, { error: 'last_admin', message: 'm' })), true);
    assert.deepEqual([res.statusCode, res.body], [409, { error: 'last_admin', message: 'm' }]);
    assert.ok(businessError(404, { error: 'x' }) instanceof BusinessError);

    // A library error that happens to carry `responseBody` (e.g. a remote service body) is never echoed.
    const foreign = Object.assign(new Error('remote'), { statusCode: 400, responseBody: { secret: 'remote body' } });
    assert.equal(isBusinessError(foreign), false);
    assert.equal(sendBusinessError(fakeResponse(), foreign), false);
    // A business error must be a client error.
    assert.equal(isBusinessError(new BusinessError(500, { error: 'x' })), false);
});

test('a business error after the response started is left to Express instead of answering twice', () => {
    assert.equal(sendBusinessError(fakeResponse({ headersSent: true }), businessError(404, { error: 'x' })), false);
});

test('catchAsync answers business errors and forwards everything else', async () => {
    const res = fakeResponse();
    const forwarded = [];
    await new Promise((resolve) => {
        catchAsync(async () => { throw businessError(404, { error: 'not_found' }); })({}, res, (err) => forwarded.push(err));
        setImmediate(resolve);
    });
    assert.deepEqual([res.statusCode, res.body, forwarded.length], [404, { error: 'not_found' }, 0]);

    const unexpected = new Error('db down');
    await new Promise((resolve) => {
        catchAsync(async () => { throw unexpected; })({}, fakeResponse(), (err) => { forwarded.push(err); resolve(); });
    });
    assert.deepEqual(forwarded, [unexpected]);
});

test('a manual credit note is not issued when its audit fails (audit inside the transaction)', async (t) => {
    const lifecycle = [];
    const connection = mockPool(t, async (sql) => (String(sql).includes('MAX(CAST') ? [[{ max_seq: 0 }]] : [[]]));
    connection.commit = async () => { lifecycle.push('commit'); };
    connection.rollback = async () => { lifecycle.push('rollback'); };
    const originalLog = auditService.log;
    let auditExecutor;
    auditService.log = async (_entry, executor) => { auditExecutor = executor; throw new Error('audit store unavailable'); };
    t.after(() => { auditService.log = originalLog; });

    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: 'c-1', amount: 100 }, 'u-1', '127.0.0.1'),
        /audit store unavailable/
    );
    assert.equal(auditExecutor, connection, 'the audit runs on the transaction connection');
    assert.deepEqual(lifecycle, ['rollback']);
});

test('reading the open shift never rewrites the balance of a shift that is no longer open', async (t) => {
    const updates = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        if (statement.includes('FROM cash_registers')) return [[{ id: 'r-1', status: 'open', current_shift_id: 's-1' }]];
        if (statement.includes('FROM cash_shifts WHERE id = ? AND status')) return [[{ id: 's-1', status: 'open', opening_balance: 100 }]];
        if (statement.includes('FROM shift_payments')) return [[{ inflow: 50, outflow: 0 }]];
        if (statement.includes('SELECT opening_balance')) return [[{ opening_balance: 100 }]];
        if (statement.startsWith('UPDATE cash_shifts')) updates.push({ statement, params });
        return [[]];
    });

    await cashRegisterService.getOpenShift('r-1');

    assert.equal(updates.length, 1);
    assert.match(updates[0].statement, /WHERE id = \? AND status = "open"/);
    assert.deepEqual(updates[0].params, [150, 's-1']);
});
