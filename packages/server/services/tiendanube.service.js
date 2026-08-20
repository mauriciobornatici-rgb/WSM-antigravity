import axios from 'axios';
import crypto from 'node:crypto';
import pool from '../config/db.js';
import { decrypt } from '../utils/crypto.js';

export class TiendaNubeService {
    constructor({ db = pool, http = axios, env = process.env } = {}) {
        this.db = db;
        this.http = http;
        this.env = env;
        this.apiHost = env.TIENDANUBE_API_HOST || 'https://api.tiendanube.com';
        this.apiVersion = env.TIENDANUBE_API_VERSION || '2025-03';
        this.httpTimeoutMs = Number(env.TIENDANUBE_HTTP_TIMEOUT_MS) || 10000;
        this.locationCache = null;
    }

    apiUrl(storeId, path) {
        return `${this.apiHost}/${this.apiVersion}/${storeId}${path}`;
    }

    requestHeaders(creds) {
        return {
            Authorization: `Bearer ${creds.accessToken}`,
            'User-Agent': creds.userAgent,
            'Content-Type': 'application/json'
        };
    }

    requestOptions(creds) {
        return { headers: this.requestHeaders(creds), timeout: this.httpTimeoutMs };
    }

    normalizeTiendanubeId(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : value;
    }

    getStateSecret() {
        const secret = this.env.JWT_SECRET || this.env.TIENDANUBE_STATE_SECRET;
        if (!secret) {
            const error = new Error('JWT_SECRET is required to sign Tiendanube OAuth state');
            error.statusCode = 500;
            error.errorCode = 'TIENDANUBE_STATE_SECRET_REQUIRED';
            throw error;
        }
        return secret;
    }

    signValue(value, secret) {
        return crypto.createHmac('sha256', secret).update(value).digest('hex');
    }

    createOAuthState({ userId } = {}) {
        const now = Date.now();
        const payload = {
            userId: userId || null,
            nonce: crypto.randomUUID(),
            iat: now,
            exp: now + 5 * 60 * 1000
        };
        const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const signature = this.signValue(encoded, this.getStateSecret());
        return `${encoded}.${signature}`;
    }

    verifyOAuthState(state) {
        const [encoded, signature] = String(state || '').split('.');
        const expected = encoded ? this.signValue(encoded, this.getStateSecret()) : '';

        if (!encoded || !signature || !this.safeEqual(signature, expected)) {
            const error = new Error('Invalid Tiendanube OAuth state');
            error.statusCode = 400;
            error.errorCode = 'TIENDANUBE_INVALID_STATE';
            throw error;
        }

        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!payload.exp || Number(payload.exp) < Date.now()) {
            const error = new Error('Expired Tiendanube OAuth state');
            error.statusCode = 400;
            error.errorCode = 'TIENDANUBE_EXPIRED_STATE';
            throw error;
        }

