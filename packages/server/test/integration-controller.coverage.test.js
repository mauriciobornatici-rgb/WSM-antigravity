import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import axios from 'axios';

import * as controller from '../controllers/integrationController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import tiendaNubeService from '../services/tiendanube.service.js';
import { getEnvConfig } from '../config/env.js';
import { encrypt, decrypt } from '../utils/crypto.js';

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const headers = {};
        const finish = (extra) => {
            settled = true;
            resolve({ status: statusCode, headers, ...extra });
        };
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            setHeader(name, value) {
                headers[name] = value;
            },
            json(body) {
                finish({ body });
                return this;
            },
            send(body) {
                finish({ body });
                return this;
            },
            redirect(url) {
                statusCode = 302;
                finish({ body: undefined, location: url });
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
    const calls = [];
    pool.query = async (sql, params = []) => {
        const statement = normalizeSql(sql);
        calls.push({ statement, params });
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
    return calls;
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

// Replaces singleton methods with recording stubs; restored in t.after. No network access.
function stubService(t, implementations) {
    const calls = {};
    for (const [name, impl] of Object.entries(implementations)) {
        const previous = tiendaNubeService[name];
        calls[name] = [];
        tiendaNubeService[name] = async (...args) => {
            calls[name].push(args);
            return impl(...args);
        };
        t.after(() => {
            tiendaNubeService[name] = previous;
        });
    }
    return calls;
}

function silenceConsole(t) {
    const previous = { log: console.log, error: console.error, warn: console.warn };
    const errors = [];
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => {
        errors.push(args);
    };
    t.after(() => {
        Object.assign(console, previous);
    });
    return errors;
}

function setWebhookUrl(t, url) {
    const config = getEnvConfig();
    const previous = config.tiendanubeWebhookUrl;
    config.tiendanubeWebhookUrl = url;
    t.after(() => {
        config.tiendanubeWebhookUrl = previous;
    });
}

function sign(rawBody, secret) {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- OAuth

test('authorizeTiendaNube answers 400 without a client id and redirects with a signed state otherwise', async (t) => {
    let rows = [{}];
    installPool(t, { poolQuery: async () => [rows] });

    const missing = await runHandler(controller.authorizeTiendaNube, { user: { id: 'u1' } });
    assert.equal(missing.status, 400);

    rows = [{ tiendanube_client_id: '1234' }];
    const ok = await runHandler(controller.authorizeTiendaNube, { user: { id: 'u1' } });
    assert.equal(ok.status, 302);
    const url = new URL(ok.location);
    assert.equal(url.origin + url.pathname, 'https://www.tiendanube.com/apps/1234/authorize');
    const state = url.searchParams.get('state');
    assert.equal(tiendaNubeService.verifyOAuthState(state).userId, 'u1');

    const anonymous = await runHandler(controller.authorizeTiendaNube);
    const anonState = new URL(anonymous.location).searchParams.get('state');
    assert.equal(tiendaNubeService.verifyOAuthState(anonState).userId, null);
});

test('callbackTiendaNube validates code and state before anything else', async (t) => {
    installPool(t);
    const noCode = await runHandler(controller.callbackTiendaNube, { query: { state: 's' } });
    assert.equal(noCode.status, 400);
    const noState = await runHandler(controller.callbackTiendaNube, { query: { code: 'c' } });
    assert.equal(noState.status, 400);
    await assert.rejects(
        runHandler(controller.callbackTiendaNube, { query: { code: 'c', state: 'forged.state' } }),
        /Invalid Tiendanube OAuth state/
    );
});

test('callbackTiendaNube answers 400 when the OAuth credentials are not configured', async (t) => {
    installPool(t, { poolQuery: async () => [[]] });
    const state = tiendaNubeService.createOAuthState({ userId: 'u1' });
    const result = await runHandler(controller.callbackTiendaNube, { query: { code: 'c', state } });
    assert.equal(result.status, 400);
});

test('callbackTiendaNube stores the encrypted token, audits and redirects with webhook status', async (t) => {
    const settings = [{ id: 9, tiendanube_client_id: 'cid', tiendanube_client_secret: encrypt('shh') }];
    const poolCalls = installPool(t, { poolQuery: async (statement) => (statement.startsWith('SELECT') ? [settings] : [{}]) });
    const audit = installAudit(t);
    silenceConsole(t);
    setWebhookUrl(t, 'https://erp.example.com/api/webhooks/tiendanube');
    const postCalls = [];
    const previousPost = axios.post;
    axios.post = async (...args) => {
        postCalls.push(args);
        return { data: { access_token: 'tok', user_id: 4321 } };
    };
    t.after(() => {
        axios.post = previousPost;
    });
    const serviceCalls = stubService(t, { ensureOrderWebhook: () => ({ configured: true }) });
    const state = tiendaNubeService.createOAuthState({ userId: 'u7' });

    const result = await runHandler(controller.callbackTiendaNube, { query: { code: 'the-code', state } });

    assert.equal(postCalls[0][1].client_secret, 'shh', 'client secret is decrypted before the token exchange');
    assert.equal(postCalls[0][1].code, 'the-code');
    assert.equal(postCalls[0][2].timeout, 10000);
    const update = poolCalls.find((call) => call.statement.startsWith('UPDATE company_settings'));
    assert.notEqual(update.params[0], 'tok');
    assert.equal(decrypt(update.params[0]), 'tok');
    assert.deepEqual(update.params.slice(1), [4321, 9]);
    assert.equal(audit[0].entry.action, 'OAUTH_TIENDANUBE_SUCCESS');
    assert.equal(audit[0].entry.user_id, 'u7');
    assert.deepEqual(serviceCalls.ensureOrderWebhook[0], ['https://erp.example.com/api/webhooks/tiendanube']);
    assert.equal(result.status, 302);
    const location = new URL(result.location);
    assert.equal(location.pathname, '/online-store');
    assert.equal(location.searchParams.get('success'), '1');
    assert.equal(location.searchParams.get('webhook'), 'configured');
});

test('callbackTiendaNube reports webhook not_configured, unconfigured and error states', async (t) => {
    const settings = [{ id: 1, tiendanube_client_id: 'cid', tiendanube_client_secret: encrypt('shh') }];
    installPool(t, { poolQuery: async (statement) => (statement.startsWith('SELECT') ? [settings] : [{}]) });
    installAudit(t);
    const errors = silenceConsole(t);
    const previousPost = axios.post;
    axios.post = async () => ({ data: { access_token: 'tok', user_id: 1 } });
    t.after(() => {
        axios.post = previousPost;
    });
    let ensure = () => ({ configured: false });
    stubService(t, { ensureOrderWebhook: () => ensure() });
    const state = () => tiendaNubeService.createOAuthState();

    const noUrl = await runHandler(controller.callbackTiendaNube, { query: { code: 'c', state: state() } });
    assert.equal(new URL(noUrl.location).searchParams.get('webhook'), 'not_configured');

    setWebhookUrl(t, 'https://erp.example.com/hook');
    const notConfigured = await runHandler(controller.callbackTiendaNube, { query: { code: 'c', state: state() } });
    assert.equal(new URL(notConfigured.location).searchParams.get('webhook'), 'not_configured');

    ensure = () => {
        throw new Error('remote 500');
    };
    const failed = await runHandler(controller.callbackTiendaNube, { query: { code: 'c', state: state() } });
    assert.equal(new URL(failed.location).searchParams.get('webhook'), 'error');
    assert.equal(failed.status, 302, 'token is kept even if webhook registration fails');
    assert.ok(errors.length >= 1);
});

test('callbackTiendaNube answers 500 when the token exchange fails or is incomplete', async (t) => {
    const settings = [{ id: 1, tiendanube_client_id: 'cid', tiendanube_client_secret: encrypt('shh') }];
    const poolCalls = installPool(t, { poolQuery: async () => [settings] });
    silenceConsole(t);
    const previousPost = axios.post;
    let response = { data: { access_token: 'tok' } };
    axios.post = async () => {
        if (response instanceof Error) throw response;
        return response;
    };
    t.after(() => {
        axios.post = previousPost;
    });

    const incomplete = await runHandler(controller.callbackTiendaNube, {
        query: { code: 'c', state: tiendaNubeService.createOAuthState() }
    });
    assert.equal(incomplete.status, 500);

    const upstream = new Error('network');
    upstream.response = { data: { error: 'bad' } };
    response = upstream;
    const failed = await runHandler(controller.callbackTiendaNube, {
        query: { code: 'c', state: tiendaNubeService.createOAuthState() }
    });
    assert.equal(failed.status, 500);
    assert.equal(poolCalls.some((call) => call.statement.startsWith('UPDATE')), false);
});

// -------------------------------------------------------------- Webhook

test('webhook answers 503 when Tiendanube credentials are not configured', async (t) => {
    stubService(t, { getCredentials: () => null });
    const result = await runHandler(controller.webhookTiendaNube, {
        body: { event: 'order/created' },
        rawBody: Buffer.from('{}'),
        headers: { 'x-linkedstore-hmac-sha256': 'abc' }
    });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'tiendanube_not_configured' });

    stubService(t, { getCredentials: () => ({ clientSecret: '' }) });
    const noSecret = await runHandler(controller.webhookTiendaNube, { rawBody: Buffer.from('{}') });
    assert.equal(noSecret.status, 503);
});

test('webhook refuses to verify without the raw body (never re-serializes the parsed JSON)', async (t) => {
    const errors = silenceConsole(t);
    const calls = stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => ({ duplicate: false })
    });
    const body = { event: 'order/created', id: 1 };
    const signature = sign(JSON.stringify(body), 'secret');

    const result = await runHandler(controller.webhookTiendaNube, {
        body,
        headers: { 'x-linkedstore-hmac-sha256': signature }
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'raw_body_unavailable' });
    assert.equal(calls.recordWebhookEvent.length, 0);
    assert.equal(errors.length, 1);
});

