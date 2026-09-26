import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { TiendaNubeService } from '../services/tiendanube.service.js';
import salesService from '../services/sales.service.js';

test('syncStock uses Tiendanube 2025-03 stock endpoint with bearer auth', async () => {
    const httpCalls = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123',
                    tiendanube_location_id: 'location-1'
                }]];
            }

            if (statement.includes('FROM products') && params[0] === 'local-product-1') {
                return [[{
                    tiendanube_sync_enabled: 1,
                    tiendanube_product_id: '123456',
                    tiendanube_variant_id: '654321'
                }]];
            }

            throw new Error(`Unexpected SQL in syncStock test: ${statement}`);
        }
    };
    const http = {
        async post(url, payload, options) {
            httpCalls.push({ url, payload, options });
            return { data: { ok: true } };
        }
    };

    const service = new TiendaNubeService({
        db,
        http,
        env: {
            TIENDANUBE_USER_AGENT: 'WSM SportsERP Test (dev@example.com)'
        }
    });

    const result = await service.syncStock('local-product-1', 7);

    assert.deepEqual(result, { ok: true });
    assert.equal(httpCalls.length, 1);
    assert.equal(
        httpCalls[0].url,
        'https://api.tiendanube.com/2025-03/store-123/products/123456/variants/stock'
    );
    assert.deepEqual(httpCalls[0].payload, {
        action: 'replace',
        value: 7,
        id: 654321,
        location_id: 'location-1'
    });
    assert.deepEqual(httpCalls[0].options.headers, {
        Authorization: 'Bearer access-token',
        'User-Agent': 'WSM SportsERP Test (dev@example.com)',
        'Content-Type': 'application/json'
    });
});

test('OAuth state is signed and rejects tampering', () => {
    const service = new TiendaNubeService({
        env: { JWT_SECRET: 'state-signing-secret' }
    });

    const state = service.createOAuthState({ userId: 'user-1' });
    const verified = service.verifyOAuthState(state);

    assert.equal(verified.userId, 'user-1');

    const tampered = `${state.slice(0, -1)}x`;
    assert.throws(
        () => service.verifyOAuthState(tampered),
        (error) => {
            assert.equal(error.errorCode, 'TIENDANUBE_INVALID_STATE');
            return true;
        }
    );
});

test('verifyWebhookSignature validates Tiendanube HMAC header', () => {
    const service = new TiendaNubeService();
    const rawBody = Buffer.from(JSON.stringify({ store_id: 123, event: 'order/created', id: 456 }));
    const signature = crypto
        .createHmac('sha256', 'client-secret')
        .update(rawBody)
        .digest('hex');

    assert.equal(service.verifyWebhookSignature(rawBody, signature, 'client-secret'), true);
    assert.equal(service.verifyWebhookSignature(rawBody, 'bad-signature', 'client-secret'), false);
});

test('processWebhookEvent fetches full order by id and imports it with external refs', async () => {
    const httpCalls = [];
    const createdOrders = [];
    const dbCalls = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbCalls.push({ sql: statement, params });

            if (statement.includes('INSERT INTO tiendanube_webhook_events')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123'
                }]];
            }
            if (statement.includes('SELECT id FROM orders WHERE external_source')) {
                return [[]];
            }
            if (statement.includes('SELECT id FROM products WHERE sku = ?')) {
                return [[{ id: 'local-product-1' }]];
            }
            if (statement.includes('UPDATE tiendanube_webhook_events')) {
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO tiendanube_order_details') || statement.includes('UPDATE orders SET')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in webhook processing test: ${statement}`);
        }
    };
    const http = {
        async get(url, options) {
            httpCalls.push({ url, options });
            return {
                data: {
                    id: 987654,
                    number: 1001,
                    customer: { name: 'Cliente Tiendanube' },
                    payment_details: { method: 'credit_card' },
                    shipping_address: { address: 'Calle 1', number: '123', city: 'CABA' },
                    products: [{ sku: 'BOT-PRO', quantity: 2 }]
                }
            };
        }
    };
    const salesService = {
        async createOrder(orderData) {
            createdOrders.push(orderData);
            return { id: 'order-local-1' };
        }
    };
    const service = new TiendaNubeService({
        db,
        http,
        env: { TIENDANUBE_USER_AGENT: 'WSM SportsERP Test (dev@example.com)' }
    });

    const result = await service.processWebhookEvent(
        { store_id: 'store-123', event: 'order/created', id: 987654 },
        salesService
    );

    assert.equal(result.status, 'processed');
    assert.equal(httpCalls[0].url, 'https://api.tiendanube.com/2025-03/store-123/orders/987654');
    assert.equal(createdOrders.length, 1);
    assert.equal(createdOrders[0].external_source, 'tiendanube');
    assert.equal(createdOrders[0].external_id, '987654');
    assert.equal(createdOrders[0].customer_name, 'Cliente Tiendanube');
    assert.deepEqual(createdOrders[0].items, [{ product_id: 'local-product-1', quantity: 2 }]);
});

