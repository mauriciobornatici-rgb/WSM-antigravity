import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { TiendaNubeService } from '../services/tiendanube.service.js';

test('Tiendanube helpers cover localized fallbacks, dates, states and Buffer signatures', () => {
    const service = new TiendaNubeService({ env: { JWT_SECRET: 'jwt-secret' }, http: {} });
    assert.equal(service.localizedText('Texto', 'otro'), 'Texto');
    assert.equal(service.localizedText(null, 'reserva'), 'reserva');
    assert.equal(service.localizedText({ 'es-AR': 'Argentina' }), 'Argentina');
    assert.equal(service.localizedText({ pt: 'Português' }), 'Português');
    assert.equal(service.localizedText({ en: 'English' }), 'English');
    assert.equal(service.localizedText({ fr: 'Français' }), 'Français');
    assert.equal(service.localizedText({ fr: '' }, 'reserva'), 'reserva');
    assert.equal(service.mysqlDate(null), null);
    assert.equal(service.mysqlDate('fecha inválida'), null);
    assert.equal(service.mapLocalOrderStatus({ status: 'voided' }), 'cancelled');
    assert.equal(service.mapLocalOrderStatus({ status: 'closed' }), 'completed');

    const state = service.createOAuthState({ userId: 'user-1' });
    assert.equal(service.verifyOAuthState(state).userId, 'user-1');
    const body = Buffer.from('{"id":1}');
    const signature = crypto.createHmac('sha256', 'client-secret').update(body).digest('hex');
    assert.equal(service.verifyWebhookSignature(body, signature, 'client-secret'), true);
    assert.equal(service.verifyWebhookSignature(body, signature, ''), false);
});

test('remote catalog payload supports products without attributes and partial variants', () => {
    const service = new TiendaNubeService({ http: {} });
    const plain = service.buildRemoteProductPayload({ name: 'Genérico', visibility: 'visible' }, [{
        sku: 'GEN-1', remote_variant_id: '22', image_url: 'https://img.test/1.jpg'
    }]);
    assert.deepEqual(plain.attributes, []);
    assert.deepEqual(plain.variants[0].values, []);
    assert.equal(plain.variants[0].id, 22);
    assert.equal(plain.variants[0].price, '0.00');
    assert.equal(plain.variants[0].cost, '0.00');
    assert.equal(plain.variants[0].stock, 0);
    assert.equal(plain.description.es, '');
    assert.equal(plain.brand, null);
    assert.deepEqual(plain.images, [{ src: 'https://img.test/1.jpg' }]);

    const sizeOnly = service.buildRemoteProductPayload({ name: 'Remera' }, [{ sku: 'R-1', size: '' }, { sku: 'R-2', size: 'M' }]);
    assert.deepEqual(sizeOnly.attributes, [{ es: 'Talle' }]);
    assert.deepEqual(sizeOnly.variants[0].values, [{ es: 'Único' }]);
    const colorOnly = service.buildRemoteProductPayload({ name: 'Gorra' }, [{ sku: 'G-1', color: '' }, { sku: 'G-2', color: 'Azul' }]);
    assert.deepEqual(colorOnly.attributes, [{ es: 'Color' }]);
    assert.deepEqual(colorOnly.variants[0].values, [{ es: 'Único' }]);
});

test('sparse order metadata uses nested customer fields and safe operational defaults', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [[]];
    } }, http: {} });
    await service.persistOrderMetadata('order-sparse', {
        id: 9,
        customer: { id: 7, name: 'Cliente', email: 'nested@test', phone: '11', identification: '20' },
        payment_details: { method: 'gateway' },
        shipping_address: { address: 'Calle', city: 'CABA' },
    });
    await service.persistOrderMetadata('order-anonymous', { id: 10, billing_name: 'Facturación' });

    assert.ok(calls.some(({ params }) => params?.includes('nested@test')));
    assert.ok(calls.some(({ params }) => params?.includes('gateway')));
    assert.ok(calls.some(({ params }) => params?.includes('Facturación')));
});