test('webhook answers 401 for missing, malformed or wrong HMAC signatures and records nothing', async (t) => {
    silenceConsole(t);
    const calls = stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => ({ duplicate: false })
    });
    const rawBody = Buffer.from(JSON.stringify({ event: 'order/created', id: 1 }));
    const goodSignature = sign(rawBody, 'secret');
    const attempts = [
        undefined,
        '',
        'deadbeef',
        goodSignature.slice(0, -2),
        goodSignature.toUpperCase().replace(/[A-F]/g, '0'),
        sign(rawBody, 'other-secret'),
        sign(Buffer.from('tampered'), 'secret')
    ];
    for (const signature of attempts) {
        const result = await runHandler(controller.webhookTiendaNube, {
            body: { event: 'order/created', id: 1 },
            rawBody,
            headers: signature === undefined ? {} : { 'x-linkedstore-hmac-sha256': signature }
        });
        assert.equal(result.status, 401, `signature ${String(signature)} must be rejected`);
        assert.deepEqual(result.body, { error: 'invalid_tiendanube_signature' });
    }
    assert.equal(calls.recordWebhookEvent.length, 0);
});

test('webhook with a valid HMAC records the event and processes it asynchronously (202)', async (t) => {
    silenceConsole(t);
    const payload = { event: 'order/created', id: 77, store_id: '5' };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const record = { duplicate: false, id: 'ev1' };
    const calls = stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => record,
        processRecordedWebhookEvent: () => ({ status: 'processed' })
    });

    const result = await runHandler(controller.webhookOrdersCreated, {
        body: payload,
        rawBody,
        headers: { 'x-linkedstore-hmac-sha256': sign(rawBody, 'secret') }
    });
    assert.equal(controller.webhookOrdersCreated, controller.webhookTiendaNube);
    assert.equal(result.status, 202);
    assert.equal(result.body, 'OK');
    assert.deepEqual(calls.recordWebhookEvent[0], [payload]);

    await tick();
    await tick();
    assert.equal(calls.processRecordedWebhookEvent.length, 1);
    assert.equal(calls.processRecordedWebhookEvent[0][0], record);
});

