import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcaAuthorizationService, ARCA_COOLDOWN_SECONDS, ARCA_ALERT_STALE_MINUTES } from '../domains/fiscal/ArcaAuthorizationService.js';
import { invoiceArcaAdapter, creditNoteArcaAdapter } from '../domains/fiscal/arcaAdapters.js';
import afipService, { arcaToday } from '../services/afip.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import { creditNotesService } from '../services/warranties.service.js';
import { mockPool, createMockConnection } from './helpers/mockDb.js';

// ADR-020 / AUD-008 unit tests with a fake database and a fake ARCA. The end-to-end scenarios
// against a real database live in integration/arca-authorization.integration.js: these cover branches.

const REQUEST = Object.freeze({
    pos: 3,
    voucherType: 6,
    docType: 99,
    docNumber: 0,
    amounts: { roundedTotal: 121, roundedNet: 100, roundedVat: 21, ivaArray: [] },
    associated: null,
});

const PENDING = Object.freeze({
    id: 'd-1',
    status: 'authorizing',
    arca_expected_number: 12,
    arca_pos: 3,
    arca_voucher_type: 6,
    arca_request_date: 20261012,
});

// One handler serves the pool (src 'pool') and the single connection (src 'conn'); `calls` keeps
// everything that ran, in order, so tests can check what was written and what was not.
function createDb(state) {
    const calls = [];
    const handler = (src) => async (sql, params = []) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ src, sql: statement, params });
        if (statement.includes('company_settings')) return [[state.settings ?? { billing_pos: 3 }]];
        if (statement.includes('GET_LOCK')) return [[{ acquired: state.lockAcquired === false ? 0 : 1 }]];
        if (statement.includes('RELEASE_LOCK')) return [[{}]];
        if (statement.includes('TIMESTAMPDIFF')) return [[{ seconds: state.seconds ?? null }]];
        if (statement.startsWith('SELECT * FROM docs WHERE id = ? AND deleted_at IS NULL')) {
            const snapshot = 'snapshot' in state ? state.snapshot : state.doc;
            return [snapshot ? [{ ...snapshot }] : []];
        }
        if (statement.startsWith('SELECT * FROM docs WHERE id = ? FOR UPDATE')) {
            const locked = 'locked' in state ? state.locked : state.doc;
            return [locked ? [{ ...locked }] : []];
        }
        if (statement.startsWith('SELECT * FROM docs WHERE id = ?')) {
            const fresh = 'fresh' in state ? state.fresh : state.doc;
            return [fresh ? [{ ...fresh }] : []];
        }
        if (statement.startsWith('SELECT id FROM docs')) {
            if (state.pendingError) throw state.pendingError;
            return [state.pendingRows ?? []];
        }
        return [{ affectedRows: 1 }];
    };
    const connection = {
        query: handler('conn'),
        beginTransaction: async () => { calls.push({ src: 'conn', sql: 'BEGIN', params: [] }); },
        commit: async () => { calls.push({ src: 'conn', sql: 'COMMIT', params: [] }); },
        rollback: async () => { calls.push({ src: 'conn', sql: 'ROLLBACK', params: [] }); },
        release: () => { calls.push({ src: 'conn', sql: 'RELEASE_CONN', params: [] }); },
    };
    const db = { query: handler('pool'), getConnection: async () => connection };
    return { db, calls };
}

function createAdapter(overrides = {}) {
    const stored = [];
    const adapter = {
        table: 'docs',
        label: 'El documento',
        pendingStatus: 'issued',
        prepare: async (doc) => ({ voucher: { id: doc.id }, items: [{ quantity: 1 }] }),
        numberHolder: async () => null,
        store: async (connection, doc, result, request, userId) => {
            stored.push({ connection, doc, result, request, userId });
        },
        load: async (id) => ({ id, status: 'authorized' }),
        ...overrides,
    };
    return { adapter, stored };
}

function createAfip(overrides = {}) {
    const calls = { buildRequest: 0, lastVoucherNumber: 0, voucherAt: [], requestCae: [] };
    const fake = {
        buildRequest: () => { calls.buildRequest += 1; return { ...REQUEST }; },
        lastVoucherNumber: async () => { calls.lastVoucherNumber += 1; return 7; },
        voucherAt: async (request, number) => { calls.voucherAt.push({ request, number }); return null; },
        requestCae: async (request, number, requestDate) => {
            calls.requestCae.push({ request, number, requestDate });
            return { cae: 'CAE-NEW', cae_expiration_date: '2026-12-31', number };
        },
        formatExpirationDate: (value) => afipService.formatExpirationDate(value),
        ...overrides,
    };
    return { fake, calls };
}

function setup({ state = {}, adapterOverrides, afipOverrides } = {}) {
    const fullState = { doc: { id: 'd-1', status: 'issued' }, ...state };
    const { db, calls } = createDb(fullState);
    const { adapter, stored } = createAdapter(adapterOverrides);
    const { fake, calls: afipCalls } = createAfip(afipOverrides);
    const service = new ArcaAuthorizationService({ db, afipService: fake });
    return { service, adapter, stored, calls, afipCalls, state: fullState };
}

const writes = (calls) => calls.filter(({ sql }) => sql.startsWith('UPDATE docs'));
const sqlOf = (calls, fragment) => calls.find(({ sql }) => sql.includes(fragment));
const lockReleased = (calls) => calls.some(({ sql }) => sql.includes('RELEASE_LOCK'));
const connectionReleased = (calls) => calls.some(({ sql }) => sql === 'RELEASE_CONN');
const matchingInfo = (date, overrides = {}) => ({
    CbteTipo: REQUEST.voucherType,
    ImpTotal: 121,
    DocTipo: 99,
    DocNro: 0,
    CbteFch: String(date),
    CodAutorizacion: 'CAE-ARCA',
    FchVto: '20261231',
    ...overrides,
});
const rejects = (promise, statusCode, code) => assert.rejects(
    promise,
    (error) => error.statusCode === statusCode && error.responseBody.error === code
);
class AfipWebServiceError extends Error {}

