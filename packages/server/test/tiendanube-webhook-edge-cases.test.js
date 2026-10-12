import test from 'node:test';
import assert from 'node:assert/strict';

import { TiendaNubeService } from '../services/tiendanube.service.js';

test('Tiendanube request helpers honor environment overrides and HTTP verb shapes', async () => {
    const calls = [];
    const http = {
        get: async (...args) => { calls.push(['get', ...args]); return { data: 1 }; },
        delete: async (...args) => { calls.push(['delete', ...args]); return { data: 1 }; },
        post: async (...args) => { calls.push(['post', ...args]); return { data: 1 }; }
    };
    const service = new TiendaNubeService({ db: {}, http, env: {
        TIENDANUBE_API_HOST: 'https://tn.test', TIENDANUBE_API_VERSION: 'v1', TIENDANUBE_HTTP_TIMEOUT_MS: '2500'
    } });
    const creds = { storeId: 's', accessToken: 'token', userAgent: 'WSM' };
    assert.equal(service.apiUrl('s', '/orders'), 'https://tn.test/v1/s/orders');
    assert.equal(service.requestOptions(creds).timeout, 2500);
    await service.apiRequest('get', creds, '/orders');
    await service.apiRequest('delete', creds, '/orders/1');
    await service.apiRequest('post', creds, '/orders', { id: 1 });
    assert.equal(calls[0].length, 3);
    assert.equal(calls[2][2].id, 1);
    assert.equal(service.normalizeTiendanubeId('123'), 123);
    assert.equal(service.normalizeTiendanubeId(''), '');
    assert.equal(service.normalizeTiendanubeId('abc'), 'abc');
});

test('OAuth state rejects missing secrets, malformed signatures and expired payloads', () => {
    const missing = new TiendaNubeService({ env: {}, http: {} });
    assert.throws(() => missing.getStateSecret(), (e) => e.errorCode === 'TIENDANUBE_STATE_SECRET_REQUIRED');
    const service = new TiendaNubeService({ env: { TIENDANUBE_STATE_SECRET: 'secret' }, http: {} });
    assert.throws(() => service.verifyOAuthState(''), (e) => e.errorCode === 'TIENDANUBE_INVALID_STATE');
    assert.equal(service.safeEqual('a', 'bb'), false);
    const encoded = Buffer.from(JSON.stringify({ exp: 1 }), 'utf8').toString('base64url');
    const expired = `${encoded}.${service.signValue(encoded, 'secret')}`;
    assert.throws(() => service.verifyOAuthState(expired), (e) => e.errorCode === 'TIENDANUBE_EXPIRED_STATE');
    assert.equal(service.createOAuthState().split('.').length, 2);
});

test('webhook signature and payload normalization cover required and alternative fields', () => {
    const service = new TiendaNubeService({ http: {} });
    assert.equal(service.verifyWebhookSignature(null, 'x', 's'), false);
    assert.equal(service.verifyWebhookSignature('x', null, 's'), false);
    assert.throws(() => service.normalizeWebhookPayload({}), (e) => e.errorCode === 'TIENDANUBE_INVALID_WEBHOOK_PAYLOAD');
    assert.deepEqual(service.normalizeWebhookPayload({ storeId: ' s ', event: 'order/paid', resource_id: 4 }), {
        storeId: 's', event: 'order/paid', resourceId: '4'
    });
    assert.deepEqual(service.normalizeWebhookPayload({ store_id: 1, event: 'order/paid', id: 2, order_id: 3 }), {
        storeId: '1', event: 'order/paid', resourceId: '2'
    });
});