test('webhook logs deferred processing failures without affecting the response', async (t) => {
    const errors = silenceConsole(t);
    const payload = { event: 'order/paid', id: 2 };
    const rawBody = Buffer.from(JSON.stringify(payload));
    stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => ({ duplicate: false }),
        processRecordedWebhookEvent: () => {
            throw new Error('deferred failure');
        }
    });
    const result = await runHandler(controller.webhookTiendaNube, {
        body: payload,
        rawBody,
        headers: { 'x-linkedstore-hmac-sha256': sign(rawBody, 'secret') }
    });
    assert.equal(result.status, 202);
    await tick();
    await tick();
    assert.ok(errors.some((args) => String(args[0]).includes('Deferred processing failed')));
});

test('webhook answers 200 for duplicates without reprocessing and 500 when recording fails', async (t) => {
    const errors = silenceConsole(t);
    const payload = { event: 'order/created', id: 3 };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const headers = { 'x-linkedstore-hmac-sha256': sign(rawBody, 'secret') };
    let record = () => ({ duplicate: true });
    const calls = stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => record(),
        processRecordedWebhookEvent: () => ({ status: 'x' })
    });

    const duplicate = await runHandler(controller.webhookTiendaNube, { body: payload, rawBody, headers });
    assert.equal(duplicate.status, 200);
    await tick();
    assert.equal(calls.processRecordedWebhookEvent.length, 0);

    record = () => {
        throw new Error('db down');
    };
    const failed = await runHandler(controller.webhookTiendaNube, { body: payload, rawBody, headers });
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: 'webhook_processing_failed' });
    assert.ok(errors.length >= 1);
});