test('processWebhookEvent skips duplicate webhook events before fetching order', async () => {
    const db = {
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('INSERT INTO tiendanube_webhook_events')) {
                const error = new Error('Duplicate entry');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            if (statement.includes('SELECT id, status')) {
                return [[{ id: 'existing-event', status: 'processed' }]];
            }
            throw new Error(`Unexpected SQL in duplicate webhook test: ${statement}`);
        }
    };
    const http = {
        async get() {
            throw new Error('HTTP should not be called for duplicate webhooks');
        }
    };
    const salesService = {
        async createOrder() {
            throw new Error('createOrder should not be called for duplicate webhooks');
        }
    };
    const service = new TiendaNubeService({ db, http });

    const result = await service.processWebhookEvent(
        { store_id: 'store-123', event: 'order/created', id: 987654 },
        salesService
    );

    assert.equal(result.status, 'duplicate');
});

test('syncRecentOrders deduplicates against orders external refs', async () => {
    const createdOrders = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            if (statement.includes('sales_orders')) {
                throw new Error('syncRecentOrders must not query legacy sales_orders table');
            }
            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123'
                }]];
            }
            if (statement.includes('SELECT id FROM orders WHERE external_source')) {
                assert.deepEqual(params, ['tiendanube', '555']);
                return [[]];
            }
            if (statement.includes('SELECT id FROM products WHERE sku = ?')) {
                return [[{ id: 'local-product-1' }]];
            }
            if (statement.includes('INSERT INTO tiendanube_order_details') || statement.includes('UPDATE orders SET')) {
                return [{ affectedRows: 1 }];
            }
            throw new Error(`Unexpected SQL in syncRecentOrders test: ${statement}`);
        }
    };
    const http = {
        async get() {
            return {
                data: [{
                    id: 555,
                    number: 777,
                    customer: { name: 'Cliente Sync' },
                    products: [{ sku: 'BOT-PRO', quantity: 1 }]
                }]
            };
        }
    };
    const salesService = {
        async createOrder(orderData) {
            createdOrders.push(orderData);
            return { id: 'order-local-1' };
        }
    };
    const service = new TiendaNubeService({ db, http });

    const result = await service.syncRecentOrders(salesService);

    assert.equal(result.syncedCount, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(createdOrders[0].external_source, 'tiendanube');
    assert.equal(createdOrders[0].external_id, '555');
});

test('importOrderPayload throws error if any SKU is not linked locally', async () => {
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            if (statement.includes('SELECT id FROM orders WHERE')) {
                return [[]];
            }
            if (statement.includes('SELECT id FROM products WHERE sku = ?')) {
                // Mock: only 'SKU-OK' exists, 'SKU-BAD' doesn't exist
                if (params[0] === 'SKU-OK') {
                    return [[{ id: 'local-1' }]];
                }
                return [[]];
            }
            throw new Error(`Unexpected SQL in unlinked items test: ${statement}`);
        }
    };
    const salesService = {
        async createOrder() {
            throw new Error('createOrder should not be called if there are unlinked items');
        }
    };
    const service = new TiendaNubeService({ db });

    const orderPayload = {
        id: 1234,
        number: 100,
        products: [
            { sku: 'SKU-OK', quantity: 1 },
            { sku: 'SKU-BAD', quantity: 2 }
        ]
    };

    await assert.rejects(
        () => service.importOrderPayload(orderPayload, salesService),
        (error) => {
            assert.equal(error.errorCode, 'TIENDANUBE_UNLINKED_ITEMS');
            assert.match(error.message, /SKU-BAD/);
            return true;
        }
    );
});

