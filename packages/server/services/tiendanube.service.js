import axios from 'axios';
import crypto from 'node:crypto';
import pool from '../config/db.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import auditService from './audit.service.js';

export class TiendaNubeService {
    constructor({ db = pool, http = axios, env = process.env } = {}) {
        this.db = db;
        this.http = http;
        this.env = env;
        this.apiHost = env.TIENDANUBE_API_HOST || 'https://api.tiendanube.com';
        this.apiVersion = env.TIENDANUBE_API_VERSION || '2025-03';
        this.httpTimeoutMs = Number(env.TIENDANUBE_HTTP_TIMEOUT_MS) || 10000;
        this.locationCache = null;
        this.nextApiRequestAt = 0;
        this.enforceRateLimit = http === axios && env.TIENDANUBE_DISABLE_RATE_LIMIT !== 'true';
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

    async waitForRateSlot() {
        if (!this.enforceRateLimit) return;
        const waitMs = Math.max(0, this.nextApiRequestAt - Date.now());
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        this.nextApiRequestAt = Date.now() + 500;
    }

    async apiRequest(method, creds, path, data) {
        await this.waitForRateSlot();
        const request = () => {
            const url = this.apiUrl(creds.storeId, path);
            return ['get', 'delete'].includes(method)
                ? this.http[method](url, this.requestOptions(creds))
                : this.http[method](url, data, this.requestOptions(creds));
        };
        try {
            return await request();
        } catch (error) {
            if (Number(error.response?.status) !== 429) throw error;
            const retryAfterSeconds = Math.max(1, Number(error.response?.headers?.['retry-after'] || 1));
            await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
            await this.waitForRateSlot();
            return request();
        }
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
        const resourceId = String(
            payload.id || payload.resource_id || payload.fulfillment_id || payload.order_id || ''
        ).trim();

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
            if (eventRecord.event.startsWith('order/')) {
                const order = await this.fetchOrder(eventRecord.resourceId, eventRecord.storeId);
                const result = await this.importOrderPayload(order, salesService);
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', orderId: result.orderId, importStatus: result.status };
            }

            if (eventRecord.event.startsWith('product/')) {
                if (eventRecord.event !== 'product/deleted') {
                    await this.importRemoteProduct(eventRecord.resourceId);
                } else {
                    await this.db.query(
                        `UPDATE tiendanube_catalog_families
                         SET visibility = 'hidden', sync_status = 'synced', last_synced_at = CURRENT_TIMESTAMP
                         WHERE remote_product_id = ?`,
                        [eventRecord.resourceId]
                    );
                }
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', productId: eventRecord.resourceId };
            }

            if (eventRecord.event.startsWith('customer/')) {
                if (eventRecord.event === 'customer/deleted') {
                    await this.db.query('DELETE FROM tiendanube_customers WHERE external_id = ?', [eventRecord.resourceId]);
                } else {
                    await this.importRemoteCustomer(eventRecord.resourceId);
                }
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', customerId: eventRecord.resourceId };
            }

            if (eventRecord.event.startsWith('app/')) {
                const connectionStatus = eventRecord.event.replace('app/', '');
                await this.db.query(
                    `UPDATE company_settings SET tiendanube_connection_status = ?,
                        tiendanube_access_token = IF(? = 'uninstalled', NULL, tiendanube_access_token),
                        tiendanube_store_id = IF(? = 'uninstalled', NULL, tiendanube_store_id)
                     WHERE tiendanube_store_id = ?`,
                    [connectionStatus, connectionStatus, connectionStatus, eventRecord.storeId]
                );
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', connectionStatus };
            }

            if (eventRecord.event.startsWith('fulfillment_order/')) {
                await this.syncFulfillmentsForExternalOrder(String(payload.order_id || ''));
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', fulfillmentId: payload.fulfillment_id || eventRecord.resourceId };
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

        const response = await this.apiRequest('get', creds, `/orders/${orderId}`);
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
            await this.persistOrderMetadata(existing[0].id, payload);
            await this.applyRemoteStatus(existing[0].id, payload, salesService);
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

        await this.persistOrderMetadata(result.id, payload);
        await this.applyRemoteStatus(result.id, payload, salesService);

        return { status: 'created', orderId: result.id };
    }

    localizedText(value, fallback = '') {
        if (typeof value === 'string') return value;
        if (!value || typeof value !== 'object') return fallback;
        return value.es || value['es-AR'] || value.pt || value.en || Object.values(value).find(Boolean) || fallback;
    }

    mysqlDate(value) {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 19).replace('T', ' ');
    }

    mapLocalOrderStatus(payload) {
        if (payload.status === 'cancelled' || payload.status === 'voided') return 'cancelled';
        if (payload.shipping_status === 'fulfilled') return 'delivered';
        if (payload.shipping_status === 'packed') return 'packed';
        if (payload.status === 'closed') return 'completed';
        return null;
    }

    // The remote status goes through the local transitions (never a direct UPDATE of
    // orders.status), so cancellations release stock and deliveries deduct it. A failure
    // propagates so the durable webhook queue retries it; metadata is already persisted
    // and every step is idempotent (it resumes from the order's current status).
    async applyRemoteStatus(orderId, payload, salesService) {
        const remoteStatus = this.mapLocalOrderStatus(payload);
        if (!remoteStatus || !salesService?.applyExternalStatus) return;
        try {
            await salesService.applyExternalStatus(orderId, remoteStatus);
        } catch (error) {
            error.message = `Estado remoto '${remoteStatus}' no aplicado al pedido ${orderId}: ${error.message}`;
            throw error;
        }
    }

    async persistOrderMetadata(orderId, payload) {
        const externalCustomerId = payload.customer?.id ? String(payload.customer.id) : null;
        const customerName = payload.customer?.name || payload.contact_name || payload.billing_name || 'Cliente Tiendanube';
        const contactEmail = payload.contact_email || payload.customer?.email || null;
        const contactPhone = payload.contact_phone || payload.customer?.phone || null;
        const identification = payload.contact_identification || payload.customer?.identification || null;

        if (externalCustomerId) {
            await this.db.query(
                `INSERT INTO tiendanube_customers (
                    external_id, name, email, phone, identification, default_address,
                    total_spent, orders_count, remote_payload, last_synced_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name), email = VALUES(email), phone = VALUES(phone),
                    identification = VALUES(identification), default_address = VALUES(default_address),
                    total_spent = GREATEST(total_spent, VALUES(total_spent)),
                    orders_count = GREATEST(orders_count, 1),
                    remote_payload = VALUES(remote_payload), last_synced_at = CURRENT_TIMESTAMP`,
                [
                    externalCustomerId,
                    customerName,
                    contactEmail,
                    contactPhone,
                    identification,
                    JSON.stringify(payload.customer?.default_address || payload.shipping_address || null),
                    Number(payload.customer?.total_spent || payload.total || 0),
                    JSON.stringify(payload.customer || {})
                ]
            );
        }

        await this.db.query(
            `INSERT INTO tiendanube_order_details (
                order_id, external_number, customer_external_id, contact_email, contact_phone,
                contact_identification, remote_status, remote_payment_status, remote_shipping_status,
                gateway, gateway_name, shipping_address, billing_address, remote_payload,
                remote_created_at, remote_updated_at, last_synced_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                external_number = VALUES(external_number), customer_external_id = VALUES(customer_external_id),
                contact_email = VALUES(contact_email), contact_phone = VALUES(contact_phone),
                contact_identification = VALUES(contact_identification), remote_status = VALUES(remote_status),
                remote_payment_status = VALUES(remote_payment_status), remote_shipping_status = VALUES(remote_shipping_status),
                gateway = VALUES(gateway), gateway_name = VALUES(gateway_name),
                shipping_address = VALUES(shipping_address), billing_address = VALUES(billing_address),
                remote_payload = VALUES(remote_payload), remote_created_at = VALUES(remote_created_at),
                remote_updated_at = VALUES(remote_updated_at), last_synced_at = CURRENT_TIMESTAMP`,
            [
                orderId,
                payload.number ? String(payload.number) : null,
                externalCustomerId,
                contactEmail,
                contactPhone,
                identification,
                payload.status || null,
                payload.payment_status || null,
                payload.shipping_status || null,
                payload.gateway || null,
                payload.gateway_name || payload.payment_details?.method || null,
                JSON.stringify(payload.shipping_address || null),
                JSON.stringify(payload.billing_address || null),
                JSON.stringify(payload),
                this.mysqlDate(payload.created_at),
                this.mysqlDate(payload.updated_at)
            ]
        );

        if (externalCustomerId) {
            await this.db.query(
                `UPDATE tiendanube_customers c SET
                    c.orders_count = (SELECT COUNT(*) FROM tiendanube_order_details d WHERE d.customer_external_id = c.external_id),
                    c.total_spent = (SELECT COALESCE(SUM(o.total_amount), 0)
                        FROM tiendanube_order_details d JOIN orders o ON o.id = d.order_id
                        WHERE d.customer_external_id = c.external_id AND o.status <> 'cancelled')
                 WHERE c.external_id = ?`,
                [externalCustomerId]
            );
        }

        await this.db.query(
            `UPDATE orders SET
                customer_name = COALESCE(?, customer_name),
                payment_status = COALESCE(?, payment_status),
                shipping_address = COALESCE(?, shipping_address),
                recipient_name = COALESCE(?, recipient_name),
                recipient_dni = COALESCE(?, recipient_dni),
                tracking_number = COALESCE(?, tracking_number)
             WHERE id = ?`,
            [
                customerName,
                payload.payment_status || null,
                this.formatShippingAddress(payload.shipping_address),
                payload.shipping_address?.name || customerName,
                identification,
                payload.shipping_tracking_number || null,
                orderId
            ]
        );

        const fulfillments = payload.fulfillment_orders?.results || payload.fulfillment_orders || [];
        if (Array.isArray(fulfillments) && fulfillments.length > 0) {
            await this.persistFulfillments(orderId, String(payload.id), fulfillments);
        }
    }

    async processWebhookEvent(payload, salesService) {
        const eventRecord = await this.recordWebhookEvent(payload);
        return this.processRecordedWebhookEvent(eventRecord, payload, salesService);
    }

    async getCredentials() {
        const [rows] = await this.db.query(`
            SELECT tiendanube_access_token, tiendanube_store_id,
                   tiendanube_location_id, tiendanube_client_id, tiendanube_client_secret,
                   tiendanube_connection_status
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

        return {
            accessToken, storeId, locationId, clientId, clientSecret, userAgent,
            connectionStatus: settings.tiendanube_connection_status || 'connected'
        };
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

        const response = await this.apiRequest('get', creds, '/locations?per_page=200');
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

            const locationId = await this.resolveStockLocation(creds);
            const payload = this.stockPayload(newStock, tiendanube_variant_id, locationId);
            const response = await this.apiRequest('post', creds, `/products/${tiendanube_product_id}/variants/stock`, payload);

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
            const locationId = await this.resolveStockLocation(creds);
            const payload = this.stockPayload(stock, tiendanube_variant_id, locationId);
            await this.apiRequest('post', creds, `/products/${tiendanube_product_id}/variants/stock`, payload);

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

                const locationId = await this.resolveStockLocation(creds);
                const payload = this.stockPayload(stock, tiendanube_variant_id, locationId);
                await this.apiRequest('post', creds, `/products/${tiendanube_product_id}/variants/stock`, payload);

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
            await this.waitForRateSlot();
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
        const list = await this.apiRequest('get', creds, '/webhooks');
        const events = [
            'order/created', 'order/paid', 'order/packed', 'order/fulfilled', 'order/cancelled',
            'order/edited', 'order/pending', 'order/voided', 'order/unpacked',
            'product/created', 'product/updated', 'product/deleted',
            'customer/created', 'customer/updated', 'customer/deleted',
            'fulfillment_order/status_updated', 'fulfillment_order/tracking_event_created',
            'fulfillment_order/tracking_event_updated', 'fulfillment_order/label_status_updated',
            'app/uninstalled', 'app/suspended', 'app/resumed'
        ];
        const registered = [];
        const created = [];
        for (const event of events) {
            const existing = (list.data || []).find((item) => item.event === event && item.url === webhookUrl);
            if (existing) {
                registered.push({ event, id: existing.id });
                continue;
            }
            const response = await this.apiRequest('post', creds, '/webhooks', { event, url: webhookUrl });
            registered.push({ event, id: response.data?.id });
            created.push(event);
        }
        return {
            configured: registered.length === events.length,
            created: created.length > 0,
            createdCount: created.length,
            expectedCount: events.length,
            events: registered,
            id: registered.find((entry) => entry.event === 'order/created')?.id
        };
    }

    async checkOrderWebhook(webhookUrl) {
        if (!webhookUrl) return { configured: false, reason: 'missing_public_url' };
        const creds = await this.getCredentials();
        if (!creds) return { configured: false, reason: 'not_connected' };
        const list = await this.apiRequest('get', creds, '/webhooks');
        const requiredEvents = [
            'order/created', 'order/paid', 'order/packed', 'order/fulfilled', 'order/cancelled',
            'order/edited', 'order/pending', 'order/voided', 'order/unpacked',
            'product/created', 'product/updated', 'product/deleted',
            'customer/created', 'customer/updated', 'customer/deleted',
            'fulfillment_order/status_updated', 'fulfillment_order/tracking_event_created',
            'fulfillment_order/tracking_event_updated', 'fulfillment_order/label_status_updated',
            'app/uninstalled', 'app/suspended', 'app/resumed'
        ];
        const matches = (list.data || []).filter((item) => requiredEvents.includes(item.event) && item.url === webhookUrl);
        const missingEvents = requiredEvents.filter((event) => !matches.some((item) => item.event === event));
        return missingEvents.length === 0
            ? { configured: true, id: matches[0]?.id, configuredCount: matches.length, expectedCount: requiredEvents.length, missingEvents: [] }
            : { configured: false, reason: 'not_registered', configuredCount: matches.length, expectedCount: requiredEvents.length, missingEvents };
    }

    async removeOrderWebhook(webhookUrl) {
        const creds = await this.getCredentials();
        if (!creds || !webhookUrl) return { removed: 0 };
        const list = await this.apiRequest('get', creds, '/webhooks');
        const matches = (list.data || []).filter((item) => item.url === webhookUrl);
        for (const item of matches) {
            await this.apiRequest('delete', creds, `/webhooks/${item.id}`);
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
            connectionStatus: creds.connectionStatus,
            storeId: String(creds.storeId),
            apiVersion: this.apiVersion,
            locationId: creds.locationId || null,
            stockLocation: locationStatus,
            webhook
        };
    }

    async getStockLocationStatus(creds) {
        try {
            const response = await this.apiRequest('get', creds, '/locations?per_page=200');
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
            const response = await this.apiRequest('get', creds, `/products?per_page=200&page=${page}`);

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

    async getOperationsOverview() {
        const [catalogRows, orderRows, syncRows, revenueRows] = await Promise.all([
            this.db.query(`
                SELECT
                    COUNT(*) AS families,
                    SUM(sync_status = 'synced') AS synced,
                    SUM(sync_status IN ('error', 'conflict')) AS attention,
                    SUM(visibility = 'visible') AS visible
                FROM tiendanube_catalog_families WHERE deleted_at IS NULL
            `),
            this.db.query(`
                SELECT
                    COUNT(*) AS orders,
                    SUM(COALESCE(d.remote_payment_status, o.payment_status) = 'paid') AS paid,
                    SUM(COALESCE(d.remote_shipping_status, '') IN ('unpacked', 'pending', '')) AS awaiting_fulfillment
                FROM orders o
                LEFT JOIN tiendanube_order_details d ON d.order_id = o.id
                WHERE o.external_source = 'tiendanube' AND o.deleted_at IS NULL
            `),
            this.db.query(`
                SELECT
                    (SELECT COUNT(*) FROM failed_syncs WHERE status IN ('pending', 'failed', 'retrying')) AS failed_stock,
                    (SELECT COUNT(*) FROM tiendanube_webhook_events WHERE status IN ('received', 'failed')) AS pending_events,
                    (SELECT MAX(last_synced_at) FROM tiendanube_order_details) AS last_order_sync,
                    (SELECT MAX(last_synced_at) FROM tiendanube_catalog_families) AS last_catalog_sync
            `),
            this.db.query(`
                SELECT COALESCE(SUM(total_amount), 0) AS revenue_30d
                FROM orders
                WHERE external_source = 'tiendanube' AND deleted_at IS NULL
                  AND status <> 'cancelled' AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
            `)
        ]);

        const status = await this.getCredentials();
        return {
            connected: Boolean(status),
            catalog: catalogRows[0][0],
            orders: orderRows[0][0],
            synchronization: syncRows[0][0],
            revenue30d: Number(revenueRows[0][0]?.revenue_30d || 0)
        };
    }

    async listCatalog({ page = 1, limit = 25, q, visibility, sync_status: syncStatus } = {}) {
        const where = ['f.deleted_at IS NULL'];
        const params = [];
        if (q) {
            where.push(`(f.name LIKE ? OR f.brand LIKE ? OR f.category LIKE ? OR EXISTS (
                SELECT 1 FROM tiendanube_catalog_variants qv
                JOIN products qp ON qp.id = qv.product_id
                WHERE qv.family_id = f.id AND qp.sku LIKE ?
            ))`);
            const search = `%${q}%`;
            params.push(search, search, search, search);
        }
        if (visibility) {
            where.push('f.visibility = ?');
            params.push(visibility);
        }
        if (syncStatus) {
            where.push('f.sync_status = ?');
            params.push(syncStatus);
        }

        const whereSql = where.join(' AND ');
        const [[countRow]] = await this.db.query(
            `SELECT COUNT(*) AS total FROM tiendanube_catalog_families f WHERE ${whereSql}`,
            params
        );
        const offset = (Number(page) - 1) * Number(limit);
        const [families] = await this.db.query(
            `SELECT f.*,
                    (SELECT COUNT(*) FROM tiendanube_catalog_variants v WHERE v.family_id = f.id) AS variant_count,
                    (SELECT COALESCE(SUM(i.quantity - i.reserved_quantity), 0)
                     FROM tiendanube_catalog_variants v
                     LEFT JOIN inventory i ON i.product_id = v.product_id
                     WHERE v.family_id = f.id AND (i.location IS NULL OR i.location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas'))) AS total_stock
             FROM tiendanube_catalog_families f
             WHERE ${whereSql}
             ORDER BY f.updated_at DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );
        if (families.length === 0) return { rows: [], total: Number(countRow.total || 0) };

        const placeholders = families.map(() => '?').join(',');
        const [variants] = await this.db.query(
            `SELECT v.id, v.family_id, v.remote_variant_id, v.sync_status, v.last_error,
                    p.id AS product_id, p.sku, p.barcode, p.name, p.size, p.color,
                    p.sale_price, p.purchase_price, p.image_url, p.status,
                    COALESCE(SUM(CASE WHEN i.location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
                        THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) AS stock
             FROM tiendanube_catalog_variants v
             JOIN products p ON p.id = v.product_id
             LEFT JOIN inventory i ON i.product_id = p.id
             WHERE v.family_id IN (${placeholders})
             GROUP BY v.id, v.family_id, v.remote_variant_id, v.sync_status, v.last_error,
                      p.id, p.sku, p.barcode, p.name, p.size, p.color,
                      p.sale_price, p.purchase_price, p.image_url, p.status
             ORDER BY p.sku`,
            families.map((family) => family.id)
        );
        const byFamily = new Map();
        for (const variant of variants) {
            const list = byFamily.get(variant.family_id) || [];
            list.push({ ...variant, stock: Number(variant.stock || 0) });
            byFamily.set(variant.family_id, list);
        }
        return {
            rows: families.map((family) => ({
                ...family,
                total_stock: Number(family.total_stock || 0),
                variants: byFamily.get(family.id) || []
            })),
            total: Number(countRow.total || 0)
        };
    }

    async createCatalogFamily(data) {
        const connection = await this.db.getConnection();
        const familyId = crypto.randomUUID();
        try {
            await connection.beginTransaction();
            const skus = data.variants.map((variant) => variant.sku);
            const placeholders = skus.map(() => '?').join(',');
            const [duplicates] = await connection.query(
                `SELECT sku FROM products WHERE sku IN (${placeholders}) AND deleted_at IS NULL`,
                skus
            );
            if (duplicates.length > 0) {
                const error = new Error(`Los SKU ya existen: ${duplicates.map((row) => row.sku).join(', ')}`);
                error.statusCode = 409;
                error.errorCode = 'DUPLICATE_SKU';
                throw error;
            }

            await connection.query(
                `INSERT INTO tiendanube_catalog_families
                 (id, name, description, brand, category, visibility, sync_status)
                 VALUES (?, ?, ?, ?, ?, ?, 'local_only')`,
                [familyId, data.name, data.description || null, data.brand || null, data.category || null, data.visibility]
            );

            for (const variant of data.variants) {
                const productId = crypto.randomUUID();
                const variantId = crypto.randomUUID();
                const stock = Number(variant.stock_initial || 0);
                await connection.query(
                    `INSERT INTO products (
                        id, sku, barcode, name, description, category, size, color, brand,
                        image_url, location, purchase_price, cost_price, sale_price, status,
                        tiendanube_sync_enabled
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'General', ?, ?, ?, 'active', 0)`,
                    [
                        productId, variant.sku, variant.barcode || null, data.name,
                        data.description || null, data.category || null, variant.size || null,
                        variant.color || null, data.brand || null, variant.image_url || null,
                        Number(variant.purchase_price || 0), Number(variant.purchase_price || 0),
                        Number(variant.sale_price || 0)
                    ]
                );
                await connection.query(
                    `INSERT INTO tiendanube_catalog_variants (id, family_id, product_id, sync_status)
                     VALUES (?, ?, ?, 'local_only')`,
                    [variantId, familyId, productId]
                );
                if (stock > 0) {
                    await connection.query(
                        `INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, 'General', ?)`,
                        [crypto.randomUUID(), productId, stock]
                    );
                    await connection.query(
                        `INSERT INTO inventory_movements (
                            id, type, product_id, to_location, quantity, unit_cost, reason,
                            reference_type, reference_id
                         ) VALUES (?, 'initial_stock', ?, 'General', ?, ?, 'Alta desde Tienda online', 'product', ?)`,
                        [crypto.randomUUID(), productId, stock, Number(variant.purchase_price || 0), productId]
                    );
                }
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        if (data.publish) await this.publishCatalogFamily(familyId);
        return (await this.getCatalogFamily(familyId));
    }

    async getCatalogFamily(familyId) {
        const [families] = await this.db.query(
            `SELECT * FROM tiendanube_catalog_families WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
            [familyId]
        );
        if (!families[0]) return null;
        const [variants] = await this.db.query(
            `SELECT v.id, v.family_id, v.remote_variant_id, v.sync_status, v.last_error,
                    p.id AS product_id, p.sku, p.barcode, p.name, p.size, p.color,
                    p.sale_price, p.purchase_price, p.image_url, p.status,
                    COALESCE(SUM(CASE WHEN i.location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
                        THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) AS stock
             FROM tiendanube_catalog_variants v
             JOIN products p ON p.id = v.product_id
             LEFT JOIN inventory i ON i.product_id = p.id
             WHERE v.family_id = ?
             GROUP BY v.id, v.family_id, v.remote_variant_id, v.sync_status, v.last_error,
                      p.id, p.sku, p.barcode, p.name, p.size, p.color,
                      p.sale_price, p.purchase_price, p.image_url, p.status
             ORDER BY p.sku`,
            [familyId]
        );
        return {
            ...families[0],
            variant_count: variants.length,
            total_stock: variants.reduce((total, variant) => total + Number(variant.stock || 0), 0),
            variants: variants.map((variant) => ({ ...variant, stock: Number(variant.stock || 0) }))
        };
    }

    async updateCatalogFamily(familyId, data) {
        const allowed = ['name', 'description', 'brand', 'category', 'visibility'];
        const entries = Object.entries(data).filter(([key]) => allowed.includes(key));
        if (entries.length === 0) return this.getCatalogFamily(familyId);
        const set = entries.map(([key]) => `${key} = ?`).join(', ');
        await this.db.query(
            `UPDATE tiendanube_catalog_families
             SET ${set}, sync_status = IF(remote_product_id IS NULL, 'local_only', 'pending'), last_error = NULL
             WHERE id = ? AND deleted_at IS NULL`,
            [...entries.map(([, value]) => value ?? null), familyId]
        );
        const productUpdates = {};
        if (data.name !== undefined) productUpdates.name = data.name;
        if (data.description !== undefined) productUpdates.description = data.description;
        if (data.brand !== undefined) productUpdates.brand = data.brand;
        if (data.category !== undefined) productUpdates.category = data.category;
        const productEntries = Object.entries(productUpdates);
        if (productEntries.length > 0) {
            await this.db.query(
                `UPDATE products p JOIN tiendanube_catalog_variants v ON v.product_id = p.id
                 SET ${productEntries.map(([key]) => `p.${key} = ?`).join(', ')}
                 WHERE v.family_id = ?`,
                [...productEntries.map(([, value]) => value ?? null), familyId]
            );
        }
        return this.getCatalogFamily(familyId);
    }

    async archiveCatalogFamily(familyId) {
        const [rows] = await this.db.query(
            `SELECT remote_product_id FROM tiendanube_catalog_families WHERE id = ? AND deleted_at IS NULL`,
            [familyId]
        );
        if (!rows[0]) return false;
        if (rows[0].remote_product_id) {
            const creds = await this.getCredentials();
            if (creds) {
                await this.apiRequest('put', creds, `/products/${rows[0].remote_product_id}`, { visibility: 'hidden' });
            }
        }
        await this.db.query(
            `UPDATE products p JOIN tiendanube_catalog_variants v ON v.product_id = p.id
             SET p.status = 'inactive' WHERE v.family_id = ?`,
            [familyId]
        );
        await this.db.query(
            `UPDATE tiendanube_catalog_families
             SET visibility = 'hidden', sync_status = 'synced', deleted_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [familyId]
        );
        return true;
    }

    buildRemoteProductPayload(family, variants) {
        const useSize = variants.some((variant) => Boolean(variant.size));
        const useColor = variants.some((variant) => Boolean(variant.color));
        const attributes = [
            ...(useSize ? [{ es: 'Talle' }] : []),
            ...(useColor ? [{ es: 'Color' }] : [])
        ];
        return {
            name: { es: family.name },
            description: { es: family.description || '' },
            brand: family.brand || null,
            visibility: family.visibility,
            attributes,
            variants: variants.map((variant) => ({
                ...(variant.remote_variant_id ? { id: this.normalizeTiendanubeId(variant.remote_variant_id) } : {}),
                sku: variant.sku,
                price: Number(variant.sale_price || 0).toFixed(2),
                cost: Number(variant.purchase_price || 0).toFixed(2),
                stock_management: true,
                stock: Number(variant.stock || 0),
                values: [
                    ...(useSize ? [{ es: variant.size || 'Único' }] : []),
                    ...(useColor ? [{ es: variant.color || 'Único' }] : [])
                ]
            })),
            images: [...new Set(variants.map((variant) => variant.image_url).filter(Boolean))]
                .slice(0, 9)
                .map((src) => ({ src }))
        };
    }

    async publishCatalogFamily(familyId) {
        const creds = await this.getCredentials();
        if (!creds) {
            const error = new Error('Conecte Tiendanube desde Configuración antes de publicar. El borrador local fue conservado.');
            error.statusCode = 409;
            error.errorCode = 'TIENDANUBE_NOT_CONNECTED';
            throw error;
        }
        const [families] = await this.db.query(
            `SELECT * FROM tiendanube_catalog_families WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
            [familyId]
        );
        const family = families[0];
        if (!family) {
            const error = new Error('Producto de tienda no encontrado');
            error.statusCode = 404;
            throw error;
        }
        const withVariants = await this.getCatalogFamily(familyId);
        if (!withVariants?.variants?.length) throw new Error('El producto no tiene variantes publicables');
        const payload = this.buildRemoteProductPayload(family, withVariants.variants);

        try {
            const response = family.remote_product_id
                ? await this.apiRequest('put', creds, `/products/${family.remote_product_id}`, payload)
                : await this.apiRequest('post', creds, '/products', payload);
            const remote = response.data;
            await this.db.query(
                `UPDATE tiendanube_catalog_families SET
                    remote_product_id = ?, visibility = ?, sync_status = 'synced', last_error = NULL,
                    remote_updated_at = ?, last_synced_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [String(remote.id), remote.visibility || family.visibility, this.mysqlDate(remote.updated_at), familyId]
            );
            const bySku = new Map((remote.variants || []).map((variant) => [String(variant.sku || ''), variant]));
            for (const variant of withVariants.variants) {
                const remoteVariant = bySku.get(String(variant.sku));
                if (!remoteVariant) continue;
                await this.db.query(
                    `UPDATE tiendanube_catalog_variants
                     SET remote_variant_id = ?, sync_status = 'synced', last_error = NULL, last_synced_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [String(remoteVariant.id), variant.id]
                );
                await this.db.query(
                    `UPDATE products SET tiendanube_product_id = ?, tiendanube_variant_id = ?, tiendanube_sync_enabled = 1
                     WHERE id = ?`,
                    [String(remote.id), String(remoteVariant.id), variant.product_id]
                );
            }
            return { remoteProductId: String(remote.id), product: remote };
        } catch (error) {
            await this.db.query(
                `UPDATE tiendanube_catalog_families SET sync_status = 'error', last_error = ? WHERE id = ?`,
                [String(error.response?.data?.description || error.message || error).slice(0, 65000), familyId]
            );
            throw error;
        }
    }

    async importRemoteProduct(remoteProductId) {
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const response = await this.apiRequest('get', creds, `/products/${remoteProductId}`);
        return this.persistRemoteProduct(response.data);
    }

    async importRemoteCustomer(remoteCustomerId) {
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const response = await this.apiRequest('get', creds, `/customers/${remoteCustomerId}`);
        return this.persistRemoteCustomer(response.data);
    }

    async persistRemoteCustomer(customer) {
        const externalId = String(customer.id || '').trim();
        if (!externalId) throw new Error('Tiendanube customer id is required');
        const name = customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Cliente Tiendanube';
        await this.db.query(
            `INSERT INTO tiendanube_customers (
                external_id, name, email, phone, identification, default_address,
                total_spent, orders_count, remote_payload, last_synced_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
                name = VALUES(name), email = VALUES(email), phone = VALUES(phone),
                identification = VALUES(identification), default_address = VALUES(default_address),
                total_spent = VALUES(total_spent), orders_count = VALUES(orders_count),
                remote_payload = VALUES(remote_payload), last_synced_at = CURRENT_TIMESTAMP`,
            [
                externalId, name, customer.email || null, customer.phone || null,
                customer.identification || null, JSON.stringify(customer.default_address || null),
                Number(customer.total_spent || 0), Number(customer.orders_count || 0), JSON.stringify(customer)
            ]
        );
        return { externalId, name };
    }

    async persistRemoteProduct(remote) {
        const remoteId = String(remote.id);
        const name = String(this.localizedText(remote.name, `Producto ${remoteId}`));
        const description = String(this.localizedText(remote.description, ''));
        const [families] = await this.db.query(
            `SELECT id FROM tiendanube_catalog_families WHERE remote_product_id = ? LIMIT 1`,
            [remoteId]
        );
        const familyId = families[0]?.id || crypto.randomUUID();
        await this.db.query(
            `INSERT INTO tiendanube_catalog_families (
                id, name, description, brand, category, visibility, remote_product_id,
                sync_status, remote_updated_at, last_synced_at, deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', ?, CURRENT_TIMESTAMP, NULL)
             ON DUPLICATE KEY UPDATE
                name = VALUES(name), description = VALUES(description), brand = VALUES(brand),
                visibility = VALUES(visibility), sync_status = 'synced', last_error = NULL,
                remote_updated_at = VALUES(remote_updated_at), last_synced_at = CURRENT_TIMESTAMP,
                deleted_at = NULL`,
            [
                familyId, name, description || null, remote.brand || null,
                this.localizedText(remote.categories?.[0]?.name, null), remote.visibility || (remote.published ? 'visible' : 'hidden'),
                remoteId, this.mysqlDate(remote.updated_at)
            ]
        );

        let linkedCount = 0;
        let skippedCount = 0;
        for (const variant of remote.variants || []) {
            const sku = String(variant.sku || '').trim();
            if (!sku) {
                skippedCount++;
                continue;
            }
            const [products] = await this.db.query(
                `SELECT id FROM products WHERE sku = ? AND deleted_at IS NULL LIMIT 1`,
                [sku]
            );
            let productId = products[0]?.id;
            if (!productId) {
                productId = crypto.randomUUID();
                const values = (variant.values || []).map((value) => this.localizedText(value, null));
                const attributes = (remote.attributes || []).map((attribute) => this.localizedText(attribute, '').toLowerCase());
                const sizeIndex = attributes.findIndex((attribute) => ['talle', 'size', 'tamanho'].includes(attribute));
                const colorIndex = attributes.findIndex((attribute) => ['color', 'cor'].includes(attribute));
                await this.db.query(
                    `INSERT INTO products (
                        id, sku, name, description, category, size, color, brand, image_url,
                        location, purchase_price, cost_price, sale_price, status,
                        tiendanube_product_id, tiendanube_variant_id, tiendanube_sync_enabled
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'General', ?, ?, ?, 'active', ?, ?, 1)`,
                    [
                        productId, sku, name, description || null,
                        this.localizedText(remote.categories?.[0]?.name, null),
                        sizeIndex >= 0 ? values[sizeIndex] || null : null,
                        colorIndex >= 0 ? values[colorIndex] || null : null,
                        remote.brand || null, remote.images?.[0]?.src || null,
                        Number(variant.cost || 0), Number(variant.cost || 0), Number(variant.price || 0),
                        remoteId, String(variant.id)
                    ]
                );
                const stock = Math.max(0, Number(variant.stock || 0));
                if (stock > 0) {
                    await this.db.query(
                        `INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, 'General', ?)`,
                        [crypto.randomUUID(), productId, stock]
                    );
                }
            } else {
                await this.db.query(
                    `UPDATE products SET tiendanube_product_id = ?, tiendanube_variant_id = ?, tiendanube_sync_enabled = 1
                     WHERE id = ?`,
                    [remoteId, String(variant.id), productId]
                );
            }
            await this.db.query(
                `INSERT INTO tiendanube_catalog_variants (
                    id, family_id, product_id, remote_variant_id, sync_status, last_synced_at
                 ) VALUES (?, ?, ?, ?, 'synced', CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    family_id = VALUES(family_id), remote_variant_id = VALUES(remote_variant_id),
                    sync_status = 'synced', last_error = NULL, last_synced_at = CURRENT_TIMESTAMP`,
                [crypto.randomUUID(), familyId, productId, String(variant.id)]
            );
            linkedCount++;
        }
        return { familyId, remoteProductId: remoteId, linkedCount, skippedCount };
    }

    async importRemoteCatalog({ q } = {}) {
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const runId = crypto.randomUUID();
        await this.db.query(
            `INSERT INTO tiendanube_sync_runs (id, operation) VALUES (?, 'catalog_import')`,
            [runId]
        );
        let page = 1;
        let processed = 0;
        let succeeded = 0;
        const failures = [];
        try {
            while (page <= 500) {
                const search = q ? `&q=${encodeURIComponent(q)}` : '';
                const response = await this.apiRequest('get', creds, `/products?per_page=200&page=${page}${search}`);
                const products = response.data || [];
                for (const remote of products) {
                    processed++;
                    try {
                        await this.persistRemoteProduct(remote);
                        succeeded++;
                    } catch (error) {
                        failures.push({ id: String(remote.id || ''), message: error.message });
                    }
                }
                if (products.length < 200) break;
                page++;
            }
            await this.db.query(
                `UPDATE tiendanube_sync_runs SET status = ?, processed_count = ?, success_count = ?,
                    failure_count = ?, details = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [failures.length ? 'completed_with_errors' : 'completed', processed, succeeded, failures.length, JSON.stringify(failures), runId]
            );
            return { runId, processed, succeeded, failures, pages: page };
        } catch (error) {
            await this.db.query(
                `UPDATE tiendanube_sync_runs SET status = 'failed', processed_count = ?, success_count = ?,
                    failure_count = ?, details = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [processed, succeeded, failures.length + 1, JSON.stringify([...failures, { message: error.message }]), runId]
            );
            throw error;
        }
    }

    async listOperationsOrders({ page = 1, limit = 25, q, payment_status: paymentStatus, shipping_status: shippingStatus, from, to } = {}) {
        const where = [`o.external_source = 'tiendanube'`, 'o.deleted_at IS NULL'];
        const params = [];
        if (q) {
            where.push(`(o.customer_name LIKE ? OR d.external_number LIKE ? OR d.contact_email LIKE ? OR d.contact_phone LIKE ? OR o.external_id LIKE ?)`);
            const search = `%${q}%`;
            params.push(search, search, search, search, search);
        }
        if (paymentStatus) {
            where.push('COALESCE(d.remote_payment_status, o.payment_status) = ?');
            params.push(paymentStatus);
        }
        if (shippingStatus) {
            where.push('d.remote_shipping_status = ?');
            params.push(shippingStatus);
        }
        if (from) {
            where.push('DATE(o.created_at) >= DATE(?)');
            params.push(from);
        }
        if (to) {
            where.push('DATE(o.created_at) <= DATE(?)');
            params.push(to);
        }
        const whereSql = where.join(' AND ');
        const [[count]] = await this.db.query(
            `SELECT COUNT(*) AS total FROM orders o LEFT JOIN tiendanube_order_details d ON d.order_id = o.id WHERE ${whereSql}`,
            params
        );
        const [rows] = await this.db.query(
            `SELECT o.*, d.external_number, d.customer_external_id, d.contact_email, d.contact_phone,
                    d.contact_identification, d.remote_status,
                    COALESCE(d.remote_payment_status, o.payment_status) AS remote_payment_status,
                    d.remote_shipping_status, d.gateway, d.gateway_name, d.shipping_address AS shipping_address_json,
                    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_lines,
                    (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS item_units,
                    (SELECT COUNT(*) FROM tiendanube_fulfillments f WHERE f.order_id = o.id) AS fulfillment_count
             FROM orders o
             LEFT JOIN tiendanube_order_details d ON d.order_id = o.id
             WHERE ${whereSql}
             ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), (Number(page) - 1) * Number(limit)]
        );
        return { rows, total: Number(count.total || 0) };
    }

    async listOperationsCustomers({ page = 1, limit = 25, q } = {}) {
        const params = [];
        const where = [];
        if (q) {
            const search = `%${q}%`;
            where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR identification LIKE ?)');
            params.push(search, search, search, search);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [[count]] = await this.db.query(`SELECT COUNT(*) AS total FROM tiendanube_customers ${whereSql}`, params);
        const [rows] = await this.db.query(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM tiendanube_order_details d WHERE d.customer_external_id = c.external_id) AS actual_orders_count,
                    (SELECT COALESCE(SUM(o.total_amount), 0) FROM tiendanube_order_details d JOIN orders o ON o.id = d.order_id
                     WHERE d.customer_external_id = c.external_id AND o.status <> 'cancelled') AS actual_total_spent
             FROM tiendanube_customers c ${whereSql}
             ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), (Number(page) - 1) * Number(limit)]
        );
        return { rows, total: Number(count.total || 0) };
    }

    async persistFulfillments(orderId, externalOrderId, fulfillments) {
        for (const fulfillment of fulfillments || []) {
            await this.db.query(
                `INSERT INTO tiendanube_fulfillments (
                    id, order_id, external_order_id, number, status, assigned_location_id,
                    recipient, destination, shipping, tracking_info, tracking_events,
                    fulfilled_at, remote_payload, remote_created_at, remote_updated_at, last_synced_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    number = VALUES(number), status = VALUES(status), assigned_location_id = VALUES(assigned_location_id),
                    recipient = VALUES(recipient), destination = VALUES(destination), shipping = VALUES(shipping),
                    tracking_info = VALUES(tracking_info), tracking_events = VALUES(tracking_events),
                    fulfilled_at = VALUES(fulfilled_at), remote_payload = VALUES(remote_payload),
                    remote_updated_at = VALUES(remote_updated_at), last_synced_at = CURRENT_TIMESTAMP`,
                [
                    String(fulfillment.id), orderId, externalOrderId, fulfillment.number ? String(fulfillment.number) : null,
                    fulfillment.status || 'UNPACKED', fulfillment.assigned_location?.location_id || null,
                    JSON.stringify(fulfillment.recipient || null), JSON.stringify(fulfillment.destination || null),
                    JSON.stringify(fulfillment.shipping || null), JSON.stringify(fulfillment.tracking_info || null),
                    JSON.stringify(fulfillment.tracking_events || []), this.mysqlDate(fulfillment.fulfilled_at),
                    JSON.stringify(fulfillment), this.mysqlDate(fulfillment.created_at), this.mysqlDate(fulfillment.updated_at)
                ]
            );
        }
    }

    async syncFulfillmentsForExternalOrder(externalOrderId) {
        if (!externalOrderId) return { synced: 0 };
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const [orders] = await this.db.query(
            `SELECT id FROM orders WHERE external_source = 'tiendanube' AND external_id = ? LIMIT 1`,
            [externalOrderId]
        );
        if (!orders[0]) return { synced: 0, reason: 'order_not_imported' };
        const response = await this.apiRequest('get', creds, `/orders/${externalOrderId}/fulfillment-orders?per_page=100`);
        const fulfillments = response.data?.results || response.data || [];
        await this.persistFulfillments(orders[0].id, externalOrderId, fulfillments);
        return { synced: fulfillments.length };
    }

    async syncAllFulfillments() {
        const [orders] = await this.db.query(
            `SELECT external_id FROM orders WHERE external_source = 'tiendanube' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`
        );
        let synced = 0;
        const failures = [];
        for (const order of orders) {
            try {
                const result = await this.syncFulfillmentsForExternalOrder(order.external_id);
                synced += result.synced;
            } catch (error) {
                failures.push({ externalId: order.external_id, message: error.message });
            }
        }
        return { orders: orders.length, synced, failures };
    }

    async listFulfillments({ page = 1, limit = 25, q, shipping_status: status } = {}) {
        const where = [];
        const params = [];
        if (q) {
            const search = `%${q}%`;
            where.push('(f.number LIKE ? OR f.external_order_id LIKE ? OR o.customer_name LIKE ? OR o.tracking_number LIKE ?)');
            params.push(search, search, search, search);
        }
        if (status) {
            where.push('f.status = ?');
            params.push(status);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [[count]] = await this.db.query(
            `SELECT COUNT(*) AS total FROM tiendanube_fulfillments f JOIN orders o ON o.id = f.order_id ${whereSql}`,
            params
        );
        const [rows] = await this.db.query(
            `SELECT f.*, o.customer_name, o.shipping_address AS local_shipping_address,
                    o.tracking_number, o.estimated_delivery, d.contact_email, d.contact_phone,
                    d.contact_identification, d.external_number
             FROM tiendanube_fulfillments f
             JOIN orders o ON o.id = f.order_id
             LEFT JOIN tiendanube_order_details d ON d.order_id = o.id
             ${whereSql} ORDER BY f.updated_at DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), (Number(page) - 1) * Number(limit)]
        );
        return { rows, total: Number(count.total || 0) };
    }

    async updateFulfillment(fulfillmentId, data) {
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const [rows] = await this.db.query(
            `SELECT f.*, o.id AS local_order_id FROM tiendanube_fulfillments f
             JOIN orders o ON o.id = f.order_id WHERE f.id = ? LIMIT 1`,
            [fulfillmentId]
        );
        const fulfillment = rows[0];
        if (!fulfillment) {
            const error = new Error('Envío no encontrado');
            error.statusCode = 404;
            throw error;
        }
        const payload = {
            ...(data.status ? { status: data.status } : {}),
            ...((data.tracking_code !== undefined || data.tracking_url !== undefined) ? {
                tracking_info: {
                    code: data.tracking_code ?? null,
                    url: data.tracking_url ?? null,
                    notify_customer: data.notify_customer !== false
                }
            } : {})
        };
        const response = await this.apiRequest('patch', creds, `/orders/${fulfillment.external_order_id}/fulfillment-orders/${fulfillmentId}`, payload);
        await this.persistFulfillments(fulfillment.local_order_id, fulfillment.external_order_id, [response.data]);
        await this.db.query(
            `UPDATE orders SET tracking_number = COALESCE(?, tracking_number),
                dispatched_at = CASE WHEN ? = 'DISPATCHED' THEN COALESCE(dispatched_at, CURRENT_TIMESTAMP) ELSE dispatched_at END,
                delivered_at = CASE WHEN ? = 'DELIVERED' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP) ELSE delivered_at END
             WHERE id = ?`,
            [data.tracking_code ?? null, data.status || '', data.status || '', fulfillment.local_order_id]
        );
        // The local status moves only through the real transitions (stock effects).
        // PACKED is not applied: packing is recorded by the local picking flow.
        const localStatus = { DISPATCHED: 'dispatched', DELIVERED: 'delivered' }[data.status];
        if (localStatus) {
            const { default: salesService } = await import('./sales.service.js');
            await salesService.applyExternalStatus(fulfillment.local_order_id, localStatus);
        }
        return response.data;
    }

    async createTrackingEvent(fulfillmentId, data) {
        const creds = await this.getCredentials();
        if (!creds) throw new Error('Credenciales de Tiendanube no configuradas.');
        const [rows] = await this.db.query(
            `SELECT id, order_id, external_order_id FROM tiendanube_fulfillments WHERE id = ? LIMIT 1`,
            [fulfillmentId]
        );
        const fulfillment = rows[0];
        if (!fulfillment) {
            const error = new Error('Envío no encontrado');
            error.statusCode = 404;
            throw error;
        }
        const response = await this.apiRequest('post', creds, `/orders/${fulfillment.external_order_id}/fulfillment-orders/${fulfillmentId}/tracking-events`, data);
        await this.syncFulfillmentsForExternalOrder(fulfillment.external_order_id);
        return response.data;
    }

    async getOperationsAnalytics() {
        const [daily, products, states, customers] = await Promise.all([
            this.db.query(`
                SELECT DATE(o.created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(o.total_amount), 0) AS revenue
                FROM orders o
                WHERE o.external_source = 'tiendanube' AND o.deleted_at IS NULL
                  AND o.status <> 'cancelled' AND o.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)
                GROUP BY DATE(o.created_at) ORDER BY date
            `),
            this.db.query(`
                SELECT p.sku, p.name, p.size, p.color, SUM(oi.quantity) AS units,
                       SUM(oi.subtotal) AS revenue
                FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
                WHERE o.external_source = 'tiendanube' AND o.deleted_at IS NULL AND o.status <> 'cancelled'
                  AND o.created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)
                GROUP BY p.id, p.sku, p.name, p.size, p.color ORDER BY units DESC LIMIT 10
            `),
            this.db.query(`
                SELECT COALESCE(d.remote_payment_status, o.payment_status, 'sin estado') AS state, COUNT(*) AS total
                FROM orders o LEFT JOIN tiendanube_order_details d ON d.order_id = o.id
                WHERE o.external_source = 'tiendanube' AND o.deleted_at IS NULL GROUP BY state
            `),
            this.db.query(`
                SELECT c.external_id, c.name, c.email, COUNT(d.order_id) AS orders,
                       COALESCE(SUM(o.total_amount), 0) AS revenue
                FROM tiendanube_customers c
                LEFT JOIN tiendanube_order_details d ON d.customer_external_id = c.external_id
                LEFT JOIN orders o ON o.id = d.order_id AND o.status <> 'cancelled'
                GROUP BY c.external_id, c.name, c.email ORDER BY revenue DESC LIMIT 10
            `)
        ]);
        return {
            daily: daily[0].map((row) => ({ ...row, revenue: Number(row.revenue || 0), orders: Number(row.orders || 0) })),
            topProducts: products[0].map((row) => ({ ...row, units: Number(row.units || 0), revenue: Number(row.revenue || 0) })),
            paymentStates: states[0].map((row) => ({ ...row, total: Number(row.total || 0) })),
            topCustomers: customers[0].map((row) => ({ ...row, orders: Number(row.orders || 0), revenue: Number(row.revenue || 0) }))
        };
    }

    async getSyncCenter() {
        const [runs, events, failed] = await Promise.all([
            this.db.query(`SELECT * FROM tiendanube_sync_runs ORDER BY created_at DESC LIMIT 25`),
            this.db.query(`SELECT id, event, resource_id, status, attempts, max_attempts, error_message,
                                  processed_at, next_attempt_at, created_at
                           FROM tiendanube_webhook_events ORDER BY created_at DESC LIMIT 50`),
            this.getFailedSyncs()
        ]);
        return { runs: runs[0], events: events[0], failedStock: failed };
    }

    async getOAuthClientId() {
        const [rows] = await this.db.query('SELECT tiendanube_client_id FROM company_settings LIMIT 1');
        return rows[0]?.tiendanube_client_id;
    }

    // Devuelve el id de la fila de ajustes y las credenciales OAuth (el secreto ya descifrado, solo para uso interno).
    async getOAuthCredentials() {
        const [rows] = await this.db.query('SELECT id, tiendanube_client_id, tiendanube_client_secret FROM company_settings LIMIT 1');
        const settings = rows[0] || {};
        return {
            settingsId: rows[0]?.id,
            clientId: settings.tiendanube_client_id,
            clientSecret: decrypt(settings.tiendanube_client_secret)
        };
    }

    async saveOAuthConnection(settingsId, accessToken, storeId) {
        await this.db.query(
            `UPDATE company_settings SET tiendanube_access_token = ?, tiendanube_store_id = ?,
                tiendanube_connection_status = 'connected' WHERE id = ?`,
            [encrypt(accessToken), storeId, settingsId]
        );
    }

    async readConfig(executor = this.db, forUpdate = false) {
        const [rows] = await executor.query(
            `SELECT tiendanube_client_id, tiendanube_client_secret, tiendanube_location_id
         FROM company_settings WHERE id = 1 LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`
        );
        const settings = rows[0] || {};
        return {
            clientId: settings.tiendanube_client_id || '',
            clientSecretConfigured: Boolean(settings.tiendanube_client_secret),
            locationId: settings.tiendanube_location_id || ''
        };
    }

    async updateConfig({ clientId, clientSecret, locationId }, userId) {
        const encryptedSecret = clientSecret?.trim() ? encrypt(clientSecret.trim()) : null;
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            const previous = await this.readConfig(connection, true);
            await connection.query(
                `INSERT INTO company_settings (
                id, tiendanube_client_id, tiendanube_client_secret, tiendanube_location_id
             ) VALUES (1, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                tiendanube_client_id = VALUES(tiendanube_client_id),
                tiendanube_client_secret = COALESCE(VALUES(tiendanube_client_secret), tiendanube_client_secret),
                tiendanube_location_id = VALUES(tiendanube_location_id)`,
                [clientId, encryptedSecret, locationId]
            );
            const updated = await this.readConfig(connection);
            await auditService.log({
                user_id: userId || null,
                action: 'UPDATE_TIENDANUBE_CONFIG',
                entity_type: 'company_settings',
                entity_id: '1',
                old_values: previous,
                new_values: updated
            }, connection);
            await connection.commit();
            return updated;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async markDisconnected() {
        await this.db.query(
            `UPDATE company_settings
         SET tiendanube_access_token = NULL, tiendanube_store_id = NULL,
             tiendanube_connection_status = 'disconnected'
         WHERE id = 1`
        );
    }
}

export default new TiendaNubeService();