test('recordWebhookEvent reopens retryable failures and identifies terminal duplicates', async () => {
    let mode = 'retry';
    const service = new TiendaNubeService({ db: { query: async (sql) => {
        const statement = String(sql);
        if (statement.includes('INSERT INTO tiendanube_webhook_events')) {
            const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error;
        }
        if (statement.includes('SELECT id, status')) {
            if (mode === 'retry') return [[{ id: 'e', status: 'failed', attempts: 1, max_attempts: 3 }]];
            if (mode === 'terminal') return [[{ id: 'e', status: 'processed', attempts: 1, max_attempts: 3 }]];
            return [[]];
        }
        if (statement.includes('UPDATE tiendanube_webhook_events')) return [{ affectedRows: mode === 'retry' ? 1 : 0 }];
        return [[]];
    } }, http: {} });
    const retry = await service.recordWebhookEvent({ store_id: 1, event: 'order/paid', id: 2 });
    assert.equal(retry.retried, true);
    assert.equal(retry.duplicate, false);
    mode = 'terminal';
    const terminal = await service.recordWebhookEvent({ store_id: 1, event: 'order/paid', id: 2 });
    assert.equal(terminal.duplicate, true);
    assert.equal(terminal.status, 'processed');
    mode = 'unknown';
    const unknown = await service.recordWebhookEvent({ store_id: 1, event: 'order/paid', id: 2 });
    assert.equal(unknown.eventId, null);
});

test('recordWebhookEvent rethrows non-duplicate database failures and mark supports no-op', async () => {
    const service = new TiendaNubeService({ db: { query: async () => { const e = new Error('db'); e.code = 'OTHER'; throw e; } }, http: {} });
    await assert.rejects(() => service.recordWebhookEvent({ store_id: 1, event: 'x', id: 2 }), /db/);
    await service.markWebhookEvent(null, 'processed');
});

test('recorded webhooks process product, customer, app, fulfillment and ignored events', async () => {
    const queries = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        queries.push({ sql: statement, params });
        if (statement.startsWith('UPDATE tiendanube_webhook_events') && statement.includes("status = 'processing'")) return [{ affectedRows: 1 }];
        return [[]];
    } }, http: {} });
    const marked = [];
    service.markWebhookEvent = async (...args) => { marked.push(args); };
    service.importRemoteProduct = async (id) => ({ id });
    service.importRemoteCustomer = async (id) => ({ id });
    service.syncFulfillmentsForExternalOrder = async (id) => ({ id });
    const base = { eventId: 'e', storeId: 's', resourceId: 'r', duplicate: false };
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'product/updated' }, {}, {})).productId, 'r');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'product/deleted' }, {}, {})).productId, 'r');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'customer/updated' }, {}, {})).customerId, 'r');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'customer/deleted' }, {}, {})).customerId, 'r');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'app/uninstalled' }, {}, {})).connectionStatus, 'uninstalled');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'fulfillment_order/status_updated' }, { order_id: 9, fulfillment_id: 'f' }, {})).fulfillmentId, 'f');
    assert.equal((await service.processRecordedWebhookEvent({ ...base, event: 'unknown/event' }, {}, {})).status, 'ignored');
    assert.equal(marked.length, 7);
    assert.ok(queries.some((call) => call.sql.includes('DELETE FROM tiendanube_customers')));
});

test('recorded webhooks skip duplicates and persist processing failures', async () => {
    const duplicateService = new TiendaNubeService({ db: {}, http: {} });
    assert.deepEqual(await duplicateService.processRecordedWebhookEvent({ duplicate: true }, {}, {}), { status: 'duplicate' });
    const claimService = new TiendaNubeService({ db: { query: async () => [{ affectedRows: 0 }] }, http: {} });
    assert.deepEqual(await claimService.processRecordedWebhookEvent({ eventId: 'e', duplicate: false }, {}, {}), { status: 'duplicate' });

    const calls = [];
    const failureService = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("status = 'processing'")) return [{ affectedRows: 1 }];
        return [[]];
    } }, http: {} });
    failureService.fetchOrder = async () => { throw new Error('remote failed'); };
    await assert.rejects(
        () => failureService.processRecordedWebhookEvent({ eventId: 'e', event: 'order/paid', resourceId: '1', storeId: 's' }, {}, {}),
        /remote failed/
    );
    assert.ok(calls.some((call) => call.params?.[0] === 'remote failed'));
});