test('syncStock records failure in failed_syncs on HTTP error', async () => {
    const dbQueries = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbQueries.push({ sql: statement, params });

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123',
                    tiendanube_location_id: 'location-1'
                }]];
            }

            if (statement.includes('FROM products') && params[0] === 'local-product-1') {
                return [[{
                    tiendanube_sync_enabled: 1,
                    tiendanube_product_id: '123456',
                    tiendanube_variant_id: '654321'
                }]];
            }

            if (statement.includes('INSERT INTO failed_syncs')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in syncStock failure test: ${statement}`);
        }
    };
    const http = {
        async post() {
            throw new Error('API Error 500 Internal Server Error');
        }
    };

    const service = new TiendaNubeService({ db, http });
    await service.syncStock('local-product-1', 12);

    // Verify it queued the error
    const queueCall = dbQueries.find(q => q.sql.includes('INSERT INTO failed_syncs'));
    assert.ok(queueCall);
    assert.equal(queueCall.params[1], 'local-product-1'); // product_id
    assert.equal(queueCall.params[2], '123456');          // tiendanube_product_id
    assert.equal(queueCall.params[3], '654321');          // tiendanube_variant_id
    assert.equal(queueCall.params[4], 12);                // stock
    assert.match(queueCall.params[5], /API Error/);       // last_error
});

test('processFailedSyncs retries pending entries and updates status to completed on success', async () => {
    const dbQueries = [];
    const httpCalls = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbQueries.push({ sql: statement, params });

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123',
                    tiendanube_location_id: 'location-1'
                }]];
            }

            if (statement.includes('SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts')) {
                return [[{
                    id: 'sync-uuid-1',
                    product_id: 'local-p1',
                    tiendanube_product_id: '123456',
                    tiendanube_variant_id: '654321',
                    stock: 15,
                    attempts: 1
                }]];
            }

            if (statement.includes('UPDATE failed_syncs')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in processFailedSyncs test: ${statement}`);
        }
    };
    const http = {
        async post(url, payload, options) {
            httpCalls.push({ url, payload, options });
            return { data: { success: true } };
        }
    };

    const service = new TiendaNubeService({ db, http });
    await service.processFailedSyncs();

    // Verify HTTP post was triggered with correct parameters
    assert.equal(httpCalls.length, 1);
    assert.deepEqual(httpCalls[0].payload, {
        action: 'replace',
        value: 15,
        id: 654321,
        location_id: 'location-1'
    });

    // Verify row was marked as completed
    const completedUpdate = dbQueries.find(q => q.sql.includes("status = 'completed'"));
    assert.ok(completedUpdate);
    assert.equal(completedUpdate.params[0], 'sync-uuid-1');
});

test('retrySync retries manual sync and throws on error', async () => {
    const dbQueries = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbQueries.push({ sql: statement, params });

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123',
                    tiendanube_location_id: 'location-1'
                }]];
            }

            if (statement.includes('SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts')) {
                return [[{
                    id: 'sync-uuid-2',
                    product_id: 'local-p2',
                    tiendanube_product_id: '123456',
                    tiendanube_variant_id: '654321',
                    stock: 9,
                    attempts: 2
                }]];
            }

            if (statement.includes('UPDATE failed_syncs')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in retrySync test: ${statement}`);
        }
    };
    const http = {
        async post() {
            throw new Error('API Error 401 Unauthorized');
        }
    };

    const service = new TiendaNubeService({ db, http });

    await assert.rejects(
        () => service.retrySync('sync-uuid-2'),
        (error) => {
            assert.match(error.message, /API Error 401/);
            return true;
        }
    );

    // Verify row was updated with new attempt and pending status (since attempts < 5)
    const updateCall = dbQueries.find(q => q.sql.includes('status = ?, last_error = ?'));
    assert.ok(updateCall);
    assert.equal(updateCall.params[0], 'pending');
    assert.match(updateCall.params[1], /API Error 401/);
});

test('autoLinkCatalog fetches catalog and updates local products with Tiendanube IDs', async () => {
    const dbQueries = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbQueries.push({ sql: statement, params });

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123'
                }]];
            }

            if (statement.includes('UPDATE products')) {
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in autoLinkCatalog test: ${statement}`);
        }
    };

    const http = {
        async get(url, config) {
            assert.match(url, /\/products/);
            assert.equal(config.headers['Authorization'], 'Bearer access-token');

            // Devolver un producto de Tienda Nube con variantes
            return {
                data: [
                    {
                        id: 999999, // parent product ID
                        variants: [
                            {
                                id: 888888, // variant ID
                                sku: 'ZAP-TN-01'
                            }
                        ]
                    }
                ]
            };
        }
    };

    const service = new TiendaNubeService({ db, http });
    const result = await service.autoLinkCatalog();

    assert.equal(result.totalVariantsFound, 1);
    assert.equal(result.linkedCount, 1);

    // Verificar que se haya ejecutado el query de actualización
    const updateCall = dbQueries.find(q => q.sql.includes('UPDATE products'));
    assert.ok(updateCall);
    assert.deepEqual(updateCall.params, ['999999', '888888', 'ZAP-TN-01']);
});