test('webhook tolerates a missing parsed body when the signature still matches the raw bytes', async (t) => {
    silenceConsole(t);
    const rawBody = Buffer.from('{}');
    const calls = stubService(t, {
        getCredentials: () => ({ clientSecret: 'secret' }),
        recordWebhookEvent: () => ({ duplicate: true })
    });
    const result = await runHandler(controller.webhookTiendaNube, {
        body: undefined,
        rawBody,
        headers: { 'x-linkedstore-hmac-sha256': sign(rawBody, 'secret') }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(calls.recordWebhookEvent[0], [{}]);
});

// ------------------------------------------------- Sync / status / config

test('syncRecentOrdersController returns the result or a 500 with the error message', async (t) => {
    silenceConsole(t);
    let impl = () => ({ imported: 3 });
    stubService(t, { syncRecentOrders: () => impl() });
    const ok = await runHandler(controller.syncRecentOrdersController);
    assert.deepEqual(ok.body, { success: true, imported: 3 });

    impl = () => {
        throw new Error('rate limited');
    };
    const failed = await runHandler(controller.syncRecentOrdersController);
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: 'rate limited' });

    impl = () => {
        throw Object.assign(new Error(''), {});
    };
    const generic = await runHandler(controller.syncRecentOrdersController);
    assert.equal(generic.body.error, 'Error sincronizando ordenes');
});

test('getTiendaNubeStatusController passes the configured webhook URL to the service', async (t) => {
    setWebhookUrl(t, 'https://erp.example.com/hook');
    const calls = stubService(t, { getIntegrationStatus: () => ({ connected: true }) });
    const result = await runHandler(controller.getTiendaNubeStatusController);
    assert.deepEqual(result.body, { connected: true });
    assert.deepEqual(calls.getIntegrationStatus[0], ['https://erp.example.com/hook']);
});

test('getTiendaNubeConfigController never exposes the client secret', async (t) => {
    installPool(t, {
        poolQuery: async () => [[{
            tiendanube_client_id: 'cid',
            tiendanube_client_secret: encrypt('top-secret'),
            tiendanube_location_id: 'loc'
        }]]
    });
    const result = await runHandler(controller.getTiendaNubeConfigController);
    assert.deepEqual(result.body, { clientId: 'cid', clientSecretConfigured: true, locationId: 'loc' });
    assert.ok(!JSON.stringify(result.body).includes('top-secret'));
});

