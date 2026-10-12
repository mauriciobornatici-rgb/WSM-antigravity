import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import * as controller from '../controllers/userController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';

const STRONG = 'Str0ng!Passw0rd';

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const headers = {};
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            setHeader(name, value) {
                headers[name] = value;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body, headers });
                return this;
            },
            end() {
                settled = true;
                resolve({ status: statusCode, body: undefined, headers });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined, headers });
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

function installPool(t, { poolQuery, tracked } = {}) {
    const previousQuery = pool.query;
    const previousGetConnection = pool.getConnection;
    const poolCalls = [];
    pool.query = async (sql, params = []) => {
        const statement = normalizeSql(sql);
        poolCalls.push({ statement, params });
        if (!poolQuery) throw new Error(`Unexpected pool SQL: ${statement}`);
        return poolQuery(statement, params);
    };
    pool.getConnection = async () => {
        if (!tracked) throw new Error('Unexpected getConnection');
        return tracked.connection;
    };
    t.after(() => {
        pool.query = previousQuery;
        pool.getConnection = previousGetConnection;
    });
    return poolCalls;
}

function installAudit(t) {
    const entries = [];
    const previous = auditService.log;
    auditService.log = async (entry, connection) => {
        entries.push({ entry, connection });
    };
    t.after(() => {
        auditService.log = previous;
    });
    return entries;
}

function spyBcryptCompare(t) {
    const previous = bcrypt.compare;
    const calls = [];
    bcrypt.compare = async (...args) => {
        calls.push(args);
        return previous.apply(bcrypt, args);
    };
    t.after(() => {
        bcrypt.compare = previous;
    });
    return calls;
}

test('login with unknown email returns 401 and still runs a bcrypt compare', async (t) => {
    installPool(t, { poolQuery: async () => [[]] });
    const audit = installAudit(t);
    const compareCalls = spyBcryptCompare(t);

    const result = await runHandler(controller.login, {
        body: { email: 'nobody@example.com', password: 'whatever' }
    });

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'invalid_credentials', message: 'Credenciales inválidas' });
    assert.equal(compareCalls.length, 1, 'timing-equalizing bcrypt.compare must run');
    assert.equal(compareCalls[0][0], 'whatever');
    assert.equal(result.headers['Set-Cookie'], undefined);
    assert.equal(audit.length, 0);
});

test('login with wrong password returns the same 401 body as unknown email and audits failure', async (t) => {
    const hash = await bcrypt.hash(STRONG, 4);
    installPool(t, { poolQuery: async () => [[{ id: 'u1', email: 'a@b.com', password_hash: hash, role: 'admin' }]] });
    const audit = installAudit(t);
    const compareCalls = spyBcryptCompare(t);

    const result = await runHandler(controller.login, { body: { email: 'a@b.com', password: 'Wrong!Pass1' } });

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'invalid_credentials', message: 'Credenciales inválidas' });
    assert.equal(compareCalls.length, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entry.action, 'LOGIN_FAILURE');
    assert.equal(audit[0].entry.entity_id, 'u1');
    assert.equal(result.headers['Set-Cookie'], undefined);
});