test('failed webhook delivery is reopened and processed on Tiendanube retry', async () => {
    const dbCalls = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            dbCalls.push({ sql: statement, params });
            if (statement.includes('INSERT INTO tiendanube_webhook_events')) {
                const error = new Error('duplicate');
                error.code = 'ER_DUP_ENTRY';
                throw error;
            }
            if (statement.includes('SELECT id, status')) return [[{ id: 'event-1', status: 'failed', attempts: 1, max_attempts: 16 }]];
            if (statement.includes("SET status = 'received'")) return [{ affectedRows: 1 }];
            if (statement.includes("SET status = 'processing'")) return [{ affectedRows: 1 }];
            if (statement.includes('FROM company_settings')) {
                return [[{ tiendanube_access_token: 'token', tiendanube_store_id: 'store-123' }]];
            }
            if (statement.includes('SELECT id FROM orders WHERE external_source')) return [[{ id: 'order-1' }]];
            if (statement.includes('UPDATE tiendanube_webhook_events')) return [{ affectedRows: 1 }];
            if (statement.includes('INSERT INTO tiendanube_order_details') || statement.includes('UPDATE orders SET')) return [{ affectedRows: 1 }];
            throw new Error(`Unexpected SQL in failed webhook retry test: ${statement}`);
        }
    };
    const http = { async get() { return { data: { id: 55, products: [] } }; } };
    const service = new TiendaNubeService({ db, http });
    const result = await service.processWebhookEvent(
        { store_id: 'store-123', event: 'order/created', id: 55 },
        { async createOrder() { throw new Error('existing order must not be recreated'); } }
    );
    assert.equal(result.status, 'processed');
    assert.ok(dbCalls.some((call) => call.sql.includes("SET status = 'received'")));
});

test('syncStock targets the configured Tiendanube location', async () => {
    let sentPayload;
    const db = {
        async query(sql) {
            const statement = String(sql);
            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'token',
                    tiendanube_store_id: 'store-123',
                    tiendanube_location_id: 'location-1'
                }]];
            }
            if (statement.includes('FROM products')) {
                return [[{
                    tiendanube_sync_enabled: 1,
                    tiendanube_product_id: 'product-1',
                    tiendanube_variant_id: 'variant-1'
                }]];
            }
            throw new Error(`Unexpected SQL in location test: ${statement}`);
        }
    };
    const http = { async post(url, payload) { sentPayload = payload; return { data: {} }; } };
    const service = new TiendaNubeService({ db, http });
    await service.syncStock('local-1', 8);
    assert.equal(sentPayload.location_id, 'location-1');
});

test('nextPageUrl rejects pagination links outside Tiendanube API origin', () => {
    const service = new TiendaNubeService();
    assert.throws(
        () => service.nextPageUrl('<https://evil.example/orders?page=2>; rel="next"'),
        /Invalid Tiendanube pagination origin/
    );
});

test('resolveStockLocation blocks implicit stock updates for multi-location stores', async () => {
    const service = new TiendaNubeService({
        http: {
            async get() {
                return { data: [{ id: 'loc-a', active: true }, { id: 'loc-b', active: true }] };
            }
        }
    });
    await assert.rejects(
        () => service.resolveStockLocation({
            storeId: 'store-1',
            accessToken: 'token',
            userAgent: 'WSM Test',
            locationId: null
        }),
        /múltiples ubicaciones/
    );
});

test('resolveStockLocation automatically uses the only active location', async () => {
    const service = new TiendaNubeService({
        http: { async get() { return { data: [{ id: 'only-location', active: true }] }; } }
    });
    const locationId = await service.resolveStockLocation({
        storeId: 'store-1',
        accessToken: 'token',
        userAgent: 'WSM Test',
        locationId: null
    });
    assert.equal(locationId, 'only-location');
});

