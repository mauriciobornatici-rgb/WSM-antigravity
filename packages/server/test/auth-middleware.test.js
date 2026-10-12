import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { PERMISSIONS } from '@wsm/common';

import pool from '../config/db.js';
import { getEnvConfig } from '../config/env.js';
import { authenticateToken, authorizePermission } from '../middleware/authMiddleware.js';
import { AUTH_COOKIE_NAME } from '../utils/authCookie.js';

const jwtSecret = getEnvConfig().jwtSecret;
const userQuery = 'SELECT id, role, status, deleted_at, token_version FROM users WHERE id = ? LIMIT 1';

function createRequest(overrides = {}) {
    return {
        method: 'GET',
        headers: {},
        ...overrides
    };
}

function createResponse() {
    let statusCode = 200;
    let body;
    let jsonCalls = 0;
    const response = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            body = payload;
            jsonCalls += 1;
            return this;
        }
    };
    return {
        response,
        snapshot: () => ({ statusCode, body, jsonCalls })
    };
}

async function invoke(handler, request = createRequest()) {
    const response = createResponse();
    const nextArgs = [];
    await handler(request, response.response, (...args) => {
        nextArgs.push(args);
    });
    return {
        request,
        ...response.snapshot(),
        nextCalls: nextArgs.length,
        nextArgs
    };
}

function installPoolQuery(t, queryMock = async (sql) => {
    throw new Error(`Unexpected pool SQL: ${String(sql)}`);
}) {
    const previousQuery = pool.query;
    let calls = 0;
    pool.query = async (sql, params) => {
        calls += 1;
        return queryMock(sql, params);
    };
    t.after(() => {
        pool.query = previousQuery;
    });
    return { calls: () => calls };
}

function signToken(payload = {}) {
    return jwt.sign({ id: 'user-1', token_version: 0, ...payload }, jwtSecret);
}

function expiredToken() {
    return jwt.sign({ id: 'expired-user', token_version: 0, exp: Math.floor(Date.now() / 1000) - 1 }, jwtSecret);
}

function strictUserQuery(expectedUserId, rowOrRows) {
    return async (sql, params) => {
        assert.equal(String(sql).replace(/\s+/g, ' ').trim(), userQuery);
        assert.deepEqual(params, [expectedUserId]);
        return [rowOrRows];
    };
}

test('authenticateToken returns 401 without a token and never queries the database', async (t) => {
    const db = installPoolQuery(t);

    const result = await invoke(authenticateToken);

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'unauthorized');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 0);
});

test('authenticateToken rejects invalid and expired tokens without querying the database', async (t) => {
    const db = installPoolQuery(t);

    const invalid = await invoke(authenticateToken, createRequest({
        headers: { authorization: 'Bearer not.a.jwt' }
    }));
    const expired = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${expiredToken()}` }
    }));

    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.body.error, 'invalid_token');
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.body.error, 'token_expired');
    assert.equal(invalid.nextCalls, 0);
    assert.equal(expired.nextCalls, 0);
    assert.equal(db.calls(), 0);
});

test('authenticateToken rejects a cookie POST from an untrusted origin without querying the database', async (t) => {
    const db = installPoolQuery(t);
    const token = signToken();

    const result = await invoke(authenticateToken, createRequest({
        method: 'POST',
        headers: {
            cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
            origin: 'https://evil.example'
        }
    }));

    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error, 'invalid_origin');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 0);
});

test('authenticateToken returns 401 when the user row is absent', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('missing-user', []));

    const result = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'missing-user' })}` }
    }));

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'invalid_session');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 1);
});

test('authenticateToken returns 401 for an inactive user', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('inactive-user', [{
        id: 'inactive-user',
        role: 'admin',
        status: 'inactive',
        deleted_at: null,
        token_version: 0
    }]));

    const result = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'inactive-user' })}` }
    }));

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'invalid_session');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 1);
});

test('authenticateToken returns 401 for a deleted user', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('deleted-user', [{
        id: 'deleted-user',
        role: 'admin',
        status: 'active',
        deleted_at: '2026-09-06T00:00:00.000Z',
        token_version: 0
    }]));

    const result = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'deleted-user' })}` }
    }));

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'invalid_session');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 1);
});

test('authenticateToken returns 401 when the token version differs from the database', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('versioned-user', [{
        id: 'versioned-user',
        role: 'admin',
        status: 'active',
        deleted_at: null,
        token_version: 2
    }]));

    const result = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'versioned-user', token_version: 1 })}` }
    }));

    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'token_revoked');
    assert.equal(result.nextCalls, 0);
    assert.equal(db.calls(), 1);
});

test('authenticateToken uses the database role before authorizePermission checks an admin capability', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('cashier-user', [{
        id: 'cashier-user',
        role: 'cashier',
        status: 'active',
        deleted_at: null,
        token_version: 0
    }]));
    const request = createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'cashier-user', role: 'admin' })}` }
    });

    const authenticated = await invoke(authenticateToken, request);
    const authorized = await invoke(authorizePermission(PERMISSIONS.SETTINGS_MANAGE), request);

    assert.equal(authenticated.nextCalls, 1);
    assert.equal(request.user.role, 'cashier');
    assert.equal(authorized.statusCode, 403);
    assert.equal(authorized.body.error, 'forbidden');
    assert.equal(authorized.nextCalls, 0);
    assert.equal(db.calls(), 1);
});

test('authenticateToken calls next once for a valid token', async (t) => {
    const db = installPoolQuery(t, strictUserQuery('valid-user', [{
        id: 'valid-user',
        role: 'admin',
        status: 'active',
        deleted_at: null,
        token_version: 0
    }]));
    const request = createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'valid-user' })}` }
    });

    const result = await invoke(authenticateToken, request);

    assert.equal(result.nextCalls, 1);
    assert.equal(result.nextArgs[0].length, 0);
    assert.equal(request.user.id, 'valid-user');
    assert.equal(request.user.role, 'admin');
    assert.equal(db.calls(), 1);
});

test('authenticateToken propagates a database error to next', async (t) => {
    const expectedError = new Error('database unavailable');
    const db = installPoolQuery(t, async (sql, params) => {
        assert.equal(String(sql).replace(/\s+/g, ' ').trim(), userQuery);
        assert.deepEqual(params, ['db-error-user']);
        throw expectedError;
    });

    const result = await invoke(authenticateToken, createRequest({
        headers: { authorization: `Bearer ${signToken({ id: 'db-error-user' })}` }
    }));

    assert.equal(result.nextCalls, 1);
    assert.equal(result.nextArgs[0][0], expectedError);
    assert.equal(db.calls(), 1);
});