test('fetchOrder enforces credentials and webhook store ownership', async () => {
    const service = new TiendaNubeService({ http: {} });
    service.getCredentials = async () => null;
    await assert.rejects(() => service.fetchOrder('1'), /Credenciales/);
    service.getCredentials = async () => ({ storeId: 'configured' });
    await assert.rejects(() => service.fetchOrder('1', 'other'), (e) => e.errorCode === 'TIENDANUBE_STORE_MISMATCH');
    service.apiRequest = async () => ({ data: { id: 1 } });
    assert.deepEqual(await service.fetchOrder('1', 'configured'), { id: 1 });
});

test('shipping and order import handle existing orders, SKU failures and local creation', async () => {
    assert.equal(new TiendaNubeService({ http: {} }).formatShippingAddress({}), null);
    const calls = [];
    let mode = 'existing';
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id FROM orders')) return mode === 'existing' ? [[{ id: 'local-order' }]] : [[]];
        if (String(sql).startsWith('SELECT id, vat_rate FROM products')) return mode === 'create' ? [[{ id: 'local-product', vat_rate: 21 }]] : [[]];
        return [[]];
    } }, http: {} });
    service.persistOrderMetadata = async () => {};
    await assert.rejects(() => service.importOrderPayload({}, {}), (e) => e.errorCode === 'TIENDANUBE_ORDER_ID_REQUIRED');
    assert.deepEqual(await service.importOrderPayload({ id: 1 }, {}), { status: 'already_imported', orderId: 'local-order' });
    mode = 'unlinked';
    await assert.rejects(
        () => service.importOrderPayload({ id: 2, number: 20, products: [{ id: 8 }, { sku: 'UNKNOWN' }] }, {}),
        (e) => e.errorCode === 'TIENDANUBE_UNLINKED_ITEMS' && e.statusCode === 422
    );
    mode = 'create';
    let createdPayload;
    const sales = { createOrder: async (payload) => { createdPayload = payload; return { id: 'new-order' }; } };
    const result = await service.importOrderPayload({
        id: 3, number: 30, total: '25', payment_status: 'paid', gateway: 'bank',
        billing_address: { name: 'Ana' }, shipping_address: { address: 'Calle', number: '1', city: 'CABA' },
        products: [{ sku: 'SKU', quantity: 0, price: 'bad' }]
    }, sales);
    assert.deepEqual(result, { status: 'created', orderId: 'new-order' });
    assert.equal(createdPayload.customer_name, 'Ana');
    assert.equal(createdPayload.items[0].quantity, 1);
    assert.equal('unit_price' in createdPayload.items[0], false);
    assert.equal(createdPayload.shipping_address, 'Calle, 1, CABA');
});

test('credentials fall back to environment and stock payload omits an unspecified location', async () => {
    const disconnected = new TiendaNubeService({ db: { query: async () => [[]] }, http: {}, env: {} });
    assert.equal(await disconnected.getCredentials(), null);
    const service = new TiendaNubeService({
        db: { query: async () => [[{ tiendanube_connection_status: 'suspended' }]] }, http: {},
        env: { TIENDANUBE_ACCESS_TOKEN: 'token', TIENDANUBE_STORE_ID: 'store', TIENDANUBE_CLIENT_ID: 'client', TIENDANUBE_CLIENT_SECRET: 'secret' }
    });
    const creds = await service.getCredentials();
    assert.equal(creds.storeId, 'store');
    assert.equal(creds.connectionStatus, 'suspended');
    assert.deepEqual(service.stockPayload('3', '4'), { action: 'replace', value: 3, id: 4 });
});