test('ensureOrderWebhook creates the order webhook only when absent', async () => {
    const httpCalls = [];
    const db = {
        async query(sql) {
            if (String(sql).includes('FROM company_settings')) {
                return [[{ tiendanube_access_token: 'token', tiendanube_store_id: 'store-1' }]];
            }
            throw new Error(`Unexpected SQL in webhook registration test: ${sql}`);
        }
    };
    const http = {
        async get() { return { data: [] }; },
        async post(url, payload) {
            httpCalls.push({ url, payload });
            return { data: { id: 77 } };
        }
    };
    const service = new TiendaNubeService({ db, http });
    const result = await service.ensureOrderWebhook('https://erp.example/api/integrations/tiendanube/webhooks');
    assert.equal(result.configured, true);
    assert.equal(result.created, true);
    assert.equal(result.createdCount, 22);
    assert.equal(result.expectedCount, 22);
    assert.equal(result.id, 77);
    assert.equal(httpCalls.length, 22);
    assert.deepEqual(httpCalls[0].payload, {
        event: 'order/created',
        url: 'https://erp.example/api/integrations/tiendanube/webhooks'
    });
});

test('getIntegrationStatus reports disconnected without calling Tiendanube', async () => {
    const service = new TiendaNubeService({
        db: { async query() { return [[]]; } },
        http: { async get() { throw new Error('HTTP must not be called'); } }
    });
    assert.deepEqual(await service.getIntegrationStatus('https://erp.example/webhook'), {
        connected: false,
        webhook: { configured: false }
    });
});

test('getIntegrationStatus validates webhook and configured stock location', async () => {
    const webhookUrl = 'https://erp.example/webhook';
    const db = {
        async query(sql) {
            if (String(sql).includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'token',
                    tiendanube_store_id: 'store-1',
                    tiendanube_location_id: 'loc-1'
                }]];
            }
            throw new Error(`Unexpected SQL in integration status test: ${sql}`);
        }
    };
    const http = {
        async get(url, options) {
            assert.equal(options.timeout, 10000);
            if (url.includes('/webhooks')) return { data: [
                'order/created', 'order/paid', 'order/packed', 'order/fulfilled', 'order/cancelled',
                'order/edited', 'order/pending', 'order/voided', 'order/unpacked',
                'product/created', 'product/updated', 'product/deleted',
                'customer/created', 'customer/updated', 'customer/deleted',
                'fulfillment_order/status_updated', 'fulfillment_order/tracking_event_created',
                'fulfillment_order/tracking_event_updated', 'fulfillment_order/label_status_updated',
                'app/uninstalled', 'app/suspended', 'app/resumed'
            ].map((event, index) => ({ id: index + 1, event, url: webhookUrl })) };
            if (url.includes('/locations')) return { data: [{ id: 'loc-1', active: true }] };
            throw new Error(`Unexpected URL in integration status test: ${url}`);
        }
    };
    const service = new TiendaNubeService({ db, http });
    const status = await service.getIntegrationStatus(webhookUrl);
    assert.equal(status.connected, true);
    assert.equal(status.webhook.configured, true);
    assert.deepEqual(status.stockLocation, { valid: true, locationId: 'loc-1' });
});

test('catalog payload models size and color as aligned Tiendanube variants', () => {
    const service = new TiendaNubeService({ http: {} });
    const payload = service.buildRemoteProductPayload({
        name: 'Camiseta titular',
        description: 'Edición 2026',
        brand: 'WSM',
        visibility: 'hidden'
    }, [
        { sku: 'CAM-S-ROJ', size: 'S', color: 'Rojo', sale_price: 100, purchase_price: 60, stock: 4 },
        { sku: 'CAM-M-AZU', size: 'M', color: 'Azul', sale_price: 110, purchase_price: 65, stock: 2 }
    ]);

    assert.deepEqual(payload.attributes, [{ es: 'Talle' }, { es: 'Color' }]);
    assert.deepEqual(payload.variants[0].values, [{ es: 'S' }, { es: 'Rojo' }]);
    assert.deepEqual(payload.variants[1].values, [{ es: 'M' }, { es: 'Azul' }]);
    assert.equal(payload.variants[0].stock_management, true);
    assert.equal(payload.visibility, 'hidden');
});