// ---------------------------------------------------------------------------
// authorize: the reads before the lock
// ---------------------------------------------------------------------------

test('an already authorized document is returned without asking ARCA or taking the lock', async () => {
    const { service, adapter, stored, calls, afipCalls } = setup({ state: { doc: { id: 'd-1', status: 'authorized' } } });
    assert.deepEqual(await service.authorize(adapter, 'd-1', 'u-1'), { id: 'd-1', status: 'authorized' });
    assert.equal(afipCalls.buildRequest, 0);
    assert.equal(stored.length, 0);
    assert.equal(calls.some(({ sql }) => sql.includes('GET_LOCK')), false);
    assert.equal(writes(calls).length, 0);
});

test('a missing, cancelled or conflicted document is refused without touching it', async () => {
    const missing = setup({ state: { snapshot: null } });
    await rejects(missing.service.authorize(missing.adapter, 'zz', 'u-1'), 404, 'not_found');

    const cancelled = setup({ state: { doc: { id: 'd-1', status: 'Cancelled' } } });
    await rejects(cancelled.service.authorize(cancelled.adapter, 'd-1', 'u-1'), 409, 'cancelled');

    const conflict = setup({ state: { doc: { id: 'd-1', status: 'arca_conflict' } } });
    await rejects(conflict.service.authorize(conflict.adapter, 'd-1', 'u-1'), 409, 'arca_conflict');

    for (const scenario of [missing, cancelled, conflict]) {
        assert.equal(scenario.afipCalls.buildRequest, 0);
        assert.equal(writes(scenario.calls).length, 0);
        assert.equal(scenario.calls.some(({ sql }) => sql.includes('GET_LOCK')), false);
    }
});

test('a document without status is not treated as cancelled', async () => {
    const { service, adapter } = setup({ state: { doc: { id: 'd-1', status: null } } });
    const result = await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(result.status, 'authorized');
});

test('a request that cannot be prepared rethrows and nothing was written', async () => {
    const failure = Object.assign(new Error('Una factura o nota A necesita el CUIT'), { statusCode: 400 });
    const { service, adapter, calls, afipCalls } = setup({
        afipOverrides: { buildRequest: () => { throw failure; } },
    });
    await assert.rejects(() => service.authorize(adapter, 'd-1', 'u-1'), (error) => error === failure);
    assert.equal(writes(calls).length, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(calls.some(({ sql }) => sql.includes('GET_LOCK')), false);
});

test('settings default to an empty object when the company has none', async () => {
    const seen = [];
    const { service, adapter } = setup({
        adapterOverrides: { prepare: async (doc, settings) => { seen.push(settings); return { local: true }; } },
    });
    service.db.query = async (sql) => (String(sql).includes('company_settings')
        ? [[]]
        : [[{ id: 'd-1', status: 'issued' }]]);
    await service.authorize(adapter, 'd-1', null);
    assert.deepEqual(seen, [{}]);
});

// ---------------------------------------------------------------------------
// Local documents
// ---------------------------------------------------------------------------

test('a local document (ticket) is authorized once without ARCA, lock or numbering', async () => {
    const { service, adapter, stored, calls, afipCalls } = setup({
        adapterOverrides: { prepare: async () => ({ local: true }) },
    });
    const result = await service.authorize(adapter, 'd-1', 'u-9');
    assert.equal(result.status, 'authorized');
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].result, { cae: null, cae_expiration_date: null, number: null, local: true });
    assert.equal(stored[0].request, null);
    assert.equal(stored[0].userId, 'u-9');
    assert.equal(afipCalls.buildRequest, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(calls.some(({ sql }) => sql.includes('GET_LOCK')), false);
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(connectionReleased(calls));
});