test('order metadata persists remote customer totals and fulfillment but never writes the status directly', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params }); return [[]];
    } }, http: {} });
    let fulfillments;
    service.persistFulfillments = async (_order, _external, values) => { fulfillments = values; };
    await service.persistOrderMetadata('o', {
        id: 1, number: 20, status: 'closed', payment_status: 'paid', shipping_status: 'fulfilled',
        contact_name: 'Contacto', contact_email: 'a@test', contact_phone: '1', contact_identification: '2',
        total: '50', created_at: 'bad', updated_at: '2026-08-22T12:00:00Z',
        customer: { id: 9, name: '', total_spent: 70, default_address: { city: 'CABA' } },
        fulfillment_orders: { results: [{ id: 'f' }] }, shipping_address: { name: 'Ana', city: 'CABA' }
    });
    assert.deepEqual(fulfillments, [{ id: 'f' }]);
    assert.equal(calls.filter((call) => call.sql.includes('tiendanube_customers')).length, 2);
    // The status goes through salesService.applyExternalStatus (stock effects), not an UPDATE.
    assert.equal(calls.some((call) => /\bstatus = COALESCE/.test(call.sql)), false);
    assert.equal(calls.some((call) => call.params?.includes('delivered')), false);
});

test('remote status is applied through the local transitions and a failure does not break the import', async () => {
    const service = new TiendaNubeService({ db: { query: async () => [[]] }, http: {} });
    const applied = [];
    const salesStub = { applyExternalStatus: async (orderId, status) => { applied.push([orderId, status]); } };
    await service.applyRemoteStatus('o-1', { status: 'open', shipping_status: 'fulfilled' }, salesStub);
    await service.applyRemoteStatus('o-2', { status: 'cancelled' }, salesStub);
    await service.applyRemoteStatus('o-3', { status: 'open' }, salesStub);
    assert.deepEqual(applied, [['o-1', 'delivered'], ['o-2', 'cancelled']]);

    // A failure now rethrows (prefixed with the order/status) instead of being swallowed and
    // logged, so the durable webhook queue can retry it.
    await assert.rejects(
        () => service.applyRemoteStatus('o-4', { status: 'closed' }, { applyExternalStatus: async () => { throw new Error('sin stock'); } }),
        /o-4.*sin stock/
    );
});

test('stock synchronization safely skips disconnected, missing, disabled and unlinked products', async () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
        const disconnected = new TiendaNubeService({ db: {}, http: {} });
        disconnected.getCredentials = async () => null;
        assert.equal(await disconnected.syncStock('p', 1), undefined);

        let mode = 'missing';
        const service = new TiendaNubeService({ db: { query: async () => {
            if (mode === 'missing') return [[]];
            if (mode === 'disabled') return [[{ tiendanube_sync_enabled: 0 }]];
            return [[{ tiendanube_sync_enabled: 1, tiendanube_product_id: null, tiendanube_variant_id: null }]];
        } }, http: {} });
        service.getCredentials = async () => ({ storeId: 's' });
        assert.equal(await service.syncStock('p', 1), undefined);
        mode = 'disabled';
        assert.equal(await service.syncStock('p', 1), undefined);
        mode = 'unlinked';
        assert.equal(await service.syncStock('p', 1), undefined);
    } finally {
        console.log = originalLog;
    }
});

test('manual failed-stock retry validates records, claims and terminal failure state', async () => {
    const noCreds = new TiendaNubeService({ db: {}, http: {} });
    noCreds.getCredentials = async () => null;
    await assert.rejects(() => noCreds.retrySync('x'), /Credenciales/);

    let mode = 'missing';
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, product_id')) return mode === 'missing' ? [[]] : [[{
            id: 'x', tiendanube_product_id: 'p', tiendanube_variant_id: 'v', stock: 2, attempts: mode === 'terminal' ? 2 : 0, max_attempts: 3
        }]];
        if (statement.includes("SET status = 'retrying'")) return [{ affectedRows: mode === 'claim' ? 0 : 1 }];
        return [[]];
    } }, http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    await assert.rejects(() => service.retrySync('x'), /no encontrado/);
    mode = 'claim';
    await assert.rejects(() => service.retrySync('x'), /agotó sus reintentos/);
    mode = 'terminal';
    service.resolveStockLocation = async () => 'loc';
    service.apiRequest = async () => { const e = new Error('rate'); e.response = { data: { message: '429' } }; throw e; };
    await assert.rejects(() => service.retrySync('x'), /429/);
    assert.ok(calls.some((call) => call.params?.[0] === 'failed'));
});