test('fulfillment webhooks normalize the ULID as the event resource', () => {
    const service = new TiendaNubeService({ http: {} });
    assert.deepEqual(service.normalizeWebhookPayload({
        store_id: 123,
        event: 'fulfillment_order/status_updated',
        order_id: 456,
        fulfillment_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    }), {
        storeId: '123',
        event: 'fulfillment_order/status_updated',
        resourceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    });
});

test('remote order states map to the local fulfillment lifecycle', () => {
    const service = new TiendaNubeService({ http: {} });
    assert.equal(service.mapLocalOrderStatus({ status: 'cancelled' }), 'cancelled');
    assert.equal(service.mapLocalOrderStatus({ shipping_status: 'packed' }), 'packed');
    assert.equal(service.mapLocalOrderStatus({ shipping_status: 'fulfilled' }), 'delivered');
    assert.equal(service.mapLocalOrderStatus({ status: 'open', shipping_status: 'unpacked' }), null);
});

test('operations hub returns filtered catalog, orders, customers, analytics and sync data', async () => {
    const calls = [];
    const family = { id: 'family-1', name: 'Camiseta', total_stock: '5' };
    const variant = { id: 'variant-1', family_id: 'family-1', sku: 'CAM-M', stock: '5' };
    const db = {
        async query(sql, params = []) {
            const statement = String(sql);
            calls.push({ statement, params });
            if (statement.includes('COUNT(*) AS families')) return [[{ families: 1, synced: 1, attention: 0, visible: 1 }]];
            if (statement.includes('awaiting_fulfillment')) return [[{ orders: 2, paid: 1, awaiting_fulfillment: 1 }]];
            if (statement.includes('failed_stock')) return [[{ failed_stock: 0, pending_events: 0 }]];
            if (statement.includes('revenue_30d')) return [[{ revenue_30d: '1250.50' }]];
            if (statement.includes('COUNT(*) AS total FROM tiendanube_catalog_families')) return [[{ total: 1 }]];
            if (statement.includes('SELECT f.*') && statement.includes('FROM tiendanube_catalog_families f')) return [[family]];
            if (statement.includes('SELECT v.id, v.family_id')) return [[variant]];
            if (statement.includes('SELECT * FROM tiendanube_catalog_families')) return [[family]];
            if (statement.includes('COUNT(*) AS total FROM orders o')) return [[{ total: 2 }]];
            if (statement.includes('SELECT o.*')) return [[{ id: 'order-1', customer_name: 'Cliente' }]];
            if (statement.includes('COUNT(*) AS total FROM tiendanube_customers')) return [[{ total: 1 }]];
            if (statement.includes('SELECT c.*')) return [[{ external_id: 'customer-1', name: 'Cliente' }]];
            if (statement.includes('COUNT(*) AS total FROM tiendanube_fulfillments')) return [[{ total: 1 }]];
            if (statement.includes('SELECT f.*, o.customer_name')) return [[{ id: 'fulfillment-1', status: 'PACKED' }]];
            if (statement.includes('SELECT DATE(o.created_at)')) return [[{ date: '2026-08-20', orders: '2', revenue: '250' }]];
            if (statement.includes('SUM(oi.quantity) AS units')) return [[{ sku: 'CAM-M', units: '2', revenue: '250' }]];
            if (statement.includes("AS state, COUNT(*) AS total")) return [[{ state: 'paid', total: '2' }]];
            if (statement.includes('COUNT(d.order_id) AS orders')) return [[{ external_id: 'customer-1', orders: '2', revenue: '250' }]];
            if (statement.includes('FROM tiendanube_sync_runs')) return [[{ id: 'run-1', status: 'completed' }]];
            if (statement.includes('FROM tiendanube_webhook_events ORDER BY')) return [[{ id: 'event-1', status: 'processed' }]];
            if (statement.includes('FROM failed_syncs f')) return [[{ id: 'failed-1', status: 'pending' }]];
            throw new Error(`Unexpected SQL in operations hub test: ${statement}`);
        }
    };
    const service = new TiendaNubeService({ db, http: {} });
    service.getCredentials = async () => ({ storeId: 'store-1', accessToken: 'token' });

    const overview = await service.getOperationsOverview();
    const catalog = await service.listCatalog({ page: 2, limit: 10, q: 'cam', visibility: 'visible', sync_status: 'synced' });
    const detail = await service.getCatalogFamily('family-1');
    const orders = await service.listOperationsOrders({
        page: 2,
        limit: 10,
        q: 'cliente',
        payment_status: 'paid',
        shipping_status: 'packed',
        from: '2026-08-01',
        to: '2026-08-20'
    });
    const customers = await service.listOperationsCustomers({ page: 1, limit: 10, q: 'cliente' });
    const fulfillments = await service.listFulfillments({ page: 1, limit: 10, q: 'envio', shipping_status: 'PACKED' });
    const analytics = await service.getOperationsAnalytics();
    const sync = await service.getSyncCenter();

    assert.equal(overview.connected, true);
    assert.equal(overview.revenue30d, 1250.5);
    assert.equal(catalog.total, 1);
    assert.equal(catalog.rows[0].variants[0].stock, 5);
    assert.equal(detail.total_stock, 5);
    assert.equal(orders.total, 2);
    assert.equal(customers.total, 1);
    assert.equal(fulfillments.total, 1);
    assert.deepEqual(analytics.daily, [{ date: '2026-08-20', orders: 2, revenue: 250 }]);
    assert.equal(sync.failedStock[0].id, 'failed-1');
    assert.ok(calls.some((call) => call.params.includes('%cam%')));
    assert.ok(calls.some((call) => call.params.includes('packed')));
});