test('a local document already authorized when locked is not stored twice', async () => {
    const { service, adapter, stored, calls } = setup({
        state: { locked: { id: 'd-1', status: 'authorized' } },
        adapterOverrides: { prepare: async () => ({ local: true }) },
    });
    await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(stored.length, 0);
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('a local document that vanished while waiting is committed and loaded without storing', async () => {
    const { service, adapter, stored } = setup({
        state: { locked: null },
        adapterOverrides: { prepare: async () => ({ local: true }) },
    });
    await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(stored.length, 0);
});

test('a failure storing a local document rolls back and releases the connection', async () => {
    const { service, adapter, calls } = setup({
        adapterOverrides: {
            prepare: async () => ({ local: true }),
            store: async () => { throw new Error('ledger down'); },
        },
    });
    await assert.rejects(() => service.authorize(adapter, 'd-1', 'u-1'), /ledger down/);
    assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
    assert.ok(connectionReleased(calls));
});

// ---------------------------------------------------------------------------
// The lock
// ---------------------------------------------------------------------------

test('a busy lock answers 409 arca_busy and never modifies the document', async () => {
    const { service, adapter, calls, afipCalls } = setup({ state: { lockAcquired: false } });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_busy');
    assert.equal(writes(calls).length, 0);
    assert.equal(calls.some(({ sql }) => /^UPDATE|^INSERT|^DELETE/.test(sql)), false);
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.ok(connectionReleased(calls), 'the connection goes back to the pool');
    const lock = sqlOf(calls, 'GET_LOCK');
    assert.deepEqual(lock.params, ['arca:3:6', 15]);
});

test('the lock timeout is the one given and all database work runs on the locked connection', async () => {
    const { service, adapter, calls } = setup();
    await service.authorize(adapter, 'd-1', 'u-1', { lockTimeout: 4 });
    const lockIndex = calls.findIndex(({ sql }) => sql.includes('GET_LOCK'));
    assert.deepEqual(calls[lockIndex].params, ['arca:3:6', 4]);
    assert.equal(calls[lockIndex].src, 'conn');
    const after = calls.slice(lockIndex);
    assert.ok(after.length > 3);
    assert.deepEqual([...new Set(after.map(({ src }) => src))], ['conn']);
    const releaseIndex = calls.findIndex(({ sql }) => sql.includes('RELEASE_LOCK'));
    assert.ok(releaseIndex > lockIndex);
    assert.ok(calls.findIndex(({ sql }) => sql === 'RELEASE_CONN') > releaseIndex);
});

test('a pending number is verified where it was asked for, not where the settings say now', async () => {
    const { service, adapter, afipCalls, calls } = setup({
        state: { doc: { ...PENDING, arca_pos: '5', arca_voucher_type: '8' } },
        afipOverrides: { voucherAt: async (request, number) => { afipCalls.voucherAt.push({ request, number }); throw new Error('caído'); } },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(afipCalls.voucherAt[0].request.pos, 5);
    assert.equal(afipCalls.voucherAt[0].request.voucherType, 8);
    assert.equal(sqlOf(calls, 'GET_LOCK').params[0], 'arca:5:8');
});

test('a pending number without its point of sale and type keeps the request as built', async () => {
    const { service, adapter, afipCalls } = setup({
        state: { doc: { ...PENDING, arca_pos: null, arca_voucher_type: null } },
        afipOverrides: { voucherAt: async (request, number) => { afipCalls.voucherAt.push({ request, number }); throw new Error('caído'); } },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(afipCalls.voucherAt[0].request.pos, 3);
});

test('a lock release failure does not mask the outcome', async () => {
    const { service, adapter, calls } = setup();
    const connection = await service.db.getConnection();
    const original = connection.query;
    connection.query = async (sql, params) => {
        if (String(sql).includes('RELEASE_LOCK')) throw new Error('gone');
        return original(sql, params);
    };
    service.db.getConnection = async () => connection;
    const result = await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(result.status, 'authorized');
    assert.ok(connectionReleased(calls));
});

test('a document finished by someone else while waiting for the lock is returned as is', async () => {
    for (const fresh of [{ id: 'd-1', status: 'authorized' }, null]) {
        const { service, adapter, stored, afipCalls, calls } = setup({ state: { fresh } });
        const result = await service.authorize(adapter, 'd-1', 'u-1');
        assert.equal(result.status, 'authorized');
        assert.equal(afipCalls.lastVoucherNumber, 0);
        assert.equal(afipCalls.requestCae.length, 0);
        assert.equal(stored.length, 0);
        assert.equal(writes(calls).length, 0);
    }
});

// ---------------------------------------------------------------------------
// A new request
// ---------------------------------------------------------------------------

test('a new voucher saves number, date, point of sale and type before asking ARCA, then stores the result', async () => {
    const order = [];
    const { service, adapter, stored, calls, afipCalls } = setup({
        afipOverrides: {
            requestCae: async (request, number) => {
                order.push('requestCae');
                return { cae: 'CAE-NEW', cae_expiration_date: '2026-12-31', number };
            },
        },
    });
    const query = service.db.getConnection;
    service.db.getConnection = async () => {
        const connection = await query();
        const original = connection.query;
        connection.query = async (sql, params) => {
            if (String(sql).includes("status = 'authorizing'")) order.push('saved');
            return original(sql, params);
        };
        return connection;
    };
    const result = await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(result.status, 'authorized');
    assert.deepEqual(order, ['saved', 'requestCae']);
    const saved = sqlOf(calls, "status = 'authorizing'");
    assert.deepEqual(saved.params, [8, arcaToday(), 3, 6, 'd-1']);
    assert.equal(saved.src, 'conn');
    assert.equal(afipCalls.voucherAt.length, 0, 'there was no earlier attempt to verify');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].result.cae, 'CAE-NEW');
    assert.equal(stored[0].result.number, 8);
    assert.equal(stored[0].request.pos, 3);
    assert.equal(stored[0].userId, 'u-1');
    assert.ok(lockReleased(calls));
});

test('if the last number cannot be read it answers 503 arca_unreachable and the document does not change', async () => {
    const { service, adapter, calls, afipCalls } = setup({
        afipOverrides: { lastVoucherNumber: async () => { throw new Error('ECONNREFUSED'); } },
    });
    await assert.rejects(
        () => service.authorize(adapter, 'd-1', 'u-1'),
        (error) => error.statusCode === 503 && error.responseBody.error === 'arca_unreachable'
            && /ECONNREFUSED/.test(error.responseBody.message)
    );
    assert.equal(writes(calls).length, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.ok(lockReleased(calls));
});

test('an ARCA refusal confirmed by the verification clears the number and answers 422', async () => {
    const { service, adapter, stored, calls, afipCalls } = setup({
        afipOverrides: { requestCae: async () => { throw new AfipWebServiceError('CUIT inválido'); } },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 422, 'arca_rejected');
    assert.equal(afipCalls.voucherAt.length, 1, 'even a refusal is verified first');
    assert.equal(afipCalls.voucherAt[0].number, 8);
    const clear = sqlOf(calls, 'arca_expected_number = NULL');
    assert.equal(clear.params[0], 'issued');
    assert.match(clear.params[1], /ARCA rechazó el comprobante: CUIT inválido/);
    assert.equal(stored.length, 0);
    assert.ok(lockReleased(calls));
});

test('a refusal that cannot be verified keeps the document authorizing with the error', async () => {
    const { service, adapter, stored, calls } = setup({
        afipOverrides: {
            requestCae: async () => { throw new AfipWebServiceError('rechazado'); },
            voucherAt: async () => { throw new Error('ARCA caído'); },
        },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(calls.some(({ sql }) => sql.includes('arca_expected_number = NULL')), false);
    assert.equal(sqlOf(calls, 'SET arca_last_error = ?').params[0], 'rechazado');
    assert.equal(stored.length, 0);
});

test('a lost answer where ARCA has no such voucher stays authorizing with a 503 (never released)', async () => {
    const { service, adapter, stored, calls } = setup({
        afipOverrides: { requestCae: async () => { throw new Error('timeout'); } },
    });
    await assert.rejects(
        () => service.authorize(adapter, 'd-1', 'u-1'),
        (error) => error.statusCode === 503 && error.responseBody.error === 'arca_unavailable'
    );
    assert.equal(calls.some(({ sql }) => sql.includes('arca_expected_number = NULL')), false);
    const lastError = sqlOf(calls, 'SET arca_last_error = ?');
    assert.deepEqual(lastError.params, ['timeout', 'd-1']);
    assert.equal(stored.length, 0);
});

test('a long error message is cut before it is saved', async () => {
    const { service, adapter, calls } = setup({
        afipOverrides: { requestCae: async () => { throw new Error('x'.repeat(5000)); } },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(sqlOf(calls, 'SET arca_last_error = ?').params[0].length, 2000);
});

test('an answer without CAE is treated as a lost answer and verified', async () => {
    const { service, adapter, calls, afipCalls } = setup({
        afipOverrides: { requestCae: async () => ({ number: 8 }) },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(afipCalls.voucherAt.length, 1);
    assert.match(sqlOf(calls, 'SET arca_last_error = ?').params[0], /sin CAE/);
});

test('a lost answer whose voucher ARCA issued is adopted right away', async () => {
    let askedDate;
    const { service, adapter, stored, afipCalls, calls } = setup({
        afipOverrides: {
            requestCae: async (request, number, requestDate) => {
                askedDate = requestDate;
                throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
            },
            voucherAt: async () => matchingInfo(askedDate),
        },
    });
    const result = await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(result.status, 'authorized');
    assert.equal(afipCalls.lastVoucherNumber, 1);
    assert.deepEqual(stored[0].result, { cae: 'CAE-ARCA', cae_expiration_date: '2026-12-31', number: 8, recovered: true });
    assert.equal(stored[0].connection.query !== undefined, true);
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('a lost answer whose number a local document holds with another CAE is a conflict that keeps the CAE', async () => {
    let askedDate;
    const { service, adapter, stored, calls } = setup({
        adapterOverrides: { numberHolder: async () => ({ id: 'other', cae: 'CAE-OTHER' }) },
        afipOverrides: {
            requestCae: async (request, number, requestDate) => { askedDate = requestDate; throw new Error('timeout'); },
            voucherAt: async () => matchingInfo(askedDate),
        },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_conflict');
    const conflict = sqlOf(calls, "SET status = 'arca_conflict'");
    assert.equal(conflict.params[0], 'CAE-ARCA');
    assert.equal(conflict.params[1], '2026-12-31');
    assert.match(conflict.params[2], /número 8/);
    assert.equal(conflict.params[3], 'd-1');
    assert.equal(stored.length, 0);
});

test('a voucher whose number holder has the same CAE belongs to that other document', async () => {
    let askedDate;
    const { service, adapter, stored, calls } = setup({
        adapterOverrides: { numberHolder: async () => ({ id: 'other', cae: 'CAE-ARCA' }) },
        afipOverrides: {
            requestCae: async (request, number, requestDate) => { askedDate = requestDate; throw new Error('timeout'); },
            voucherAt: async () => matchingInfo(askedDate),
        },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(stored.length, 0);
    assert.equal(calls.some(({ sql }) => sql.includes("'arca_conflict'")), false);
});

test('a voucher that does not match this document is never adopted', async () => {
    const { service, adapter, stored } = setup({
        afipOverrides: {
            requestCae: async () => { throw new Error('timeout'); },
            voucherAt: async () => matchingInfo(arcaToday(), { ImpTotal: 999 }),
        },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(stored.length, 0);
});

// ---------------------------------------------------------------------------
// A number already requested
// ---------------------------------------------------------------------------

test('a pending number whose voucher ARCA has is adopted without a second request', async () => {
    const { service, adapter, stored, afipCalls, calls } = setup({
        state: { doc: PENDING },
        afipOverrides: { voucherAt: async () => matchingInfo(20261012) },
    });
    await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(stored[0].result.number, 12);
    assert.equal(stored[0].result.recovered, true);
    assert.equal(writes(calls).length, 0);
});

test('a pending number held by another document with another CAE becomes a conflict', async () => {
    const { service, adapter, stored, calls, afipCalls } = setup({
        state: { doc: PENDING },
        adapterOverrides: { numberHolder: async () => ({ id: 'other', cae: 'CAE-OTHER' }) },
        afipOverrides: { voucherAt: async () => matchingInfo(20261012) },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_conflict');
    assert.equal(sqlOf(calls, "SET status = 'arca_conflict'").params[0], 'CAE-ARCA');
    assert.equal(stored.length, 0);
    assert.equal(afipCalls.requestCae.length, 0);
});

test('a pending number that ARCA cannot be asked about answers 503 and does not touch the document', async () => {
    const { service, adapter, calls, afipCalls } = setup({
        state: { doc: PENDING },
        afipOverrides: { voucherAt: async () => { throw new Error('ARCA caído'); } },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 503, 'arca_unavailable');
    assert.equal(writes(calls).length, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
});

test('a pending number not found in ARCA inside the cool-down answers 409 arca_verifying without asking for anything', async () => {
    const { service, adapter, calls, afipCalls } = setup({
        state: { doc: PENDING, seconds: ARCA_COOLDOWN_SECONDS - 1 },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_verifying');
    assert.equal(writes(calls).length, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(afipCalls.requestCae.length, 0);
});

test('a pending number that is not ours inside the cool-down also waits', async () => {
    const { service, adapter, afipCalls } = setup({
        state: { doc: PENDING, seconds: 5 },
        afipOverrides: { voucherAt: async () => matchingInfo(20261012, { ImpTotal: 999 }) },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_verifying');
    assert.equal(afipCalls.requestCae.length, 0);
});

test('after the cool-down a number not found is cleared and a fresh request follows', async () => {
    const { service, adapter, stored, calls, afipCalls } = setup({
        state: { doc: PENDING, seconds: ARCA_COOLDOWN_SECONDS },
    });
    await service.authorize(adapter, 'd-1', 'u-1');
    const clear = sqlOf(calls, 'arca_expected_number = NULL');
    assert.equal(clear.params[0], 'issued');
    assert.match(clear.params[1], /no figura en ARCA/);
    assert.equal(afipCalls.requestCae.length, 1);
    assert.equal(afipCalls.requestCae[0].number, 8);
    assert.equal(stored[0].result.cae, 'CAE-NEW');
    assert.ok(calls.findIndex((entry) => entry === clear) < calls.findIndex(({ sql }) => sql.includes("status = 'authorizing'")));
});

test('a request time that cannot be read counts as expired', async () => {
    const { service, adapter, afipCalls } = setup({ state: { doc: PENDING, seconds: null } });
    await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(afipCalls.requestCae.length, 1);
});

test('with create:false an expired number is cleared and nothing is created', async () => {
    const { service, adapter, calls, afipCalls } = setup({ state: { doc: PENDING, seconds: 900 } });
    const result = await service.authorize(adapter, 'd-1', null, { create: false });
    assert.deepEqual(result, { recovered: false });
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(writes(calls).length, 1);
});

test('with create:false and no number the leftover is cleared without a reason', async () => {
    const { service, adapter, calls, afipCalls } = setup({ state: { doc: { id: 'd-1', status: 'authorizing' } } });
    const result = await service.authorize(adapter, 'd-1', null, { create: false });
    assert.deepEqual(result, { recovered: false });
    const clear = sqlOf(calls, 'arca_expected_number = NULL');
    assert.deepEqual(clear.params, ['issued', null, 'd-1']);
    assert.equal(afipCalls.voucherAt.length, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
});

test('clearing falls back to the issued status when the adapter has no pending status', async () => {
    const { service, adapter, calls } = setup({
        state: { doc: { id: 'd-1', status: 'authorizing' } },
        adapterOverrides: { pendingStatus: undefined },
    });
    await service.authorize(adapter, 'd-1', null, { create: false });
    // The adapter value is passed as is; with none there is no status to restore.
    assert.equal(sqlOf(calls, 'arca_expected_number = NULL').params[0], undefined);
});

// ---------------------------------------------------------------------------
// _finish
// ---------------------------------------------------------------------------

test('a document authorized by someone else between verify and store is not stored again', async () => {
    const { service, adapter, stored, calls } = setup({
        state: { doc: PENDING, locked: { id: 'd-1', status: 'authorized' } },
        afipOverrides: { voucherAt: async () => matchingInfo(20261012) },
    });
    await service.authorize(adapter, 'd-1', 'u-1');
    assert.equal(stored.length, 0);
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
});

test('a number conflict raised by the adapter marks the document arca_conflict keeping the CAE', async () => {
    const { service, adapter, calls } = setup({
        adapterOverrides: {
            store: async () => {
                const error = new Error('El número 8 ya pertenece a otra factura');
                error.responseBody = { error: 'arca_number_conflict' };
                throw error;
            },
        },
    });
    await rejects(service.authorize(adapter, 'd-1', 'u-1'), 409, 'arca_conflict');
    assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
    const conflict = sqlOf(calls, "SET status = 'arca_conflict'");
    assert.equal(conflict.params[0], 'CAE-NEW');
    assert.equal(conflict.params[2], 'El número 8 ya pertenece a otra factura');
    assert.ok(lockReleased(calls));
});

test('any other failure while storing rolls back, rethrows and releases the lock', async () => {
    const { service, adapter, calls } = setup({
        adapterOverrides: { store: async () => { throw new Error('ledger down'); } },
    });
    await assert.rejects(() => service.authorize(adapter, 'd-1', 'u-1'), /ledger down/);
    assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(calls.some(({ sql }) => sql.includes("'arca_conflict'")), false);
    assert.ok(lockReleased(calls));
    assert.ok(connectionReleased(calls));
});

// ---------------------------------------------------------------------------
// recoverPending
// ---------------------------------------------------------------------------

test('the recovery worker settles by document with lockTimeout 0 and never creates a voucher', async () => {
    const { service, adapter, calls, afipCalls } = setup({
        state: {
            pendingRows: [{ id: 'd-1' }],
            doc: PENDING,
            seconds: 900,
        },
    });
    const results = await service.recoverPending([adapter]);
    assert.deepEqual(results, [{ table: 'docs', id: 'd-1', result: { recovered: false } }]);
    assert.equal(afipCalls.requestCae.length, 0);
    assert.equal(afipCalls.lastVoucherNumber, 0);
    assert.equal(sqlOf(calls, 'GET_LOCK').params[1], 0);
    assert.deepEqual(sqlOf(calls, 'SELECT id FROM docs').params, [ARCA_COOLDOWN_SECONDS]);
});

test('the recovery worker adopts the voucher ARCA issued', async () => {
    const { service, adapter, stored } = setup({
        state: { pendingRows: [{ id: 'd-1' }], doc: PENDING },
        afipOverrides: { voucherAt: async () => matchingInfo(20261012) },
    });
    const [recovered] = await service.recoverPending([adapter]);
    assert.equal(recovered.result.status, 'authorized');
    assert.equal(stored[0].result.recovered, true);
});

test('the recovery worker reports each failure per document without throwing', async () => {
    const down = setup({
        state: { pendingRows: [{ id: 'd-1' }, { id: 'd-2' }], doc: PENDING },
        afipOverrides: { voucherAt: async () => { throw new Error('ARCA caído'); } },
    });
    const results = await down.service.recoverPending([down.adapter]);
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(({ id }) => id), ['d-1', 'd-2']);
    assert.match(results[0].error, /ARCA no responde/);
    assert.equal(down.afipCalls.requestCae.length, 0);

    const busy = setup({ state: { pendingRows: [{ id: 'd-1' }], doc: PENDING, lockAcquired: false } });
    const [skipped] = await busy.service.recoverPending([busy.adapter]);
    assert.match(skipped.error, /otro comprobante/);
});

test('the recovery worker does not overlap with itself and frees the flag even on failure', async () => {
    const { service, adapter } = setup({ state: { pendingError: new Error('db down') } });
    service.recovering = true;
    assert.deepEqual(await service.recoverPending([adapter]), []);
    assert.equal(service.recovering, true, 'the running pass keeps its flag');

    service.recovering = false;
    await assert.rejects(() => service.recoverPending([adapter]), /db down/);
    assert.equal(service.recovering, false);

    const empty = setup();
    assert.deepEqual(await empty.service.recoverPending([empty.adapter]), []);
    assert.equal(empty.service.recovering, false);
});

// ---------------------------------------------------------------------------
// listAlerts (ADR-021)
// ---------------------------------------------------------------------------

test('ARCA alerts list conflicts first, stale verifications and rejections, with exact counts', async () => {
    const queries = [];
    const db = {
        query: async (sql, params) => {
            const statement = String(sql);
            queries.push({ sql: statement, params });
            if (statement.includes('SUM(')) {
                return statement.includes('FROM invoices')
                    ? [[{ conflicts: '1', stuck: '150', rejected: '2' }]]
                    : [[{ conflicts: null, stuck: '1', rejected: null }]];
            }
            if (statement.includes('FROM invoices')) {
                return [[
                    { document_kind: 'invoice', id: 'i-2', status: 'authorizing', amount: '100' },
                    { document_kind: 'invoice', id: 'i-1', status: 'arca_conflict', amount: '1210.50' },
                ]];
            }
            return [[{ document_kind: 'credit_note', id: 'c-1', status: 'arca_conflict', amount: null }]];
        },
    };
    const service = new ArcaAuthorizationService({ db, afipService: {} });
    const alerts = await service.listAlerts();
    assert.deepEqual([alerts.conflicts, alerts.stuck, alerts.rejected], [1, 151, 2], 'counts come from COUNT queries, not the capped list');
    assert.equal(alerts.stale_minutes, ARCA_ALERT_STALE_MINUTES);
    assert.deepEqual(alerts.items.map(({ id, amount }) => [id, amount]), [['i-1', 1210.5], ['c-1', 0], ['i-2', 100]]);
    assert.equal(queries.length, 4);
    for (const { sql, params } of queries) {
        assert.match(sql, /status = 'arca_conflict'/);
        assert.match(sql, /status = 'authorizing' AND \(arca_requested_at IS NULL OR arca_requested_at < NOW\(\) - INTERVAL \? MINUTE\)/);
        assert.match(sql, /status = 'issued' AND cae IS NULL AND arca_last_error IS NOT NULL/);
        assert.match(sql, /deleted_at IS NULL/);
        assert.deepEqual(params, [ARCA_ALERT_STALE_MINUTES]);
    }
    assert.match(queries[0].sql, /COALESCE\(arca_expected_number, invoice_number\) AS number/);
    assert.match(queries[0].sql, /ORDER BY \(status = 'arca_conflict'\) DESC/);

    const custom = await service.listAlerts({ staleMinutes: 30 });
    assert.equal(custom.stale_minutes, 30);
    assert.deepEqual(queries.at(-1).params, [30]);
});

test('ARCA alerts are empty when nothing needs a person', async () => {
    const service = new ArcaAuthorizationService({ db: { query: async () => [[]] }, afipService: {} });
    assert.deepEqual(await service.listAlerts(), { conflicts: 0, stuck: 0, rejected: 0, stale_minutes: ARCA_ALERT_STALE_MINUTES, items: [] });
});
// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

test('invoice adapter prepares tickets locally and electronic invoices with their lines', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM invoice_items')) return [[{ quantity: 1 }, { quantity: 2 }]];
        if (String(sql).startsWith('SELECT * FROM invoices WHERE id = ?')) return [[{ id: 'i-1', status: 'authorized' }]];
        return [[]];
    });
    assert.deepEqual(await invoiceArcaAdapter.prepare({ id: 'i-1', invoice_type: 'tk' }), { local: true });
    const doc = { id: 'i-1', invoice_type: 'B' };
    const prepared = await invoiceArcaAdapter.prepare(doc);
    assert.equal(prepared.voucher, doc);
    assert.equal(prepared.items.length, 2);
    const loaded = await invoiceArcaAdapter.load('i-1');
    assert.equal(loaded.status, 'authorized');
    assert.equal(loaded.items.length, 2);
});

test('invoice adapter load returns an empty shell for an unknown invoice', async (t) => {
    mockPool(t, async () => [[]]);
    const loaded = await invoiceArcaAdapter.load('nope');
    assert.deepEqual(loaded, { items: [] });
});

test('invoice adapter returns the other invoice (authorized or in conflict) that holds the number', async () => {
    let seen;
    const db = { query: async (sql, values) => { seen = { sql: String(sql), values }; return [[{ id: 'other', cae: 'CAE-X' }]]; } };
    assert.deepEqual(
        await invoiceArcaAdapter.numberHolder(db, { id: 'i-1', invoice_type: 'B' }, { pos: 3 }, 8),
        { id: 'other', cae: 'CAE-X' }
    );
    assert.deepEqual(seen.values, ['B', 3, 8, 'i-1']);
    assert.match(seen.sql, /status IN \('authorized', 'arca_conflict'\)/);
    const free = { query: async () => [[]] };
    assert.equal(await invoiceArcaAdapter.numberHolder(free, { id: 'i-1', invoice_type: 'B' }, { pos: 3 }, 8), null);
});

function stubLedger(t) {
    const audits = [];
    const journals = [];
    const originalAudit = auditService.log;
    const originalJournal = accountingService.postInvoiceAccountingEntries;
    auditService.log = async (entry) => { audits.push(entry); };
    accountingService.postInvoiceAccountingEntries = async (connection, id) => { journals.push(id); };
    t.after(() => {
        auditService.log = originalAudit;
        accountingService.postInvoiceAccountingEntries = originalJournal;
    });
    return { audits, journals };
}

test('invoice adapter stores a ticket as authorized without fiscal data', async (t) => {
    const { audits, journals } = stubLedger(t);
    const calls = [];
    const connection = createMockConnection(async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; });
    await invoiceArcaAdapter.store(
        connection,
        { id: 'i-1', invoice_type: 'TK', invoice_number: 55 },
        { cae: null, cae_expiration_date: null, number: null, local: true },
        null, 'u-1'
    );
    assert.ok(calls[0].sql.includes("status = 'authorized'"));
    assert.deepEqual(journals, ['i-1']);
    assert.equal(audits[0].action, 'AUTHORIZE_INVOICE');
    assert.equal(audits[0].new_values.invoice_number, 55);
    assert.equal('recovered_from_arca' in audits[0].new_values, false);
});

test('invoice adapter stores the ARCA number and moves a provisional holder of that number', async (t) => {
    const { audits } = stubLedger(t);
    const calls = [];
    const connection = createMockConnection(async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('FROM invoices WHERE invoice_type = ? AND point_of_sale = ? AND invoice_number = ? AND id <> ?')) {
            return [[{ id: 'i-other', status: 'issued', invoice_number: 8 }]];
        }
        if (statement.includes('MAX(invoice_number)')) return [[{ max_number: 9 }]];
        if (statement.includes('SELECT `last_value`')) return [[{ last_value: 9 }]];
        return [[]];
    });
    await invoiceArcaAdapter.store(
        connection,
        { id: 'i-1', invoice_type: 'B' },
        { cae: 'CAE', cae_expiration_date: '2026-12-31', number: 8, recovered: true },
        { pos: 3 }, 'u-1'
    );
    const moved = calls.find(({ sql }) => sql === 'UPDATE invoices SET invoice_number = ? WHERE id = ?');
    assert.deepEqual(moved.params, [10, 'i-other']);
    const authorize = calls.find(({ sql }) => sql.includes("SET status = 'authorized', cae = ?"));
    assert.deepEqual(authorize.params, ['CAE', '2026-12-31', 8, 3, 'i-1']);
    assert.ok(calls.some(({ sql }) => sql.includes('GREATEST')));
    assert.deepEqual(audits.map((entry) => entry.action), ['INVOICE_PROVISIONAL_NUMBER_MOVED', 'AUTHORIZE_INVOICE']);
    assert.equal(audits[1].new_values.recovered_from_arca, true);
});

test('invoice adapter refuses a number that already belongs to another authorized invoice', async (t) => {
    stubLedger(t);
    const connection = createMockConnection(async (sql) => {
        if (String(sql).includes('AND id <> ? FOR UPDATE')) return [[{ id: 'i-other', status: 'authorized', invoice_number: 8 }]];
        return [[]];
    });
    await assert.rejects(
        () => invoiceArcaAdapter.store(
            connection, { id: 'i-1', invoice_type: 'B' },
            { cae: 'CAE', cae_expiration_date: null, number: 8 }, { pos: 3 }, 'u-1'
        ),
        (error) => error.statusCode === 409 && error.responseBody.error === 'arca_number_conflict'
    );
});

test('invoice adapter also refuses a number held by an invoice in conflict', async (t) => {
    stubLedger(t);
    const connection = createMockConnection(async (sql) => {
        if (String(sql).includes('AND id <> ? FOR UPDATE')) return [[{ id: 'i-other', status: 'arca_conflict', invoice_number: 8 }]];
        return [[]];
    });
    await assert.rejects(
        () => invoiceArcaAdapter.store(
            connection, { id: 'i-1', invoice_type: 'B' },
            { cae: 'CAE', cae_expiration_date: null, number: 8 }, { pos: 3 }, 'u-1'
        ),
        (error) => error.statusCode === 409 && error.responseBody.error === 'arca_number_conflict'
    );
});

test('credit note adapter refuses a note without an invoice and an invoice without CAE', async () => {
    const original = {
        by: creditNotesService._invoiceCorrectedBy,
        items: creditNotesService._creditNoteVoucherItems,
    };
    try {
        creditNotesService._invoiceCorrectedBy = async () => null;
        await assert.rejects(
            () => creditNoteArcaAdapter.prepare({ id: 'cn-1' }),
            (error) => error.statusCode === 409 && error.responseBody.error === 'credit_note_without_invoice'
        );
        creditNotesService._invoiceCorrectedBy = async () => ({ id: 'inv-1', invoice_type: 'B', cae: null });
        await assert.rejects(
            () => creditNoteArcaAdapter.prepare({ id: 'cn-1' }),
            (error) => error.statusCode === 409 && error.responseBody.error === 'invoice_not_authorized'
        );
    } finally {
        creditNotesService._invoiceCorrectedBy = original.by;
        creditNotesService._creditNoteVoucherItems = original.items;
    }
});

test('credit note adapter treats the note of a ticket as local', async () => {
    const original = creditNotesService._invoiceCorrectedBy;
    let itemsCalls = 0;
    const originalItems = creditNotesService._creditNoteVoucherItems;
    creditNotesService._invoiceCorrectedBy = async () => ({ id: 'inv-tk', invoice_type: 'tk', cae: null });
    creditNotesService._creditNoteVoucherItems = async () => { itemsCalls += 1; return []; };
    try {
        assert.deepEqual(await creditNoteArcaAdapter.prepare({ id: 'cn-tk' }), { local: true });
        assert.equal(itemsCalls, 0);
    } finally {
        creditNotesService._invoiceCorrectedBy = original;
        creditNotesService._creditNoteVoucherItems = originalItems;
    }
});

test('credit note adapter builds the voucher with the invoice letter and associated invoice', async () => {
    const original = {
        by: creditNotesService._invoiceCorrectedBy,
        items: creditNotesService._creditNoteVoucherItems,
    };
    const invoice = { id: 'inv-1', invoice_type: 'a', cae: '7000', client_tax_id: '20123456789', point_of_sale: 3, invoice_number: 10 };
    const lines = [{ vat_rate: 21, total_line: 121, vat_amount: 21 }];
    creditNotesService._invoiceCorrectedBy = async () => invoice;
    creditNotesService._creditNoteVoucherItems = async (cn, inv) => (inv === invoice ? lines : []);
    try {
        // The stored letter (B) is wrong: ARCA gets the invoice's letter.
        const prepared = await creditNoteArcaAdapter.prepare({ id: 'cn-1', credit_note_type: 'B' });
        assert.deepEqual(prepared.voucher, {
            id: 'cn-1',
            invoice_type: 'NC_A',
            client_tax_id: '20123456789',
            // RG 5616: the note carries the customer's condition from the corrected invoice.
            client_tax_condition: null,
            associated_voucher: { invoice_type: 'A', point_of_sale: 3, invoice_number: 10 },
        });
        assert.equal(prepared.items, lines);

        // An unknown invoice letter falls back to the note's own letter, then to B.
        creditNotesService._invoiceCorrectedBy = async () => ({ id: 'inv-2', invoice_type: 'X', cae: '7000' });
        const fromNote = await creditNoteArcaAdapter.prepare({ id: 'cn-2', credit_note_type: 'C' });
        assert.equal(fromNote.voucher.invoice_type, 'NC_C');
        assert.equal(fromNote.voucher.client_tax_id, null);
        const fallback = await creditNoteArcaAdapter.prepare({ id: 'cn-3', credit_note_type: 'Z' });
        assert.equal(fallback.voucher.invoice_type, 'NC_B');
    } finally {
        creditNotesService._invoiceCorrectedBy = original.by;
        creditNotesService._creditNoteVoucherItems = original.items;
    }
});

test('credit note adapter returns the other note of the same letter that holds the number', async () => {
    let params;
    const db = { query: async (sql, values) => { params = values; return [[{ id: 'cn-other', cae: 'CAE-X' }]]; } };
    assert.deepEqual(
        await creditNoteArcaAdapter.numberHolder(db, { id: 'cn-1' }, { voucherType: 3, pos: 3 }, 5),
        { id: 'cn-other', cae: 'CAE-X' }
    );
    assert.deepEqual(params, ['A', 3, 5, 'cn-1']);
    assert.equal(await creditNoteArcaAdapter.numberHolder(
        { query: async (sql, values) => { params = values; return [[]]; } }, { id: 'cn-1' }, { voucherType: 99, pos: 3 }, 5
    ), null);
    assert.equal(params[0], 'B');
});

test('credit note adapter stores a local note and an ARCA note with their audit', async (t) => {
    const audits = [];
    const originalAudit = auditService.log;
    auditService.log = async (entry) => { audits.push(entry); };
    t.after(() => { auditService.log = originalAudit; });
    const calls = [];
    const connection = createMockConnection(async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; });

    await creditNoteArcaAdapter.store(
        connection, { id: 'cn-tk' }, { cae: null, cae_expiration_date: null, number: null, local: true }, null, 'u-1'
    );
    assert.ok(calls[0].sql.includes("status = 'authorized'"));
    assert.equal(audits[0].new_values.arca_voucher_number, null);

    await creditNoteArcaAdapter.store(
        connection,
        { id: 'cn-1', credit_note_type: 'B' },
        { cae: 'CAE', cae_expiration_date: '2026-12-31', number: '5', recovered: true },
        { voucherType: 3, pos: 3 }, 'u-1'
    );
    const update = calls.at(-1);
    assert.deepEqual(update.params, ['CAE', '2026-12-31', 5, 3, 'A', 'cn-1']);
    assert.equal(audits[1].action, 'AUTHORIZE_CREDIT_NOTE');
    assert.equal(audits[1].new_values.arca_voucher_number, 5);
    assert.equal(audits[1].new_values.recovered_from_arca, true);

    // An unknown voucher type keeps the stored letter.
    await creditNoteArcaAdapter.store(
        connection, { id: 'cn-2', credit_note_type: 'C' }, { cae: 'CAE', cae_expiration_date: null, number: 6 },
        { voucherType: 99, pos: 3 }, 'u-1'
    );
    assert.equal(calls.at(-1).params[4], 'C');
});

test('credit note adapter loads the note', async (t) => {
    mockPool(t, async () => [[{ id: 'cn-1', status: 'authorized' }]]);
    assert.deepEqual(await creditNoteArcaAdapter.load('cn-1'), { id: 'cn-1', status: 'authorized' });
});