test('background workers cover disconnected, empty, unclaimed and failed entries', async () => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        const disconnected = new TiendaNubeService({ db: {}, http: {} });
        disconnected.getCredentials = async () => null;
        assert.equal(await disconnected.processFailedSyncs(), undefined);

        let mode = 'empty';
        const calls = [];
        const service = new TiendaNubeService({ db: { query: async (sql, params) => {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('SELECT id, product_id')) return mode === 'empty' ? [[]] : [[{
                id: 'x', product_id: 'local', tiendanube_product_id: 'p', tiendanube_variant_id: 'v', stock: 1, attempts: 0, max_attempts: 3
            }]];
            if (statement.includes("SET status = 'retrying'")) return [{ affectedRows: mode === 'unclaimed' ? 0 : 1 }];
            return [[]];
        } }, http: {} });
        service.getCredentials = async () => ({ storeId: 's' });
        assert.equal(await service.processFailedSyncs(), undefined);
        mode = 'unclaimed';
        await service.processFailedSyncs();
        mode = 'failed';
        service.resolveStockLocation = async () => 'loc';
        service.apiRequest = async () => { throw new Error('offline'); };
        await service.processFailedSyncs();
        assert.ok(calls.some((call) => call.params?.includes('pending') && call.params?.includes('offline')));
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
});

test('pending webhook worker isolates malformed payloads and counts successful records', async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        const service = new TiendaNubeService({ db: { query: async (sql) => {
            if (String(sql).includes('SELECT id, store_id')) return [[
                { id: 'bad', payload: '{bad' },
                { id: 'ok', store_id: 's', event: 'order/paid', resource_id: '1', payload: '{}' }
            ]];
            return [[]];
        } }, http: {} });
        service.processRecordedWebhookEvent = async () => ({ status: 'processed' });
        const result = await service.processPendingWebhookEvents({}, 500);
        assert.deepEqual(result, { processed: 1, discovered: 2 });
    } finally {
        console.error = originalError;
    }
});