test('fulfillment operations synchronize, update tracking and isolate bulk failures', async () => {
    const apiCalls = [];
    const dbCalls = [];
    const remoteFulfillment = {
        id: 'fulfillment-1',
        number: '1',
        status: 'DISPATCHED',
        assigned_location: { location_id: 'location-1' },
        tracking_info: { code: 'TRACK-1' },
        tracking_events: [],
        created_at: '2026-08-20T12:00:00Z',
        updated_at: '2026-08-20T12:05:00Z'
    };
    const db = {
        async query(sql, params = []) {
            const statement = String(sql);
            dbCalls.push({ statement, params });
            if (statement.includes("SELECT id FROM orders WHERE external_source")) return [[{ id: 'order-1' }]];
            if (statement.includes('SELECT f.*, o.id AS local_order_id')) {
                return [[{ id: 'fulfillment-1', local_order_id: 'order-1', external_order_id: 'external-1' }]];
            }
            if (statement.includes('SELECT id, order_id, external_order_id FROM tiendanube_fulfillments')) {
                return [[{ id: 'fulfillment-1', order_id: 'order-1', external_order_id: 'external-1' }]];
            }
            if (statement.includes('INSERT INTO tiendanube_fulfillments')) return [{ affectedRows: 1 }];
            if (statement.includes('UPDATE orders SET tracking_number')) return [{ affectedRows: 1 }];
            throw new Error(`Unexpected SQL in fulfillment operations test: ${statement}`);
        }
    };
    const service = new TiendaNubeService({ db, http: {} });
    service.getCredentials = async () => ({ storeId: 'store-1', accessToken: 'token' });
    service.apiRequest = async (method, creds, path, data) => {
        apiCalls.push({ method, creds, path, data });
        if (path.endsWith('/tracking-events')) return { data: { id: 'event-1' } };
        return { data: path.includes('fulfillment-orders') && method === 'get' ? [remoteFulfillment] : remoteFulfillment };
    };

    // updateFulfillment dynamically imports the real sales.service.js singleton and calls
    // applyExternalStatus(localOrderId, mappedStatus) instead of writing orders.status
    // directly; stub it so the test never touches a real DB connection.
    const appliedExternalStatuses = [];
    const originalApplyExternalStatus = salesService.applyExternalStatus;
    salesService.applyExternalStatus = async (orderId, status) => {
        appliedExternalStatuses.push([orderId, status]);
    };

    assert.deepEqual(await service.syncFulfillmentsForExternalOrder(null), { synced: 0 });
    assert.deepEqual(await service.syncFulfillmentsForExternalOrder('external-1'), { synced: 1 });
    let updated, event;
    try {
        updated = await service.updateFulfillment('fulfillment-1', {
            status: 'DISPATCHED',
            tracking_code: 'TRACK-1',
            tracking_url: 'https://tracking.example/1',
            notify_customer: true
        });
        event = await service.createTrackingEvent('fulfillment-1', { status: 'IN_TRANSIT' });
    } finally {
        salesService.applyExternalStatus = originalApplyExternalStatus;
    }

    assert.equal(updated.id, 'fulfillment-1');
    assert.equal(event.id, 'event-1');
    assert.ok(apiCalls.some((call) => call.method === 'patch' && call.data.tracking_info.code === 'TRACK-1'));
    assert.ok(apiCalls.some((call) => call.path.endsWith('/tracking-events')));
    assert.ok(dbCalls.filter((call) => call.statement.includes('INSERT INTO tiendanube_fulfillments')).length >= 3);
    // The UPDATE only touches tracking/timestamps now, never orders.status directly.
    const trackingUpdate = dbCalls.find((call) => call.statement.includes('UPDATE orders SET tracking_number'));
    assert.ok(trackingUpdate);
    assert.equal(/\bstatus\s*=\s*CASE/i.test(trackingUpdate.statement), false);
    assert.deepEqual(appliedExternalStatuses, [['order-1', 'dispatched']]);

    const bulkService = new TiendaNubeService({
        db: {
            async query() {
                return [[{ external_id: 'ok' }, { external_id: 'bad' }]];
            }
        },
        http: {}
    });
    bulkService.syncFulfillmentsForExternalOrder = async (externalId) => {
        if (externalId === 'bad') throw new Error('remote unavailable');
        return { synced: 2 };
    };
    const bulk = await bulkService.syncAllFulfillments();
    assert.deepEqual(bulk, {
        orders: 2,
        synced: 2,
        failures: [{ externalId: 'bad', message: 'remote unavailable' }]
    });
});