test('getTiendaNubeConfigController defaults to empty values when no settings row exists', async (t) => {
    installPool(t, { poolQuery: async () => [[]] });
    const result = await runHandler(controller.getTiendaNubeConfigController);
    assert.deepEqual(result.body, { clientId: '', clientSecretConfigured: false, locationId: '' });
});

test('updateTiendaNubeConfigController encrypts the secret, locks the row and audits without secrets', async (t) => {
    const tracked = createTrackedConnection(async (statement) => {
        if (statement.startsWith('SELECT')) {
            return [[{ tiendanube_client_id: 'cid', tiendanube_client_secret: 'enc', tiendanube_location_id: 'loc' }]];
        }
        return [{}];
    });
    installPool(t, { tracked });
    const audit = installAudit(t);

    const result = await runHandler(controller.updateTiendaNubeConfigController, {
        body: { clientId: 'cid', clientSecret: '  new-secret  ', locationId: 'loc' },
        user: { id: 'admin1' }
    });

    assert.equal(result.status, 200);
    assert.match(tracked.calls[0].statement, /FOR UPDATE$/);
    const upsert = tracked.calls[1];
    assert.match(upsert.statement, /COALESCE\(VALUES\(tiendanube_client_secret\)/);
    assert.equal(upsert.params[0], 'cid');
    assert.notEqual(upsert.params[1], 'new-secret');
    assert.equal(decrypt(upsert.params[1]), 'new-secret');
    assert.deepEqual(tracked.counts, { begin: 1, commit: 1, rollback: 0, release: 1 });
    assert.equal(audit[0].entry.action, 'UPDATE_TIENDANUBE_CONFIG');
    assert.equal(audit[0].connection, tracked.connection);
    assert.ok(!JSON.stringify(audit[0].entry).includes('new-secret'));
    assert.equal(audit[0].entry.new_values.clientSecretConfigured, true);
});

test('updateTiendaNubeConfigController keeps the stored secret when a blank one is sent', async (t) => {
    const tracked = createTrackedConnection(async (statement) => (statement.startsWith('SELECT') ? [[{}]] : [{}]));
    installPool(t, { tracked });
    installAudit(t);

    await runHandler(controller.updateTiendaNubeConfigController, {
        body: { clientId: 'cid', clientSecret: '   ', locationId: 'loc' }
    });
    assert.equal(tracked.calls[1].params[1], null);

    await runHandler(controller.updateTiendaNubeConfigController, { body: { clientId: 'cid', locationId: 'loc' } });
    assert.equal(tracked.calls[4].params[1], null);
});

test('updateTiendaNubeConfigController rolls back and releases on failure', async (t) => {
    const tracked = createTrackedConnection(async () => {
        throw new Error('lock timeout');
    });
    installPool(t, { tracked });
    await assert.rejects(
        runHandler(controller.updateTiendaNubeConfigController, { body: { clientId: 'c', clientSecret: 's', locationId: 'l' } }),
        /lock timeout/
    );
    assert.deepEqual(tracked.counts, { begin: 1, commit: 0, rollback: 1, release: 1 });
});

test('ensureTiendaNubeWebhookController registers the webhook and audits it', async (t) => {
    setWebhookUrl(t, 'https://erp.example.com/hook');
    const calls = stubService(t, { ensureOrderWebhook: () => ({ configured: true }) });
    const audit = installAudit(t);
    const result = await runHandler(controller.ensureTiendaNubeWebhookController, { user: { id: 'u1' } });
    assert.deepEqual(result.body, { success: true, configured: true });
    assert.deepEqual(calls.ensureOrderWebhook[0], ['https://erp.example.com/hook']);
    assert.equal(audit[0].entry.action, 'ENSURE_TIENDANUBE_WEBHOOK');
});

test('disconnectTiendaNubeController refuses when credentials come from the environment', async (t) => {
    const previous = process.env.TIENDANUBE_ACCESS_TOKEN;
    process.env.TIENDANUBE_ACCESS_TOKEN = 'env-token';
    t.after(() => {
        if (previous === undefined) delete process.env.TIENDANUBE_ACCESS_TOKEN;
        else process.env.TIENDANUBE_ACCESS_TOKEN = previous;
    });
    installPool(t);
    const result = await runHandler(controller.disconnectTiendaNubeController);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'tiendanube_environment_credentials');
});