test('login success signs an HS256 JWT into an HttpOnly cookie and never leaks hash or token in the body', async (t) => {
    const hash = await bcrypt.hash(STRONG, 4);
    const user = { id: 'u1', name: 'Ana', email: 'a@b.com', password_hash: hash, role: 'manager', token_version: '3' };
    const tracked = createTrackedConnection(async () => [{}]);
    installPool(t, { poolQuery: async () => [[user]], tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.login, { body: { email: 'a@b.com', password: STRONG } });

    assert.equal(result.status, 200);
    assert.equal(result.body.user.id, 'u1');
    assert.equal(result.body.user.email, 'a@b.com');
    assert.equal('password_hash' in result.body.user, false);
    assert.equal('token' in result.body, false);
    assert.ok(!JSON.stringify(result.body).includes(hash));

    const cookie = result.headers['Set-Cookie'];
    assert.match(cookie, /^wsm_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const token = decodeURIComponent(cookie.split(';')[0].split('=')[1]);
    const decoded = jwt.decode(token, { complete: true });
    assert.equal(decoded.header.alg, 'HS256');
    assert.equal(decoded.payload.id, 'u1');
    assert.equal(decoded.payload.role, 'manager');
    assert.equal(decoded.payload.token_version, 3);
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.match(tracked.calls[0].statement, /^UPDATE users SET last_login/);
    assert.deepEqual(tracked.calls[0].params, ['u1']);
    assert.equal(audit[0].entry.action, 'LOGIN_SUCCESS');
    assert.equal(audit[0].connection, tracked.connection);
});

test('login defaults token_version to 0 and loginDirect aliases login', async (t) => {
    assert.equal(controller.loginDirect, controller.login);
    const hash = await bcrypt.hash(STRONG, 4);
    const tracked = createTrackedConnection(async () => [{}]);
    installPool(t, { poolQuery: async () => [[{ id: 'u2', email: 'c@d.com', password_hash: hash, role: 'cashier' }]], tracked });
    installAudit(t);

    const result = await runHandler(controller.loginDirect, { body: { email: 'c@d.com', password: STRONG } });
    const token = decodeURIComponent(result.headers['Set-Cookie'].split(';')[0].split('=')[1]);
    assert.equal(jwt.decode(token).token_version, 0);
});

test('login rolls back and releases when the last_login transaction fails', async (t) => {
    const hash = await bcrypt.hash(STRONG, 4);
    const tracked = createTrackedConnection(async () => {
        throw new Error('db down');
    });
    installPool(t, { poolQuery: async () => [[{ id: 'u1', email: 'a@b.com', password_hash: hash, role: 'admin' }]], tracked });
    installAudit(t);

    await assert.rejects(
        runHandler(controller.login, { body: { email: 'a@b.com', password: STRONG } }),
        /db down/
    );
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('getSession returns the active user or 401 when the session is no longer valid', async (t) => {
    let rows = [{ id: 'u1', name: 'Ana', email: 'a@b.com', role: 'admin', status: 'active' }];
    const calls = installPool(t, { poolQuery: async () => [rows] });

    const ok = await runHandler(controller.getSession, { user: { id: 'u1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.id, 'u1');
    assert.equal('password_hash' in ok.body.user, false);
    assert.deepEqual(calls[0].params, ['u1']);
    assert.doesNotMatch(calls[0].statement, /password_hash/);

    rows = [];
    const gone = await runHandler(controller.getSession, { user: { id: 'u1' } });
    assert.equal(gone.status, 401);
    assert.equal(gone.body.error, 'invalid_session');
});

test('logout expires the session cookie and answers 204', async () => {
    const result = await runHandler(controller.logout);
    assert.equal(result.status, 204);
    assert.match(result.headers['Set-Cookie'], /^wsm_session=;/);
    assert.match(result.headers['Set-Cookie'], /Max-Age=0/);
    assert.match(result.headers['Set-Cookie'], /HttpOnly/);
});

test('getUsers lists non-deleted users without password hashes', async (t) => {
    const calls = installPool(t, { poolQuery: async () => [[{ id: 'u1' }, { id: 'u2' }]] });
    const result = await runHandler(controller.getUsers);
    assert.equal(result.status, 200);
    assert.equal(result.body.length, 2);
    assert.match(calls[0].statement, /deleted_at IS NULL/);
    assert.doesNotMatch(calls[0].statement, /password_hash/);
});

test('createUser rejects weak or missing passwords before touching the database', async (t) => {
    installPool(t);
    for (const password of [undefined, '', 'sh0rt!A', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoDigits!!Aa', 'NoSymbol123Aa', 12345678]) {
        const result = await runHandler(controller.createUser, {
            body: { name: 'N', email: 'n@x.com', password, role: 'cashier' }
        });
        assert.equal(result.status, 400, `password ${String(password)} must be rejected`);
        assert.equal(result.body.error, 'invalid_password');
    }
});

test('createUser creates an active user with a bcrypt-hashed password and audits it', async (t) => {
    const created = { id: 'ignored', name: 'N', email: 'n@x.com', role: 'cashier', status: 'active' };
    const tracked = createTrackedConnection(async (statement) => {
        if (statement.startsWith('SELECT id FROM users WHERE email')) return [[]];
        if (statement.startsWith('INSERT INTO users')) return [{}];
        return [[created]];
    });
    installPool(t, { tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.createUser, {
        body: { name: 'N', email: 'n@x.com', password: STRONG, role: 'cashier' },
        user: { id: 'admin1' }
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, created);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.match(tracked.calls[0].statement, /FOR UPDATE$/);
    const insert = tracked.calls[1];
    const [id, name, email, hash, role] = insert.params;
    assert.equal(name, 'N');
    assert.equal(email, 'n@x.com');
    assert.equal(role, 'cashier');
    assert.notEqual(hash, STRONG);
    assert.equal(await bcrypt.compare(STRONG, hash), true);
    assert.equal(audit[0].entry.action, 'CREATE_USER');
    assert.equal(audit[0].entry.entity_id, id);
    assert.equal(audit[0].entry.user_id, 'admin1');
    assert.ok(!JSON.stringify(audit[0].entry).includes('password'));
});

test('createUser falls back to a synthetic audit payload and null actor', async (t) => {
    const tracked = createTrackedConnection(async (statement) => {
        if (statement.startsWith('SELECT id FROM users WHERE email')) return [[]];
        if (statement.startsWith('INSERT INTO users')) return [{}];
        return [[]];
    });
    installPool(t, { tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.createUser, {
        body: { name: 'N', email: 'n@x.com', password: STRONG, role: 'cashier' }
    });
    assert.equal(result.body, undefined);
    assert.equal(audit[0].entry.user_id, null);
    assert.equal(audit[0].entry.new_values.status, 'active');
});

test('createUser answers 409 and rolls back on duplicate email', async (t) => {
    const tracked = createTrackedConnection(async () => [[{ id: 'existing' }]]);
    installPool(t, { tracked });
    installAudit(t);

    const result = await runHandler(controller.createUser, {
        body: { name: 'N', email: 'dup@x.com', password: STRONG, role: 'cashier' }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'duplicate_email');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
    assert.equal(tracked.calls.length, 1);
});

test('createUser rolls back and releases on unexpected errors', async (t) => {
    const tracked = createTrackedConnection(async () => {
        throw new Error('boom');
    });
    installPool(t, { tracked });
    await assert.rejects(
        runHandler(controller.createUser, { body: { name: 'N', email: 'n@x.com', password: STRONG, role: 'cashier' } }),
        /boom/
    );
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

function updateConnection({ existing = [{ id: 'u1', role: 'cashier', status: 'active' }], dup = [], updated = [{ id: 'u1', name: 'New' }], activeAdmins = [{ id: 'u1' }, { id: 'u2' }] } = {}) {
    return createTrackedConnection(async (statement) => {
        if (statement.includes('FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [existing];
        if (statement.includes("role = 'admin' AND status = 'active'")) return [activeAdmins];
        if (statement.includes('AND id != ?')) return [dup];
        if (statement.startsWith('UPDATE users')) return [{}];
        return [updated];
    });
}

test('updateUser answers 404 and rolls back when the user does not exist', async (t) => {
    const tracked = updateConnection({ existing: [] });
    installPool(t, { tracked });
    const result = await runHandler(controller.updateUser, { params: { id: 'nope' }, body: {} });
    assert.equal(result.status, 404);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('updateUser answers 409 when the email belongs to another user', async (t) => {
    const tracked = updateConnection({ dup: [{ id: 'other' }] });
    installPool(t, { tracked });
    const result = await runHandler(controller.updateUser, {
        params: { id: 'u1' },
        body: { name: 'N', email: 'dup@x.com', role: 'cashier', status: 'active' }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'duplicate_email');
    assert.equal(tracked.counts.rollback, 1);
    assert.equal(tracked.counts.release, 1);
});

test('updateUser refuses a weak replacement password and does not update', async (t) => {
    const tracked = updateConnection();
    installPool(t, { tracked });
    const result = await runHandler(controller.updateUser, {
        params: { id: 'u1' },
        body: { name: 'N', email: 'n@x.com', role: 'cashier', status: 'active', password: 'weak' }
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'invalid_password');
    assert.equal(tracked.calls.some((call) => call.statement.startsWith('UPDATE users')), false);
    assert.equal(tracked.counts.rollback, 1);
});

test('updateUser without password keeps the hash and does not bump token_version', async (t) => {
    const tracked = updateConnection();
    installPool(t, { tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.updateUser, {
        params: { id: 'u1' },
        body: { name: 'New', email: 'n@x.com', role: 'manager', status: 'active' },
        user: { id: 'admin1' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { id: 'u1', name: 'New' });
    const update = tracked.calls.find((call) => call.statement.startsWith('UPDATE users'));
    assert.doesNotMatch(update.statement, /password_hash|token_version/);
    assert.deepEqual(update.params, ['New', 'n@x.com', 'manager', 'active', 'u1']);
    assert.equal(audit[0].entry.action, 'UPDATE_USER');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('updateUser with a strong password rehashes it and invalidates existing sessions', async (t) => {
    const tracked = updateConnection({ updated: [] });
    installPool(t, { tracked });
    const audit = installAudit(t);
    const body = { name: 'New', email: 'n@x.com', role: 'manager', status: 'active', password: STRONG };

    const result = await runHandler(controller.updateUser, { params: { id: 'u1' }, body });
    assert.equal(result.status, 200);
    const update = tracked.calls.find((call) => call.statement.startsWith('UPDATE users'));
    assert.match(update.statement, /password_hash = \?, token_version = token_version \+ 1/);
    const hash = update.params[4];
    assert.notEqual(hash, STRONG);
    assert.equal(await bcrypt.compare(STRONG, hash), true);
    assert.equal(update.params[5], 'u1');
    assert.equal(audit[0].entry.user_id, null);
    assert.equal(audit[0].entry.new_values, body);
});

test('updateUser rolls back and releases on unexpected errors', async (t) => {
    const tracked = createTrackedConnection(async () => {
        throw new Error('boom');
    });
    installPool(t, { tracked });
    await assert.rejects(runHandler(controller.updateUser, { params: { id: 'u1' }, body: {} }), /boom/);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

function deleteConnection({ user, admins = [] }) {
    return createTrackedConnection(async (statement) => {
        if (statement.includes('AND deleted_at IS NULL FOR UPDATE') && statement.includes('WHERE id = ?')) return [user];
        if (statement.includes("role = 'admin'")) return [admins];
        return [{}];
    });
}

test('deleteUser answers 404 when the user is missing or already deleted', async (t) => {
    const tracked = deleteConnection({ user: [] });
    installPool(t, { tracked });
    const result = await runHandler(controller.deleteUser, { params: { id: 'x' } });
    assert.equal(result.status, 404);
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('deleteUser refuses to remove the last administrator', async (t) => {
    const tracked = deleteConnection({ user: [{ id: 'a1', role: 'admin' }], admins: [{ id: 'a1' }] });
    installPool(t, { tracked });
    const result = await runHandler(controller.deleteUser, { params: { id: 'a1' } });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'last_admin');
    assert.equal(tracked.calls.some((call) => call.statement.startsWith('UPDATE users')), false);
    assert.equal(tracked.counts.rollback, 1);
});

test('deleteUser soft-deletes, bumps token_version and audits when another admin remains', async (t) => {
    const tracked = deleteConnection({ user: [{ id: 'a1', role: 'admin' }], admins: [{ id: 'a1' }, { id: 'a2' }] });
    installPool(t, { tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.deleteUser, { params: { id: 'a1' }, user: { id: 'a2' } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, message: 'Usuario desactivado' });
    const update = tracked.calls.find((call) => call.statement.startsWith('UPDATE users'));
    assert.match(update.statement, /deleted_at = CURRENT_TIMESTAMP.*token_version = token_version \+ 1/);
    assert.deepEqual(update.params, ['inactive', 'a1']);
    assert.equal(audit[0].entry.action, 'DELETE_USER');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
});

test('deleteUser skips the admin count for non-admin roles and rolls back on errors', async (t) => {
    const tracked = deleteConnection({ user: [{ id: 'c1', role: 'cashier' }] });
    installPool(t, { tracked });
    installAudit(t);
    const ok = await runHandler(controller.deleteUser, { params: { id: 'c1' } });
    assert.equal(ok.status, 200);
    assert.equal(tracked.calls.some((call) => call.statement.includes("role = 'admin'")), false);

    const failing = createTrackedConnection(async () => {
        throw new Error('boom');
    });
    installPool(t, { tracked: failing });
    await assert.rejects(runHandler(controller.deleteUser, { params: { id: 'c1' } }), /boom/);
    assert.deepEqual(failing.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('updateUser refuses to demote or deactivate the last active admin', async (t) => {
    for (const body of [
        { name: 'Admin', email: 'a@x.com', role: 'manager', status: 'active' },
        { name: 'Admin', email: 'a@x.com', role: 'admin', status: 'inactive' },
    ]) {
        const tracked = updateConnection({ existing: [{ id: 'u1', role: 'admin', status: 'active' }], activeAdmins: [{ id: 'u1' }] });
        installPool(t, { tracked });
        const result = await runHandler(controller.updateUser, { params: { id: 'u1' }, body });
        assert.equal(result.status, 409);
        assert.equal(result.body.error, 'last_admin');
        assert.equal(tracked.calls.some((call) => call.statement.startsWith('UPDATE users')), false);
        assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
    }
});

test('updateUser lets an admin be demoted while another active admin remains', async (t) => {
    const tracked = updateConnection({ existing: [{ id: 'u1', role: 'admin', status: 'active' }], activeAdmins: [{ id: 'u1' }, { id: 'u2' }] });
    installPool(t, { tracked });
    installAudit(t, async () => {});
    const result = await runHandler(controller.updateUser, {
        params: { id: 'u1' }, body: { name: 'Ex admin', email: 'a@x.com', role: 'manager', status: 'active' },
    });
    assert.equal(result.status, 200);
    assert.ok(tracked.calls.some((call) => call.statement.startsWith('UPDATE users')));
});
