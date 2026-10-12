import test from 'node:test';
import assert from 'node:assert/strict';

import * as controller from '../controllers/warrantiesController.js';
import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
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

function stub(t, target, method, impl) {
    const calls = [];
    const previous = target[method];
    target[method] = async (...args) => {
        calls.push(args);
        return impl(...args);
    };
    t.after(() => {
        target[method] = previous;
    });
    return calls;
}

function codedError(errorCode) {
    const err = new Error(errorCode);
    err.errorCode = errorCode;
    return err;
}

function createTrackedConnection(queryMock) {
    const calls = [];
    const counts = { begin: 0, commit: 0, rollback: 0, release: 0 };
    const connection = {
        async beginTransaction() { counts.begin += 1; },
        async commit() { counts.commit += 1; },
        async rollback() { counts.rollback += 1; },
        release() { counts.release += 1; },
        async query(sql, params = []) {
            const statement = normalizeSql(sql);
            calls.push({ statement, params });
            return queryMock(statement, params);
        }
    };
    return { connection, calls, counts };
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

// ---- warranties ----

test('getWarranties passes the query to the service', async (t) => {
    const calls = stub(t, warrantiesService, 'getWarranties', () => [{ id: 'w1' }]);
    const result = await runHandler(controller.getWarranties, { query: { status: 'initiated' } });
    assert.deepEqual(result.body, [{ id: 'w1' }]);
    assert.deepEqual(calls[0], [{ status: 'initiated' }]);
});

test('createWarranty generates an id and forces status initiated', async (t) => {
    const calls = stub(t, warrantiesService, 'create', (data) => data);
    const result = await runHandler(controller.createWarranty, {
        body: { product_id: 'p1', status: 'resolved' }
    });
    assert.match(result.body.id, UUID_RE);
    assert.equal(result.body.status, 'initiated');
    assert.equal(calls[0][0].product_id, 'p1');
});

test('createWarranty propagates errors', async (t) => {
    stub(t, warrantiesService, 'create', () => { throw new Error('nope'); });
    await assert.rejects(runHandler(controller.createWarranty, { body: {} }), /nope/);
});

test('updateWarrantyStatus delegates id, body, user and ip', async (t) => {
    const calls = stub(t, warrantiesService, 'updateWarrantyStatus', () => ({ ok: true }));
    const result = await runHandler(controller.updateWarrantyStatus, {
        params: { id: 'w1' },
        body: { status: 'resolved' },
        user: { id: 'u1' }
    });
    assert.deepEqual(result.body, { ok: true });
    assert.deepEqual(calls[0].slice(0, 3), ['w1', { status: 'resolved' }, 'u1']);
    assert.equal(typeof calls[0][3], 'string');
});

function warrantyConnection(claim) {
    const current = claim ? { ...claim } : null;
    return createTrackedConnection((statement, params) => {
        if (statement.startsWith('SELECT * FROM warranty_claims')) return [current ? [{ ...current }] : []];
        if (statement.startsWith('UPDATE warranty_claims SET')) {
            const keys = statement.slice('UPDATE warranty_claims SET '.length, statement.indexOf(' WHERE')).split(', ').map((s) => s.split(' =')[0]);
            keys.forEach((key, i) => { current[key] = params[i]; });
            return [{ affectedRows: 1 }];
        }
        return [[]];
    });
}

test('warranty status keeps the form notes as resolution notes and audits the change', async (t) => {
    const tracked = warrantyConnection({ id: 'w1', status: 'received', resolution_type: null, product_id: 'p1' });
    installPool(t, tracked);
    const audits = stub(t, auditService, 'log', () => {});

    const result = await warrantiesService.updateWarrantyStatus('w1', { status: 'in_progress', notes: ' Revisión técnica ' }, 'u1', '10.0.0.1');

    // `notes` is not a warranty_claims column: passing it through made every status change fail.
    const update = tracked.calls.find(({ statement }) => statement.startsWith('UPDATE warranty_claims'));
    assert.deepEqual(update.params, ['in_progress', 'Revisión técnica', 'w1']);
    assert.equal(result.status, 'in_progress');
    assert.equal(result.resolution_notes, 'Revisión técnica');
    assert.equal(audits[0][0].action, 'UPDATE_WARRANTY_STATUS');
    assert.deepEqual(audits[0][0].old_values, { status: 'received', resolution_type: null });
    assert.equal(tracked.calls.some(({ statement }) => /^(UPDATE inventory|INSERT INTO inventory)/.test(statement)), false, 'no stock effect');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('warranty status of an unknown claim is a 404', async (t) => {
    const tracked = warrantyConnection(null);
    installPool(t, tracked);
    await assert.rejects(
        () => warrantiesService.updateWarrantyStatus('missing', { status: 'closed' }),
        (err) => err.statusCode === 404 && err.responseBody.error === 'not_found'
    );
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

// ---- returns ----

test('getReturns, getReturnsAnalytics and createReturn delegate to the service', async (t) => {
    const list = stub(t, returnsService, 'getReturns', () => [{ id: 'r1' }]);
    const analytics = stub(t, returnsService, 'getReturnsAnalytics', () => ({ total: 1 }));
    const create = stub(t, returnsService, 'createReturn', () => ({ id: 'r2' }));

    const a = await runHandler(controller.getReturns, { query: { status: 'pending' } });
    assert.deepEqual(a.body, [{ id: 'r1' }]);
    assert.deepEqual(list[0], [{ status: 'pending' }]);

    const b = await runHandler(controller.getReturnsAnalytics);
    assert.deepEqual(b.body, { total: 1 });
    assert.equal(analytics.length, 1);

    const c = await runHandler(controller.createReturn, { body: { order_id: 'o1' } });
    assert.deepEqual(c.body, { id: 'r2' });
    assert.deepEqual(create[0], [{ order_id: 'o1' }]);
});

test('approveReturn returns merged result with credit note message', async (t) => {
    const calls = stub(t, returnsService, 'approveReturn', () => ({ credit_note_number: 'NC-2026-0001', amount: 50 }));
    const result = await runHandler(controller.approveReturn, { params: { id: 'r1' }, user: { id: 'u1' } });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.amount, 50);
    assert.match(result.body.message, /NC-2026-0001/);
    assert.deepEqual(calls[0], ['r1', 'u1', '127.0.0.1']);
});

test('approveReturn uses null user when unauthenticated', async (t) => {
    const calls = stub(t, returnsService, 'approveReturn', () => ({ credit_note_number: 'X' }));
    await runHandler(controller.approveReturn, { params: { id: 'r1' } });
    assert.equal(calls[0][1], null);
});

test('approveReturn maps domain errors to HTTP statuses', async (t) => {
    let code = 'RETURN_NOT_FOUND';
    stub(t, returnsService, 'approveReturn', () => { throw codedError(code); });
    const expected = [
        ['RETURN_NOT_FOUND', 404, 'not_found'],
        ['RETURN_ALREADY_APPROVED', 409, 'already_approved'],
        ['RETURN_INVALID_STATE', 400, 'invalid_state'],
        ['RETURN_WITHOUT_ITEMS', 400, 'missing_items'],
        ['RETURN_TOTAL_INVALID', 400, 'invalid_total']
    ];
    for (const [errorCode, status, error] of expected) {
        code = errorCode;
        const result = await runHandler(controller.approveReturn, { params: { id: 'r1' } });
        assert.equal(result.status, status, errorCode);
        assert.equal(result.body.error, error, errorCode);
    }
});

test('approveReturn rethrows unknown errors', async (t) => {
    stub(t, returnsService, 'approveReturn', () => { throw codedError('SOMETHING_ELSE'); });
    await assert.rejects(runHandler(controller.approveReturn, { params: { id: 'r1' } }), /SOMETHING_ELSE/);
});

// ---- credit notes ----

test('getCreditNotes delegates to the service', async (t) => {
    const calls = stub(t, creditNotesService, 'getCreditNotes', () => [{ id: 'n1' }]);
    const result = await runHandler(controller.getCreditNotes, { query: { client_id: 'c1' } });
    assert.deepEqual(result.body, [{ id: 'n1' }]);
    assert.deepEqual(calls[0], [{ client_id: 'c1' }]);
});

function creditNoteQueryMock({ maxSeq = 4, failInsert = false } = {}) {
    return (statement) => {
        if (statement.startsWith('SELECT MAX(CAST')) return [[{ max_seq: maxSeq }]];
        if (statement.startsWith('INSERT IGNORE INTO document_sequences')) return [{}];
        if (statement.startsWith('SELECT `last_value`')) return [[{ last_value: 2 }]];
        if (statement.startsWith('UPDATE document_sequences')) return [{}];
        if (statement.startsWith('INSERT INTO credit_notes')) {
            if (failInsert) throw new Error('insert failed');
            return [{}];
        }
        // C2: the manual note is posted (sales + output VAT / receivables).
        if (statement.startsWith('SELECT tax_rate FROM company_settings')) return [[{ tax_rate: 0.21 }]];
        if (statement.startsWith('INSERT INTO journal_entr')) return [{}];
        throw new Error(`Unexpected SQL: ${statement}`);
    };
}

test('createCreditNote numbers from the max existing sequence, inserts, commits and audits', async (t) => {
    const tracked = createTrackedConnection(creditNoteQueryMock({ maxSeq: 4 }));
    installPool(t, tracked);
    const audits = stub(t, auditService, 'log', () => undefined);
    const year = new Date().getFullYear();

    const result = await runHandler(controller.createCreditNote, {
        body: {
            client_id: 'c1',
            customer_name: 'Ana',
            reference_type: 'warranty',
            reference_id: 'w1',
            amount: '25.5',
            notes: 'nota'
        },
        user: { id: 'u1' }
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.number, `NC-${year}-0005`);
    assert.equal(result.body.reference_type, 'warranty');
    assert.equal(result.body.amount, 25.5);
    assert.equal(result.body.status, 'issued');
    assert.match(result.body.id, UUID_RE);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });

    const select = tracked.calls.find((c) => c.statement.startsWith('SELECT MAX'));
    assert.deepEqual(select.params, [`NC-${year}-%`]);
    const insert = tracked.calls.find((c) => c.statement.startsWith('INSERT INTO credit_notes'));
    // Last param: idempotency_key (none sent by this caller).
    assert.deepEqual(insert.params, [result.body.id, `NC-${year}-0005`, 'c1', 'Ana', 'warranty', 'w1', 25.5, 'nota', null]);

    assert.equal(audits.length, 1);
    assert.equal(audits[0][0].action, 'CREATE_CREDIT_NOTE');
    assert.equal(audits[0][0].user_id, 'u1');
    assert.equal(audits[0][0].entity_id, result.body.id);
});

test('createCreditNote normalizes manual and unknown reference types, defaults and reason', async (t) => {
    const tracked = createTrackedConnection(creditNoteQueryMock({ maxSeq: null }));
    installPool(t, tracked);
    stub(t, auditService, 'log', () => undefined);

    const manual = await runHandler(controller.createCreditNote, {
        body: { client_id: 'c1', reference_type: 'manual', reason: 'motivo' }
    });
    assert.equal(manual.body.reference_type, 'other');
    assert.equal(manual.body.notes, 'motivo');
    assert.equal(manual.body.amount, 0);
    assert.equal(manual.body.customer_name, null);
    assert.equal(manual.body.reference_id, null);
    // max_seq null -> 0, doc sequence last_value 2 -> next 3
    assert.match(manual.body.number, /-0003$/);

    const unknown = await runHandler(controller.createCreditNote, {
        body: { client_id: 'c1', reference_type: 'bogus' }
    });
    assert.equal(unknown.body.reference_type, 'other');
    assert.equal(unknown.body.notes, null);

    const missing = await runHandler(controller.createCreditNote, { body: { client_id: 'c1' } });
    assert.equal(missing.body.reference_type, 'other');

    const discount = await runHandler(controller.createCreditNote, {
        body: { client_id: 'c1', reference_type: 'discount' }
    });
    assert.equal(discount.body.reference_type, 'discount');
});

test('createCreditNote tolerates an empty max-sequence result and no user', async (t) => {
    const tracked = createTrackedConnection((statement) => {
        if (statement.startsWith('SELECT MAX(CAST')) return [[]];
        return creditNoteQueryMock()(statement);
    });
    installPool(t, tracked);
    const audits = stub(t, auditService, 'log', () => undefined);
    const result = await runHandler(controller.createCreditNote, { body: { client_id: 'c1' } });
    assert.equal(result.status, 200);
    assert.equal(audits[0][0].user_id, null);
});

test('createCreditNote rolls back and releases when the insert fails, without auditing', async (t) => {
    const tracked = createTrackedConnection(creditNoteQueryMock({ failInsert: true }));
    installPool(t, tracked);
    const audits = stub(t, auditService, 'log', () => undefined);

    await assert.rejects(
        runHandler(controller.createCreditNote, { body: { client_id: 'c1', amount: 10 } }),
        /insert failed/
    );
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(audits.length, 0);
});

test('authorizeCreditNote authorizes and audits', async (t) => {
    const calls = stub(t, creditNotesService, 'authorizeCreditNote', () => ({ cae: '123' }));
    const audits = stub(t, auditService, 'log', () => undefined);
    const result = await runHandler(controller.authorizeCreditNote, {
        params: { id: 'n1' },
        user: { id: 'u1' }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.cae, '123');
    assert.deepEqual(calls[0], ['n1', 'u1']);
    assert.equal(audits[0][0].action, 'AUTHORIZE_CREDIT_NOTE');
    assert.equal(audits[0][0].entity_id, 'n1');
    assert.deepEqual(audits[0][0].new_values, { cae: '123' });
});

test('authorizeCreditNote uses null user when unauthenticated', async (t) => {
    const calls = stub(t, creditNotesService, 'authorizeCreditNote', () => ({}));
    const audits = stub(t, auditService, 'log', () => undefined);
    await runHandler(controller.authorizeCreditNote, { params: { id: 'n1' } });
    assert.equal(calls[0][1], null);
    assert.equal(audits[0][0].user_id, null);
});

test('authorizeCreditNote maps not found to 404 and rethrows others', async (t) => {
    let code = 'CREDIT_NOTE_NOT_FOUND';
    stub(t, creditNotesService, 'authorizeCreditNote', () => { throw codedError(code); });
    const audits = stub(t, auditService, 'log', () => undefined);

    const missing = await runHandler(controller.authorizeCreditNote, { params: { id: 'zz' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');
    assert.equal(audits.length, 0);

    code = 'ARCA_DOWN';
    await assert.rejects(runHandler(controller.authorizeCreditNote, { params: { id: 'n1' } }), /ARCA_DOWN/);
});