test('disconnectTiendaNubeController also refuses when only the store id comes from the environment', async (t) => {
    const previousToken = process.env.TIENDANUBE_ACCESS_TOKEN;
    const previousStore = process.env.TIENDANUBE_STORE_ID;
    delete process.env.TIENDANUBE_ACCESS_TOKEN;
    process.env.TIENDANUBE_STORE_ID = '99';
    t.after(() => {
        if (previousToken !== undefined) process.env.TIENDANUBE_ACCESS_TOKEN = previousToken;
        if (previousStore === undefined) delete process.env.TIENDANUBE_STORE_ID;
        else process.env.TIENDANUBE_STORE_ID = previousStore;
    });
    installPool(t);
    const result = await runHandler(controller.disconnectTiendaNubeController);
    assert.equal(result.status, 409);
});

test('disconnectTiendaNubeController clears the token even if removing the remote webhook fails', async (t) => {
    delete process.env.TIENDANUBE_ACCESS_TOKEN;
    delete process.env.TIENDANUBE_STORE_ID;
    const errors = silenceConsole(t);
    const poolCalls = installPool(t, { poolQuery: async () => [{}] });
    const audit = installAudit(t);
    let impl = () => ({ removed: 2 });
    stubService(t, { removeOrderWebhook: () => impl() });

    const ok = await runHandler(controller.disconnectTiendaNubeController, { user: { id: 'u1' } });
    assert.deepEqual(ok.body, { success: true, removed: 2 });
    assert.match(poolCalls[0].statement, /tiendanube_access_token = NULL.*'disconnected'/);

    impl = () => {
        throw new Error('remote gone');
    };
    const degraded = await runHandler(controller.disconnectTiendaNubeController);
    assert.deepEqual(degraded.body, { success: true, removed: 0 });
    assert.equal(poolCalls.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(audit[0].entry.action, 'DISCONNECT_TIENDANUBE');
});

test('failed-sync endpoints surface results and map errors to 500', async (t) => {
    let retry = () => ({});
    let retryAll = () => ({});
    const calls = stubService(t, {
        getFailedSyncs: () => [{ id: 1 }],
        retrySync: (id) => retry(id),
        processFailedSyncs: () => retryAll()
    });

    const list = await runHandler(controller.getFailedSyncsController);
    assert.deepEqual(list.body, [{ id: 1 }]);

    const okRetry = await runHandler(controller.retryFailedSyncController, { params: { id: '5' } });
    assert.deepEqual(okRetry.body, { success: true, message: 'Reintento exitoso' });
    assert.deepEqual(calls.retrySync[0], ['5']);

    retry = () => {
        throw new Error('still failing');
    };
    const badRetry = await runHandler(controller.retryFailedSyncController, { params: { id: '5' } });
    assert.equal(badRetry.status, 500);
    assert.deepEqual(badRetry.body, { error: 'still failing' });
    retry = () => {
        throw new Error('');
    };
    const genericRetry = await runHandler(controller.retryFailedSyncController, { params: { id: '5' } });
    assert.equal(genericRetry.body.error, 'Error al reintentar la sincronización');

    const okAll = await runHandler(controller.retryAllFailedSyncsController);
    assert.deepEqual(okAll.body, { success: true, message: 'Cola de reintentos ejecutada' });
    retryAll = () => {
        throw new Error('queue broken');
    };
    const badAll = await runHandler(controller.retryAllFailedSyncsController);
    assert.equal(badAll.status, 500);
    assert.equal(badAll.body.error, 'queue broken');
    retryAll = () => {
        throw new Error('');
    };
    const genericAll = await runHandler(controller.retryAllFailedSyncsController);
    assert.equal(genericAll.body.error, 'Error al procesar la cola de reintentos');
});

test('autoLinkCatalogController audits success and reports failures as 500', async (t) => {
    silenceConsole(t);
    const audit = installAudit(t);
    let impl = () => ({ linked: 4 });
    stubService(t, { autoLinkCatalog: () => impl() });

    const ok = await runHandler(controller.autoLinkCatalogController, { user: { id: 'u1' } });
    assert.deepEqual(ok.body, { success: true, linked: 4 });
    assert.equal(audit[0].entry.action, 'AUTOLINK_TIENDANUBE_CATALOG_SUCCESS');

    impl = () => {
        throw new Error('no catalog');
    };
    const failed = await runHandler(controller.autoLinkCatalogController);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error, 'no catalog');
    impl = () => {
        throw new Error('');
    };
    const generic = await runHandler(controller.autoLinkCatalogController);
    assert.equal(generic.body.error, 'Error vinculando catálogo automáticamente');
    assert.equal(audit.length, 1);
});