test('remote catalog import records partial success and systemic failure', async () => {
    const calls = [];
    let mode = 'partial';
    const service = new TiendaNubeService({ db: { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; } }, http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    service.apiRequest = async () => {
        if (mode === 'system') throw new Error('catalog offline');
        return { data: [{ id: 1 }, { id: 2 }] };
    };
    service.persistRemoteProduct = async (remote) => { if (remote.id === 2) throw new Error('bad product'); };
    const partial = await service.importRemoteCatalog({ q: 'camiseta azul' });
    assert.equal(partial.processed, 2);
    assert.equal(partial.succeeded, 1);
    assert.equal(partial.failures.length, 1);
    assert.ok(calls.some((call) => call.params?.[0] === 'completed_with_errors'));
    mode = 'system';
    await assert.rejects(() => service.importRemoteCatalog(), /catalog offline/);
    assert.ok(calls.some((call) => call.sql.includes("status = 'failed'")));
});

test('fulfillment mutations validate credentials and missing local fulfillment rows', async () => {
    const noCreds = new TiendaNubeService({ db: {}, http: {} });
    noCreds.getCredentials = async () => null;
    await assert.rejects(() => noCreds.updateFulfillment('f', {}), /Credenciales/);
    await assert.rejects(() => noCreds.createTrackingEvent('f', {}), /Credenciales/);
    const missing = new TiendaNubeService({ db: { query: async () => [[]] }, http: {} });
    missing.getCredentials = async () => ({ storeId: 's' });
    await assert.rejects(() => missing.updateFulfillment('f', {}), (e) => e.statusCode === 404);
    await assert.rejects(() => missing.createTrackingEvent('f', {}), (e) => e.statusCode === 404);
});

test('rate limiter and stock-location cache cover waiting, reuse and required selection', async () => {
    const service = new TiendaNubeService({ http: {}, env: { TIENDANUBE_ENFORCE_RATE_LIMIT: 'true' } });
    service.enforceRateLimit = true;
    service.nextApiRequestAt = Date.now() + 2;
    await service.waitForRateSlot();
    assert.ok(service.nextApiRequestAt > Date.now());

    service.locationCache = { expiresAt: Date.now() + 1000, requiresSelection: false, locationId: 'location-1' };
    assert.equal(await service.resolveStockLocation({}), 'location-1');
    service.locationCache = { expiresAt: Date.now() + 1000, requiresSelection: true, locationId: null };
    await assert.rejects(() => service.resolveStockLocation({}), /múltiples ubicaciones/);
});

test('pagination accepts Tiendanube next links and remote catalog import advances pages', async () => {
    const service = new TiendaNubeService({ db: { query: async () => [[]] }, http: {} });
    assert.equal(
        service.nextPageUrl('<https://api.tiendanube.com/2025-03/store/products?page=2>; rel="next"'),
        'https://api.tiendanube.com/2025-03/store/products?page=2'
    );
    service.getCredentials = async () => ({ storeId: 'store' });
    let requests = 0;
    service.apiRequest = async () => {
        requests += 1;
        return { data: requests === 1 ? Array.from({ length: 200 }, (_, id) => ({ id })) : [] };
    };
    service.persistRemoteProduct = async () => {};
    const result = await service.importRemoteCatalog();
    assert.equal(requests, 2);
    assert.equal(result.processed, 200);
    assert.equal(result.succeeded, 200);
    assert.equal(result.pages, 2);
});

test('stock sync tolerates a secondary failure while queueing its retry', async () => {
    const originalError = console.error;
    const originalLog = console.log;
    const errors = [];
    console.error = (...args) => errors.push(args);
    console.log = () => {};
    try {
        const service = new TiendaNubeService({
            db: { query: async (sql) => String(sql).includes('FROM products')
                ? [[{ tiendanube_product_id: 'p', tiendanube_variant_id: 'v', tiendanube_sync_enabled: 1 }]]
                : [[]] },
            http: {},
        });
        service.getCredentials = async () => ({ storeId: 's' });
        service.resolveStockLocation = async () => 'loc';
        service.apiRequest = async () => { throw new Error('remote offline'); };
        service.queueFailedSync = async () => { throw new Error('retry table offline'); };
        assert.equal(await service.syncStock('local-product', 4), undefined);
        assert.ok(errors.some((args) => String(args[0]).includes('Error queueing failed sync')));
    } finally {
        console.error = originalError;
        console.log = originalLog;
    }
});

test('manual retry completes a claimed failed stock synchronization', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, product_id')) return [[{
            id: 'retry-1', product_id: 'local', tiendanube_product_id: 'remote-p',
            tiendanube_variant_id: 'remote-v', stock: 8, attempts: 1, max_attempts: 3,
        }]];
        if (statement.includes("SET status = 'retrying'")) return [{ affectedRows: 1 }];
        return [{ affectedRows: 1 }];
    } }, http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    service.resolveStockLocation = async () => 'loc';
    service.apiRequest = async () => ({ data: {} });

    assert.deepEqual(await service.retrySync('retry-1'), { success: true });
    assert.ok(calls.some(({ sql }) => sql.includes("SET status = 'completed'")));
});