test('catalog family creation persists every variant, initial stock and publication intent atomically', async () => {
    const statements = [];
    const lifecycle = [];
    const connection = {
        async beginTransaction() { lifecycle.push('begin'); },
        async commit() { lifecycle.push('commit'); },
        async rollback() { lifecycle.push('rollback'); },
        release() { lifecycle.push('release'); },
        async query(sql, params = []) {
            const statement = String(sql);
            statements.push({ statement, params });
            if (statement.includes('SELECT sku FROM products')) return [[]];
            return [{ affectedRows: 1 }];
        }
    };
    const service = new TiendaNubeService({
        db: { async getConnection() { return connection; } },
        http: {}
    });
    const published = [];
    service.publishCatalogFamily = async (familyId) => published.push(familyId);
    service.getCatalogFamily = async (familyId) => ({ id: familyId, variants: 2 });

    const created = await service.createCatalogFamily({
        name: 'Camiseta QA',
        description: 'Familia multivariante',
        brand: 'WSM',
        category: 'Indumentaria',
        visibility: 'hidden',
        publish: true,
        variants: [
            { sku: 'CAM-QA-S', size: 'S', color: 'Azul', purchase_price: 50, sale_price: 100, stock_initial: 3 },
            { sku: 'CAM-QA-M', size: 'M', color: 'Azul', purchase_price: 55, sale_price: 110, stock_initial: 0 }
        ]
    });

    assert.equal(created.variants, 2);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    assert.equal(statements.filter((call) => call.statement.includes('INSERT INTO products')).length, 2);
    assert.equal(statements.filter((call) => call.statement.includes('INSERT INTO tiendanube_catalog_variants')).length, 2);
    assert.equal(statements.filter((call) => call.statement.includes('INSERT INTO inventory (')).length, 1);
    assert.equal(statements.filter((call) => call.statement.includes('INSERT INTO inventory_movements')).length, 1);
    assert.deepEqual(published, [created.id]);

    const duplicateLifecycle = [];
    const duplicateService = new TiendaNubeService({
        db: {
            async getConnection() {
                return {
                    async beginTransaction() { duplicateLifecycle.push('begin'); },
                    async commit() { duplicateLifecycle.push('commit'); },
                    async rollback() { duplicateLifecycle.push('rollback'); },
                    release() { duplicateLifecycle.push('release'); },
                    async query(sql) {
                        if (String(sql).includes('SELECT sku FROM products')) return [[{ sku: 'CAM-QA-S' }]];
                        throw new Error('No inserts expected for duplicate SKU');
                    }
                };
            }
        },
        http: {}
    });
    await assert.rejects(
        () => duplicateService.createCatalogFamily({
            name: 'Duplicada',
            visibility: 'hidden',
            variants: [{ sku: 'CAM-QA-S' }]
        }),
        (error) => error.statusCode === 409 && error.errorCode === 'DUPLICATE_SKU'
    );
    assert.deepEqual(duplicateLifecycle, ['begin', 'rollback', 'release']);
});
