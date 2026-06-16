import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { TiendaNubeService } from '../services/tiendanube.service.js';

test('syncStock uses Tiendanube 2025-03 stock endpoint with bearer auth', async () => {
    const httpCalls = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);

            if (statement.includes('FROM company_settings')) {
                return [[{
                    tiendanube_access_token: 'access-token',
                    tiendanube_store_id: 'store-123'
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
        id: 654321
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

    const syncedCount = await service.syncRecentOrders(salesService);

    assert.equal(syncedCount, 1);
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
                    tiendanube_store_id: 'store-123'
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
                    tiendanube_store_id: 'store-123'
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
        id: 654321
    });

    // Verify row was marked as completed
    const completedUpdate = dbQueries.find(q => q.sql.includes("status = 'completed'"));
    assert.ok(completedUpdate);
    assert.equal(completedUpdate.params[0], 2); // next attempt number (attempts + 1)
    assert.equal(completedUpdate.params[1], 'sync-uuid-1'); // id
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
                    tiendanube_store_id: 'store-123'
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
    const updateCall = dbQueries.find(q => q.sql.includes('status = ?, attempts = ?, last_error = ?'));
    assert.ok(updateCall);
    assert.equal(updateCall.params[0], 'pending');
    assert.equal(updateCall.params[1], 3); // next attempt
    assert.match(updateCall.params[2], /API Error 401/);
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