test('recent-order synchronization separates created, skipped and failed imports', async () => {
    const disconnected = new TiendaNubeService({ http: {} });
    disconnected.getCredentials = async () => null;
    await assert.rejects(() => disconnected.syncRecentOrders({}), /Credenciales/);

    const service = new TiendaNubeService({ http: {
        get: async () => ({
            data: [{ id: 1 }, { id: 2 }, { id: 3 }],
            headers: { link: '<https://malformed.example>; rel="prev"' },
        }),
    } });
    service.getCredentials = async () => ({ storeId: 's', accessToken: 'token', userAgent: 'WSM' });
    service.importOrderPayload = async (payload) => {
        if (payload.id === 1) return { status: 'created' };
        if (payload.id === 2) return { status: 'existing' };
        throw new Error('SKU no vinculado');
    };
    const result = await service.syncRecentOrders({});
    assert.deepEqual(result, {
        syncedCount: 1,
        skippedCount: 1,
        failures: [{ externalId: '3', message: 'SKU no vinculado' }],
        pages: 1,
    });
});

test('webhook administration creates missing registrations and removes matching URLs', async () => {
    const missingUrl = new TiendaNubeService({ http: {} });
    assert.deepEqual(await missingUrl.ensureOrderWebhook(''), { configured: false, reason: 'missing_public_url' });
    missingUrl.getCredentials = async () => null;
    await assert.rejects(() => missingUrl.ensureOrderWebhook('https://app.example/webhook'), /Credenciales/);
    assert.deepEqual(await missingUrl.removeOrderWebhook(''), { removed: 0 });

    const calls = [];
    const service = new TiendaNubeService({ http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    service.apiRequest = async (method, _creds, path, payload) => {
        calls.push({ method, path, payload });
        if (method === 'get') return { data: [{ id: 1, event: 'order/created', url: 'https://app.example/webhook' }] };
        return { data: { id: `created-${calls.length}` } };
    };
    const ensured = await service.ensureOrderWebhook('https://app.example/webhook');
    assert.equal(ensured.configured, true);
    assert.equal(ensured.created, true);
    assert.ok(ensured.createdCount > 0);
    assert.equal(calls.filter(({ method }) => method === 'post').length, ensured.createdCount);

    const removed = await service.removeOrderWebhook('https://app.example/webhook');
    assert.deepEqual(removed, { removed: 1 });
    assert.ok(calls.some(({ method, path }) => method === 'delete' && path === '/webhooks/1'));
});

test('stock-location status explains configured, automatic, ambiguous and remote-error states', async () => {
    const service = new TiendaNubeService({ http: {} });
    let response = [{ id: 1, active: true }, { id: 2, active: false }];
    service.apiRequest = async () => ({ data: response });
    assert.deepEqual(await service.getStockLocationStatus({ locationId: '1' }), { valid: true, locationId: '1' });
    assert.equal((await service.getStockLocationStatus({ locationId: 'missing' })).valid, false);
    assert.deepEqual(await service.getStockLocationStatus({}), { valid: true, locationId: '1' });
    response = [{ id: 1 }, { id: 2 }];
    assert.match((await service.getStockLocationStatus({})).message, /multiubicación/);
    response = [];
    assert.match((await service.getStockLocationStatus({})).message, /no informó/);
    service.apiRequest = async () => { throw new Error('offline'); };
    assert.match((await service.getStockLocationStatus({})).message, /offline/);
});

test('automatic catalog linking validates credentials and handles an empty remote catalog', async () => {
    const disconnected = new TiendaNubeService({ http: {} });
    disconnected.getCredentials = async () => null;
    await assert.rejects(() => disconnected.autoLinkCatalog(), /Credenciales/);

    const originalLog = console.log;
    console.log = () => {};
    try {
        const service = new TiendaNubeService({ http: {} });
        service.getCredentials = async () => ({ storeId: 's' });
        service.apiRequest = async () => ({ data: [] });
        const result = await service.autoLinkCatalog();
        assert.equal(result.totalVariantsFound, 0);
        assert.equal(result.linkedCount, 0);
    } finally {
        console.log = originalLog;
    }
});