        return payload;
    }

    safeEqual(left, right) {
        const leftBuffer = Buffer.from(String(left));
        const rightBuffer = Buffer.from(String(right));
        return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
    }

    verifyWebhookSignature(rawBody, signature, clientSecret) {
        if (!rawBody || !signature || !clientSecret) return false;
        const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
        const expected = crypto
            .createHmac('sha256', clientSecret)
            .update(bodyBuffer)
            .digest('hex');
        return this.safeEqual(signature, expected);
    }

    normalizeWebhookPayload(payload = {}) {
        const storeId = String(payload.store_id || payload.storeId || '').trim();
        const event = String(payload.event || '').trim();
        const resourceId = String(payload.id || payload.resource_id || '').trim();

        if (!storeId || !event || !resourceId) {
            const error = new Error('Invalid Tiendanube webhook payload');
            error.statusCode = 400;
            error.errorCode = 'TIENDANUBE_INVALID_WEBHOOK_PAYLOAD';
            throw error;
        }

        return { storeId, event, resourceId };
    }

    async recordWebhookEvent(payload) {
        const normalized = this.normalizeWebhookPayload(payload);
        const eventId = crypto.randomUUID();

        try {
            await this.db.query(
                `INSERT INTO tiendanube_webhook_events (
                    id, store_id, event, resource_id, status, payload
                ) VALUES (?, ?, ?, ?, 'received', ?)`,
                [
                    eventId,
                    normalized.storeId,
                    normalized.event,
                    normalized.resourceId,
                    JSON.stringify(payload)
                ]
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                const [rows] = await this.db.query(
                    `SELECT id, status, attempts, max_attempts
                     FROM tiendanube_webhook_events
                     WHERE store_id = ? AND event = ? AND resource_id = ?
                     LIMIT 1`,
                    [normalized.storeId, normalized.event, normalized.resourceId]
                );
                const existing = rows[0];
                if (existing?.status === 'failed' && existing.attempts < existing.max_attempts) {
                    const [result] = await this.db.query(
                        `UPDATE tiendanube_webhook_events
                         SET status = 'received', payload = ?, error_message = NULL,
                             processed_at = NULL, next_attempt_at = NULL
                         WHERE id = ? AND status = 'failed'`,
                        [JSON.stringify(payload), existing.id]
                    );
                    if (result.affectedRows === 1) {
                        return { ...normalized, eventId: existing.id, duplicate: false, retried: true };
                    }
                }
                return { ...normalized, eventId: existing?.id || null, duplicate: true, status: existing?.status };
            }
            throw error;
        }

        return { ...normalized, eventId, duplicate: false };
    }

    async markWebhookEvent(eventId, status, errorMessage = null) {
        if (!eventId) return;
        await this.db.query(
            `UPDATE tiendanube_webhook_events
             SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP,
                 next_attempt_at = NULL
             WHERE id = ?`,
            [status, errorMessage, eventId]
        );
    }

    async processRecordedWebhookEvent(eventRecord, payload, salesService) {
        if (!eventRecord?.eventId || eventRecord.duplicate) {
            return { status: 'duplicate' };
        }

        const [claim] = await this.db.query(
            `UPDATE tiendanube_webhook_events
             SET status = 'processing', error_message = NULL, attempts = attempts + 1
             WHERE id = ? AND status IN ('received', 'failed')
               AND attempts < max_attempts
               AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)`,
            [eventRecord.eventId]
        );
        if (claim.affectedRows !== 1) {
            return { status: 'duplicate' };
        }

        try {
            if (eventRecord.event === 'order/created') {
                const order = await this.fetchOrder(eventRecord.resourceId, eventRecord.storeId);
                const result = await this.importOrderPayload(order, salesService);
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', orderId: result.orderId, importStatus: result.status };
            }

            await this.markWebhookEvent(eventRecord.eventId, 'processed');
            return { status: 'ignored' };
        } catch (error) {
            await this.db.query(
                `UPDATE tiendanube_webhook_events
                 SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP,
                     next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)
                 WHERE id = ?`,
                [String(error.message || error).slice(0, 65000), eventRecord.eventId]
            );
            throw error;
        }
    }

    async fetchOrder(orderId, storeId = null) {
        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Credenciales de Tienda Nube no configuradas.');
        }
        if (storeId && String(creds.storeId) !== String(storeId)) {
            const error = new Error('Webhook store_id does not match configured Tiendanube store');
            error.statusCode = 403;
            error.errorCode = 'TIENDANUBE_STORE_MISMATCH';
            throw error;
        }

        const response = await this.http.get(this.apiUrl(creds.storeId, `/orders/${orderId}`), {
            ...this.requestOptions(creds)
        });
        return response.data;
    }

    formatShippingAddress(address = {}) {
        return [
            address.address,
            address.number,
            address.floor,
            address.locality,
            address.city,
            address.province,
            address.zipcode
        ].filter(Boolean).join(', ') || null;
    }

    async importOrderPayload(payload, salesService) {
        const externalId = String(payload.id || '').trim();
        if (!externalId) {
            const error = new Error('Tiendanube order id is required');
            error.statusCode = 400;
            error.errorCode = 'TIENDANUBE_ORDER_ID_REQUIRED';
            throw error;
        }

        const [existing] = await this.db.query(
            'SELECT id FROM orders WHERE external_source = ? AND external_id = ? LIMIT 1',
            ['tiendanube', externalId]
        );
        if (existing.length > 0) {
            return { status: 'already_imported', orderId: existing[0].id };
        }

        const items = [];
        const unlinkedSkus = [];
        for (const product of payload.products || []) {
            const sku = String(product.sku || product.variant?.sku || '').trim();
            if (!sku) {
                unlinkedSkus.push(`Producto sin SKU (ID: ${product.id || 'N/A'})`);
                continue;
            }

            const [localProducts] = await this.db.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
            if (localProducts.length > 0) {
                const unitPrice = Number(product.price);
                items.push({
                    product_id: localProducts[0].id,
                    quantity: Number(product.quantity || 1),
                    ...(Number.isFinite(unitPrice) && unitPrice >= 0 ? { unit_price: unitPrice } : {})
                });
            } else {
                unlinkedSkus.push(sku);
            }
        }

        if (unlinkedSkus.length > 0) {
            const error = new Error(`Orden #${payload.number || externalId} rechazada: los siguientes SKUs de Tiendanube no están vinculados localmente: ${unlinkedSkus.join(', ')}`);
            error.statusCode = 422;
            error.errorCode = 'TIENDANUBE_UNLINKED_ITEMS';
            throw error;
        }

        const customerName = payload.customer?.name || payload.billing_address?.name || 'Cliente Tienda Nube';
        const result = await salesService.createOrder({
            customer_name: customerName,
            counter_name: 'Sincronizacion Tiendanube',
            payment_method: payload.payment_details?.method || payload.gateway_name || payload.gateway || 'transfer',
            shipping_method: 'delivery',
            shipping_address: this.formatShippingAddress(payload.shipping_address),
            notes: `TN_ORDER:${externalId}. Orden Tiendanube #${payload.number || externalId}.`,
            external_source: 'tiendanube',
            external_id: externalId,
            external_total_amount: Number(payload.total),
            payment_status: payload.payment_status,
            items
        }, null);

        return { status: 'created', orderId: result.id };
    }

    async processWebhookEvent(payload, salesService) {
        const eventRecord = await this.recordWebhookEvent(payload);
        return this.processRecordedWebhookEvent(eventRecord, payload, salesService);
    }

    async getCredentials() {
        const [rows] = await this.db.query(`
            SELECT tiendanube_access_token, tiendanube_store_id,
                   tiendanube_location_id, tiendanube_client_id, tiendanube_client_secret
            FROM company_settings
            LIMIT 1
        `);
        const settings = rows[0] || {};
        
        const accessToken = decrypt(settings.tiendanube_access_token) || this.env.TIENDANUBE_ACCESS_TOKEN;
        const storeId = settings.tiendanube_store_id || this.env.TIENDANUBE_STORE_ID;
        const locationId = settings.tiendanube_location_id || this.env.TIENDANUBE_LOCATION_ID || null;
        const clientId = settings.tiendanube_client_id || this.env.TIENDANUBE_CLIENT_ID;
        const clientSecret = decrypt(settings.tiendanube_client_secret) || this.env.TIENDANUBE_CLIENT_SECRET;
        const userAgent = this.env.TIENDANUBE_USER_AGENT || 'WSM SportsERP (contacto@wsm.com)';

        if (!accessToken || !storeId) {
            return null;
        }

        return { accessToken, storeId, locationId, clientId, clientSecret, userAgent };
    }

    stockPayload(stock, variantId, locationId = null) {
        return {
            action: 'replace',
            value: Number(stock),
            id: this.normalizeTiendanubeId(variantId),
            ...(locationId ? { location_id: locationId } : {})
        };
    }

    async resolveStockLocation(creds) {
        if (creds.locationId) return creds.locationId;
        if (this.locationCache && this.locationCache.expiresAt > Date.now()) {
            if (this.locationCache.requiresSelection) {
                throw new Error('La tienda tiene múltiples ubicaciones; configure un Location ID antes de sincronizar stock.');
            }
            return this.locationCache.locationId;
        }

        const response = await this.http.get(this.apiUrl(creds.storeId, '/locations?per_page=200'), {
            ...this.requestOptions(creds)
        });
        const activeLocations = (response.data || []).filter((location) => location.active !== false);
        const requiresSelection = activeLocations.length !== 1;
        this.locationCache = {
            locationId: activeLocations.length === 1 ? String(activeLocations[0].id) : null,
            requiresSelection,
            count: activeLocations.length,
            expiresAt: Date.now() + 5 * 60 * 1000
        };
        if (requiresSelection) {
            const message = activeLocations.length > 1
                ? 'La tienda tiene múltiples ubicaciones; configure un Location ID antes de sincronizar stock.'
                : 'Tiendanube no informó una ubicación activa; no se sincronizará stock de forma implícita.';
            throw new Error(message);
        }
        return this.locationCache.locationId;
    }

    async syncStock(productId, newStock) {
        const creds = await this.getCredentials();
        if (!creds) {
            console.log(`[TiendaNube] Skipped sync for product ${productId} - API credentials not configured.`);
            return;
        }

        let tiendanube_product_id = null;
        let tiendanube_variant_id = null;

        try {
            // Find the tiendanube product and variant ID for this local product
            const [rows] = await this.db.query(`
                SELECT tiendanube_product_id, tiendanube_variant_id, tiendanube_sync_enabled 
                FROM products 
                WHERE id = ?
            `, [productId]);

            if (rows.length === 0) return;

            const row = rows[0];
            const tiendanube_sync_enabled = row.tiendanube_sync_enabled;
            tiendanube_product_id = row.tiendanube_product_id;
            tiendanube_variant_id = row.tiendanube_variant_id;

            if (!tiendanube_sync_enabled) {
                console.log(`[TiendaNube] Skipped sync for product ${productId} - Sync is disabled for this product.`);
                return;
            }

            if (!tiendanube_product_id || !tiendanube_variant_id) {
                console.log(`[TiendaNube] Skipped sync for product ${productId} - Not linked to a Tienda Nube variant.`);
                return;
            }

            const url = this.apiUrl(creds.storeId, `/products/${tiendanube_product_id}/variants/stock`);
            
            const locationId = await this.resolveStockLocation(creds);
            const payload = this.stockPayload(newStock, tiendanube_variant_id, locationId);

            const response = await this.http.post(url, payload, {
                ...this.requestOptions(creds)
            });

            console.log(`[TiendaNube] Successfully synced stock for product ${productId} (TN Variant: ${tiendanube_variant_id}). New stock: ${newStock}`);
            return response.data;
        } catch (error) {
            console.error(`[TiendaNube] Failed to sync stock for product ${productId}:`, error?.response?.data || error.message);
            if (productId && tiendanube_product_id && tiendanube_variant_id) {
                try {
                    const errMsg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
                    await this.queueFailedSync(productId, tiendanube_product_id, tiendanube_variant_id, newStock, errMsg);
                    console.log(`[TiendaNube] Failure queued in failed_syncs for product ${productId}`);
                } catch (queueErr) {
                    console.error('[TiendaNube] Error queueing failed sync:', queueErr.message);
                }
            }
        }
    }

    async queueFailedSync(productId, tnProductId, tnVariantId, stock, errorMessage) {
        const id = crypto.randomUUID();
        await this.db.query(`
            INSERT INTO failed_syncs (
                id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, status, last_error, attempts
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, 0)
            ON DUPLICATE KEY UPDATE
                stock = VALUES(stock),
                status = 'pending',
                last_error = VALUES(last_error),
                attempts = 0
        `, [id, productId, tnProductId, tnVariantId, stock, errorMessage]);
    }

    async getFailedSyncs() {
        const [rows] = await this.db.query(`
            SELECT f.*, p.name as product_name, p.sku as product_sku
            FROM failed_syncs f
            JOIN products p ON f.product_id = p.id
            ORDER BY f.created_at DESC
        `);
        return rows;
    }

    async retrySync(id) {
        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Credenciales de Tienda Nube no configuradas.');
        }

        const [rows] = await this.db.query(`
            SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts, max_attempts
            FROM failed_syncs
            WHERE id = ?
        `, [id]);

        if (rows.length === 0) {
            throw new Error('Registro de sincronización fallida no encontrado.');
        }

        const row = rows[0];
        const { tiendanube_product_id, tiendanube_variant_id, stock, attempts, max_attempts } = row;

        const [claim] = await this.db.query(`
            UPDATE failed_syncs
            SET status = 'retrying', attempts = attempts + 1, last_attempt_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status IN ('pending', 'failed') AND attempts < max_attempts
        `, [id]);
        if (claim.affectedRows !== 1) {
            throw new Error('La sincronización ya está siendo procesada o agotó sus reintentos.');
        }

        try {
            const url = this.apiUrl(creds.storeId, `/products/${tiendanube_product_id}/variants/stock`);
            const locationId = await this.resolveStockLocation(creds);
            const payload = this.stockPayload(stock, tiendanube_variant_id, locationId);

            await this.http.post(url, payload, {
                ...this.requestOptions(creds)
            });

            await this.db.query(`
                UPDATE failed_syncs
                SET status = 'completed', last_error = NULL
                WHERE id = ?
            `, [id]);

            return { success: true };
        } catch (error) {
            const nextAttempts = attempts + 1;
            const nextStatus = nextAttempts >= max_attempts ? 'failed' : 'pending';
            const errMsg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;

            await this.db.query(`
                UPDATE failed_syncs
                SET status = ?, last_error = ?
                WHERE id = ?
            `, [nextStatus, errMsg, id]);

            throw new Error(errMsg);
        }
    }

    async processFailedSyncs() {
        const creds = await this.getCredentials();
        if (!creds) {
            console.log('[TiendaNube] Background sync skipped - API credentials not configured.');
            return;
        }

        const [rows] = await this.db.query(`
            SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts, max_attempts
            FROM failed_syncs
            WHERE status IN ('pending', 'failed') AND attempts < max_attempts
            ORDER BY created_at ASC
            LIMIT 100
        `);

        if (rows.length === 0) return;

        console.log(`[TiendaNube] Background sync starting for ${rows.length} failed syncs...`);

        for (const row of rows) {
            const { id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts, max_attempts } = row;
            try {
                const [claim] = await this.db.query(`
                    UPDATE failed_syncs
                    SET status = 'retrying', attempts = attempts + 1, last_attempt_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND status IN ('pending', 'failed') AND attempts < max_attempts
                `, [id]);
                if (claim.affectedRows !== 1) continue;

                const url = this.apiUrl(creds.storeId, `/products/${tiendanube_product_id}/variants/stock`);
                const locationId = await this.resolveStockLocation(creds);
                const payload = this.stockPayload(stock, tiendanube_variant_id, locationId);

                await this.http.post(url, payload, {
                    ...this.requestOptions(creds)
                });

                await this.db.query(`
                    UPDATE failed_syncs
                    SET status = 'completed', last_error = NULL
                    WHERE id = ?
                `, [id]);

                console.log(`[TiendaNube] Background sync succeeded for product ${product_id} (Variant: ${tiendanube_variant_id})`);
            } catch (error) {
                const nextAttempts = attempts + 1;
                const nextStatus = nextAttempts >= max_attempts ? 'failed' : 'pending';
                const errMsg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;

                await this.db.query(`
                    UPDATE failed_syncs
                    SET status = ?, last_error = ?
                    WHERE id = ?
                `, [nextStatus, errMsg, id]);

                console.error(`[TiendaNube] Background sync retry failed for product ${product_id}:`, errMsg);
            }
        }
    }

    async processPendingWebhookEvents(salesService, limit = 50) {
        await this.db.query(
            `UPDATE tiendanube_webhook_events
             SET status = 'failed', error_message = 'Recovered stale processing claim'
             WHERE status = 'processing' AND updated_at < (CURRENT_TIMESTAMP - INTERVAL 5 MINUTE)`
        );
        const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
        const [rows] = await this.db.query(
            `SELECT id, store_id, event, resource_id, payload
             FROM tiendanube_webhook_events
             WHERE status IN ('received', 'failed')
               AND attempts < max_attempts
               AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
             ORDER BY created_at ASC
             LIMIT ${safeLimit}`
        );
        let processed = 0;
        for (const row of rows) {
            try {
                const payload = JSON.parse(row.payload || '{}');
                await this.processRecordedWebhookEvent({
                    eventId: row.id,
                    storeId: row.store_id,
                    event: row.event,
                    resourceId: row.resource_id,
                    duplicate: false
                }, payload, salesService);
                processed++;
            } catch (error) {
                console.error(`[TiendaNube Webhook Worker] Event ${row.id} failed:`, error.message);
            }
        }
        return { processed, discovered: rows.length };
    }

    async syncRecentOrders(salesService) {
        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Credenciales de Tienda Nube no configuradas.');
        }

        let syncedCount = 0;
        let skippedCount = 0;
        const failures = [];
        let nextUrl = this.apiUrl(creds.storeId, '/orders?per_page=200');
        let pages = 0;

        while (nextUrl && pages < 50) {
            const response = await this.http.get(nextUrl, this.requestOptions(creds));
            for (const payload of response.data || []) {
                try {
                    const result = await this.importOrderPayload(payload, salesService);
                    if (result.status === 'created') syncedCount++;
                    else skippedCount++;
                } catch (error) {
                    failures.push({ externalId: String(payload.id || ''), message: error.message });
                }
            }
            nextUrl = this.nextPageUrl(response.headers?.link);
            pages++;
        }

        return { syncedCount, skippedCount, failures, pages };
    }

    nextPageUrl(linkHeader) {
        const next = String(linkHeader || '').split(',')
            .map((part) => part.trim())
            .find((part) => /;\s*rel="?next"?/i.test(part));
        const match = next?.match(/^<([^>]+)>/);
        if (!match) return null;
        const url = new URL(match[1]);
        const allowed = new URL(this.apiHost);
        if (url.origin !== allowed.origin) throw new Error('Invalid Tiendanube pagination origin');
        return url.toString();
    }

    async ensureOrderWebhook(webhookUrl) {
        if (!webhookUrl) return { configured: false, reason: 'missing_public_url' };
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tienda Nube no configuradas.');
        const options = this.requestOptions(creds);
        const list = await this.http.get(this.apiUrl(creds.storeId, '/webhooks'), options);
        const existing = (list.data || []).find((item) => item.event === 'order/created' && item.url === webhookUrl);
        if (existing) return { configured: true, created: false, id: existing.id };
        const created = await this.http.post(this.apiUrl(creds.storeId, '/webhooks'), {
            event: 'order/created',
            url: webhookUrl
        }, options);
        return { configured: true, created: true, id: created.data?.id };
    }

    async checkOrderWebhook(webhookUrl) {
        if (!webhookUrl) return { configured: false, reason: 'missing_public_url' };
        const creds = await this.getCredentials();
        if (!creds) return { configured: false, reason: 'not_connected' };
        const list = await this.http.get(this.apiUrl(creds.storeId, '/webhooks'), this.requestOptions(creds));
        const existing = (list.data || []).find((item) => item.event === 'order/created' && item.url === webhookUrl);
        return existing
            ? { configured: true, id: existing.id }
            : { configured: false, reason: 'not_registered' };
    }

    async removeOrderWebhook(webhookUrl) {
        const creds = await this.getCredentials();
        if (!creds || !webhookUrl) return { removed: 0 };
        const options = this.requestOptions(creds);
        const list = await this.http.get(this.apiUrl(creds.storeId, '/webhooks'), options);
        const matches = (list.data || []).filter((item) => item.event === 'order/created' && item.url === webhookUrl);
        for (const item of matches) {
            await this.http.delete(this.apiUrl(creds.storeId, `/webhooks/${item.id}`), options);
        }
        return { removed: matches.length };
    }

    async getIntegrationStatus(webhookUrl) {
        const creds = await this.getCredentials();
        if (!creds) return { connected: false, webhook: { configured: false } };
        const [webhook, locationStatus] = await Promise.all([
            this.checkOrderWebhook(webhookUrl),
            this.getStockLocationStatus(creds)
        ]);
        return {
            connected: true,
            storeId: String(creds.storeId),
            apiVersion: this.apiVersion,
            locationId: creds.locationId || null,
            stockLocation: locationStatus,
            webhook
        };
    }

    async getStockLocationStatus(creds) {
        try {
            const response = await this.http.get(
                this.apiUrl(creds.storeId, '/locations?per_page=200'),
                this.requestOptions(creds)
            );
            const active = (response.data || []).filter((location) => location.active !== false);
            if (creds.locationId) {
                const exists = active.some((location) => String(location.id) === String(creds.locationId));
                return exists
                    ? { valid: true, locationId: String(creds.locationId) }
                    : { valid: false, message: 'El Location ID configurado no existe o no está activo.' };
            }
            if (active.length === 1) return { valid: true, locationId: String(active[0].id) };
            return { valid: false, message: active.length > 1
                ? 'Seleccione un Location ID para la tienda multiubicación.'
                : 'Tiendanube no informó ubicaciones activas.' };
        } catch (error) {
            return { valid: false, message: `No se pudo validar la ubicación: ${error.message}` };
        }
    }

    async autoLinkCatalog() {
        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Credenciales de Tienda Nube no configuradas.');
        }

        let page = 1;
        let hasMore = true;
        const allVariants = [];

        console.log('[TiendaNube Auto Link] Iniciando recuperación de catálogo desde la tienda...');

        while (hasMore) {
            const url = this.apiUrl(creds.storeId, `/products?per_page=200&page=${page}`);
            const response = await this.http.get(url, {
                ...this.requestOptions(creds)
            });

            const products = response.data;
            if (!products || products.length === 0) {
                hasMore = false;
                break;
            }

            for (const product of products) {
                for (const variant of product.variants || []) {
                    const sku = String(variant.sku || '').trim();
                    if (sku) {
                        allVariants.push({
                            productId: String(product.id),
                            variantId: String(variant.id),
                            sku: sku
                        });
                    }
                }
            }

            console.log(`[TiendaNube Auto Link] Página ${page} procesada. Encontradas ${allVariants.length} variantes con SKU hasta ahora.`);
            page++;
            
            // Si devuelve menos de 200 productos, significa que era la última página
            if (products.length < 200) {
                hasMore = false;
            }
        }

        let linkedCount = 0;
        console.log(`[TiendaNube Auto Link] Iniciando vinculación local para ${allVariants.length} variantes...`);

        for (const item of allVariants) {
            // Vinculamos solo si el producto local NO tiene vinculación previa para no sobreescribir manuales
            const [result] = await this.db.query(`
                UPDATE products 
                SET tiendanube_product_id = ?, tiendanube_variant_id = ?, tiendanube_sync_enabled = 1 
                WHERE sku = ? AND deleted_at IS NULL AND (tiendanube_product_id IS NULL OR tiendanube_variant_id IS NULL)
            `, [item.productId, item.variantId, item.sku]);

            if (result.affectedRows > 0) {
                linkedCount++;
                console.log(`[TiendaNube Auto Link] Producto con SKU '${item.sku}' enlazado con éxito (TN Product: ${item.productId}, Variant: ${item.variantId})`);
            }
        }

        console.log(`[TiendaNube Auto Link] Proceso finalizado. Total variantes encontradas: ${allVariants.length}, Vinculadas automáticamente: ${linkedCount}`);
        return { totalVariantsFound: allVariants.length, linkedCount };
    }
}

export default new TiendaNubeService();