test('recorded order webhook completes the real import branch and marks the event', async () => {
    const service = new TiendaNubeService({ db: { query: async (sql) => {
        if (String(sql).includes("status = 'processing'")) return [{ affectedRows: 1 }];
        return [[]];
    } }, http: {} });
    const marks = [];
    service.fetchOrder = async () => ({ id: 4 });
    service.importOrderPayload = async () => ({ orderId: 'local-4', status: 'created' });
    service.markWebhookEvent = async (...args) => marks.push(args);

    const result = await service.processRecordedWebhookEvent({
        eventId: 'event-4', event: 'order/created', resourceId: '4', storeId: 'store'
    }, {}, {});
    assert.deepEqual(result, { status: 'processed', orderId: 'local-4', importStatus: 'created' });
    assert.deepEqual(marks, [['event-4', 'processed']]);
});

test('sparse remote customers and products retain deterministic defaults', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id FROM tiendanube_catalog_families')) return [[{ id: 'family-1' }]];
        if (statement.includes('SELECT id FROM products')) return [[]];
        return [[]];
    } }, http: {} });

    assert.deepEqual(await service.persistRemoteCustomer({ id: 8 }), {
        externalId: '8', name: 'Cliente Tiendanube'
    });
    const empty = await service.persistRemoteProduct({ id: 10, name: { 'es-AR': 'Vacío' }, published: false, variants: [{}] });
    assert.equal(empty.linkedCount, 0);
    assert.equal(empty.skippedCount, 1);
    const created = await service.persistRemoteProduct({
        id: 11, name: { en: 'Basic' }, published: true,
        variants: [{ id: 2, sku: 'BASIC-1' }]
    });
    assert.equal(created.linkedCount, 1);
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO products')));
});

test('empty catalog and unfiltered operations lists preserve bounded response shapes', async () => {
    const service = new TiendaNubeService({ db: { query: async (sql) => {
        const statement = String(sql);
        if (statement.trim().startsWith('SELECT COUNT(*) AS total')) return [[{ total: null }]];
        return [[]];
    } }, http: {} });
    assert.deepEqual(await service.listCatalog(), { rows: [], total: 0 });
    assert.deepEqual(await service.listOperationsOrders(), { rows: [], total: 0 });
    assert.deepEqual(await service.listOperationsCustomers(), { rows: [], total: 0 });
    assert.deepEqual(await service.listFulfillments(), { rows: [], total: 0 });
});

test('fulfillment persistence and mutations accept sparse remote payloads', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT f.*, o.id AS local_order_id')) {
            return [[{ id: 'fulfillment-1', local_order_id: 'order-1', external_order_id: 'external-1' }]];
        }
        return [[]];
    } }, http: {} });
    service.getCredentials = async () => ({ storeId: 'store' });
    service.apiRequest = async () => ({ data: { id: 'fulfillment-1' } });

    await service.persistFulfillments('order-1', 'external-1', null);
    await service.persistFulfillments('order-1', 'external-1', [{ id: 'fulfillment-1' }]);
    const unchanged = await service.updateFulfillment('fulfillment-1', {});
    const tracking = await service.updateFulfillment('fulfillment-1', {
        tracking_code: null, tracking_url: '', notify_customer: false
    });
    assert.equal(unchanged.id, 'fulfillment-1');
    assert.equal(tracking.id, 'fulfillment-1');
    assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO tiendanube_fulfillments') && params.includes('UNPACKED')));
    assert.ok(calls.some(({ sql, params }) => sql.includes('UPDATE orders SET tracking_number') && params[0] === null));
});

test('webhook status reports missing URL, disconnected and incomplete registrations', async () => {
    const service = new TiendaNubeService({ http: {} });
    assert.deepEqual(await service.checkOrderWebhook(''), { configured: false, reason: 'missing_public_url' });
    service.getCredentials = async () => null;
    assert.deepEqual(await service.checkOrderWebhook('https://app.test/webhook'), { configured: false, reason: 'not_connected' });
    service.getCredentials = async () => ({ storeId: 'store' });
    service.apiRequest = async () => ({ data: [] });
    const missing = await service.checkOrderWebhook('https://app.test/webhook');
    assert.equal(missing.configured, false);
    assert.equal(missing.reason, 'not_registered');
    assert.ok(missing.missingEvents.length > 0);
});