// ------------------------------------------------------- Operations hub

test('paginated listings set pagination headers and return rows only', async (t) => {
    stubService(t, {
        listCatalog: () => ({ rows: [{ id: 'f1' }], total: 51 }),
        listOperationsOrders: () => ({ rows: [], total: 0 }),
        listOperationsCustomers: () => ({ rows: [{ id: 'c1' }], total: 3 }),
        listFulfillments: () => ({ rows: [{ id: 'x' }], total: 10 })
    });

    const catalog = await runHandler(controller.listCatalogController, { query: { page: '2', limit: '25' } });
    assert.deepEqual(catalog.body, [{ id: 'f1' }]);
    assert.equal(catalog.headers['X-Total-Count'], '51');
    assert.equal(catalog.headers['X-Page'], '2');
    assert.equal(catalog.headers['X-Limit'], '25');
    assert.equal(catalog.headers['X-Total-Pages'], '3');

    const orders = await runHandler(controller.listOperationsOrdersController);
    assert.equal(orders.headers['X-Page'], '1');
    assert.equal(orders.headers['X-Limit'], '25');
    assert.equal(orders.headers['X-Total-Pages'], '1');

    const customers = await runHandler(controller.listOperationsCustomersController, { query: { limit: '2' } });
    assert.equal(customers.headers['X-Total-Pages'], '2');

    const fulfillments = await runHandler(controller.listFulfillmentsController);
    assert.deepEqual(fulfillments.body, [{ id: 'x' }]);
});

test('overview, analytics, sync center and fulfillment sync proxy to the service', async (t) => {
    stubService(t, {
        getOperationsOverview: () => ({ a: 1 }),
        getOperationsAnalytics: () => ({ b: 2 }),
        getSyncCenter: () => ({ c: 3 }),
        syncAllFulfillments: () => ({ synced: 5 })
    });
    assert.deepEqual((await runHandler(controller.getOperationsOverviewController)).body, { a: 1 });
    assert.deepEqual((await runHandler(controller.getOperationsAnalyticsController)).body, { b: 2 });
    assert.deepEqual((await runHandler(controller.getSyncCenterController)).body, { c: 3 });
    assert.deepEqual((await runHandler(controller.syncFulfillmentsController)).body, { success: true, synced: 5 });
});

test('createCatalogController answers 201 and audits only summary fields', async (t) => {
    const audit = installAudit(t);
    const calls = stubService(t, {
        createCatalogFamily: () => ({ id: 'f1', name: 'Remera', visibility: 'draft', variant_count: 3, secret: 'x' })
    });
    const result = await runHandler(controller.createCatalogController, { body: { name: 'Remera' }, user: { id: 'u1' } });
    assert.equal(result.status, 201);
    assert.deepEqual(calls.createCatalogFamily[0], [{ name: 'Remera' }]);
    assert.deepEqual(audit[0].entry.new_values, { name: 'Remera', visibility: 'draft', variant_count: 3 });
    assert.equal(audit[0].entry.entity_id, 'f1');
});