test('API requests retry a Tiendanube rate limit response once', async (t) => {
    let attempts = 0;
    const service = new TiendaNubeService({ http: {
        get: async () => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error('rate limited');
                error.response = { status: 429, headers: {} };
                throw error;
            }
            return { data: { ok: true } };
        }
    }, env: {} });
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback) => { callback(); return 0; };
    t.after(() => { globalThis.setTimeout = originalTimeout; });

    const response = await service.apiRequest('get', {
        storeId: 'store', accessToken: 'token', userAgent: 'WSM'
    }, '/orders');
    assert.deepEqual(response.data, { ok: true });
    assert.equal(attempts, 2);
});

test('webhook marker and pending worker persist default payload and limit behavior', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, store_id')) return [[{
            id: 'pending-1', store_id: 'store', event: 'order/created', resource_id: '1', payload: null
        }]];
        return [[]];
    } }, http: {} });
    service.processRecordedWebhookEvent = async (_record, payload) => ({ payload });

    await service.markWebhookEvent('event-1', 'processed', null);
    const result = await service.processPendingWebhookEvents({});
    assert.deepEqual(result, { processed: 1, discovered: 1 });
    assert.ok(calls.some(({ sql }) => sql.includes('LIMIT 50')));
    assert.ok(calls.some(({ sql, params }) => sql.includes('UPDATE tiendanube_webhook_events') && params.at(-1) === 'event-1'));
});

test('credentials and imports retain connected defaults and disconnected safeguards', async () => {
    const connected = new TiendaNubeService({
        db: { query: async () => [[{
            tiendanube_access_token: 'plain-token', tiendanube_store_id: 'store'
        }]] },
        http: {}, env: {}
    });
    const credentials = await connected.getCredentials();
    assert.equal(credentials.connectionStatus, 'connected');
    assert.equal(credentials.locationId, null);

    const disconnected = new TiendaNubeService({ http: {} });
    disconnected.getCredentials = async () => null;
    await assert.rejects(() => disconnected.importRemoteCatalog(), /Credenciales/);
    await assert.rejects(() => disconnected.syncFulfillmentsForExternalOrder('external-1'), /Credenciales/);
});

test('fulfillment synchronization identifies remote orders not imported locally', async () => {
    const service = new TiendaNubeService({ db: { query: async () => [[]] }, http: {} });
    service.getCredentials = async () => ({ storeId: 'store' });
    assert.deepEqual(await service.syncFulfillmentsForExternalOrder('external-missing'), {
        synced: 0, reason: 'order_not_imported'
    });
});

test('minimal catalog family creation safely defaults every optional commercial field', async () => {
    const connectionCalls = [];
    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params) => {
            connectionCalls.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT sku FROM products')) return [[]];
            return [[]];
        }
    };
    const service = new TiendaNubeService({ db: {
        getConnection: async () => connection,
        query: async (sql) => {
            if (String(sql).includes('SELECT * FROM tiendanube_catalog_families')) {
                return [[{ id: 'created-family', name: 'Producto básico', total_stock: null }]];
            }
            if (String(sql).includes('SELECT v.id, v.family_id')) return [[]];
            return [[]];
        }
    }, http: {} });

    const family = await service.createCatalogFamily({
        name: 'Producto básico', visibility: 'hidden', publish: false,
        variants: [{ sku: 'BASIC-MIN' }]
    });
    assert.equal(family.name, 'Producto básico');
    assert.equal(family.total_stock, 0);
    assert.ok(connectionCalls.some(({ sql, params }) => sql.includes('INSERT INTO products')
        && params.filter((value) => value === null).length >= 6));
    assert.equal(connectionCalls.some(({ sql }) => sql.includes('INSERT INTO inventory (')), false);
});

test('stock location resolution caches the remote no-location safeguard', async () => {
    let requests = 0;
    const service = new TiendaNubeService({ http: {} });
    service.apiRequest = async () => { requests += 1; return { data: null }; };
    await assert.rejects(() => service.resolveStockLocation({}), /no informó una ubicación activa/);
    await assert.rejects(() => service.resolveStockLocation({}), /configure un Location ID/);
    assert.equal(requests, 1);
});

test('API request forwards non-rate-limit failures unchanged', async () => {
    const original = new Error('network offline');
    const service = new TiendaNubeService({ http: { get: async () => { throw original; } }, env: {} });
    await assert.rejects(
        () => service.apiRequest('get', { storeId: 'store', accessToken: 'token', userAgent: 'WSM' }, '/orders'),
        (error) => error === original
    );
});