test('updateCatalogController answers 404 when the family does not exist and audits otherwise', async (t) => {
    const audit = installAudit(t);
    let result = null;
    stubService(t, { updateCatalogFamily: () => result });

    const missing = await runHandler(controller.updateCatalogController, { params: { id: 'nope' }, body: {} });
    assert.equal(missing.status, 404);
    assert.equal(audit.length, 0);

    result = { id: 'f1' };
    const ok = await runHandler(controller.updateCatalogController, { params: { id: 'f1' }, body: { name: 'N' } });
    assert.deepEqual(ok.body, { id: 'f1' });
    assert.equal(audit[0].entry.action, 'UPDATE_TIENDANUBE_CATALOG_FAMILY');
});

test('archiveCatalogController answers 404 or archives and audits', async (t) => {
    const audit = installAudit(t);
    let archived = false;
    stubService(t, { archiveCatalogFamily: () => archived });

    const missing = await runHandler(controller.archiveCatalogController, { params: { id: 'nope' } });
    assert.equal(missing.status, 404);
    assert.equal(audit.length, 0);

    archived = true;
    const ok = await runHandler(controller.archiveCatalogController, { params: { id: 'f1' } });
    assert.deepEqual(ok.body, { success: true });
    assert.equal(audit[0].entry.action, 'ARCHIVE_TIENDANUBE_CATALOG_FAMILY');
});

test('publishCatalogController and importCatalogController audit their outcome', async (t) => {
    const audit = installAudit(t);
    const calls = stubService(t, {
        publishCatalogFamily: () => ({ remoteProductId: 'r1' }),
        importRemoteCatalog: () => ({ runId: 'run1', processed: 5, succeeded: 4, failures: [{ id: 1 }] })
    });

    const published = await runHandler(controller.publishCatalogController, { params: { id: 'f1' } });
    assert.deepEqual(published.body, { success: true, remoteProductId: 'r1' });
    assert.deepEqual(audit[0].entry.new_values, { remote_product_id: 'r1' });

    const imported = await runHandler(controller.importCatalogController, { body: { full: true } });
    assert.equal(imported.body.success, true);
    assert.deepEqual(calls.importRemoteCatalog[0], [{ full: true }]);
    assert.deepEqual(audit[1].entry.new_values, { processed: 5, succeeded: 4, failures: 1 });

    await runHandler(controller.importCatalogController, { body: undefined });
    assert.deepEqual(calls.importRemoteCatalog[1], [{}]);
});

test('fulfillment update and tracking events pass params and audit', async (t) => {
    const audit = installAudit(t);
    const calls = stubService(t, {
        updateFulfillment: () => ({ id: 'ff1' }),
        createTrackingEvent: () => ({ id: 'ev1' })
    });

    const updated = await runHandler(controller.updateFulfillmentController, {
        params: { id: 'ff1' },
        body: { status: 'shipped' },
        user: { id: 'u1' }
    });
    assert.deepEqual(updated.body, { id: 'ff1' });
    assert.deepEqual(calls.updateFulfillment[0], ['ff1', { status: 'shipped' }]);
    assert.equal(audit[0].entry.action, 'UPDATE_TIENDANUBE_FULFILLMENT');

    const tracking = await runHandler(controller.createTrackingEventController, {
        params: { id: 'ff1' },
        body: { code: 'T1' }
    });
    assert.equal(tracking.status, 201);
    assert.deepEqual(calls.createTrackingEvent[0], ['ff1', { code: 'T1' }]);
    assert.equal(audit[1].entry.action, 'CREATE_TIENDANUBE_TRACKING_EVENT');
    assert.equal(audit[1].entry.user_id, null);
});
