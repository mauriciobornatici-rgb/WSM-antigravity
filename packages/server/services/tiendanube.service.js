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
                return { ...normalized, eventId: null, duplicate: true };
            }
            throw error;
        }

        return { ...normalized, eventId, duplicate: false };
    }

    async markWebhookEvent(eventId, status, errorMessage = null) {
        if (!eventId) return;
        await this.db.query(
            `UPDATE tiendanube_webhook_events
             SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [status, errorMessage, eventId]
        );
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
            headers: this.requestHeaders(creds)
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
                items.push({
                    product_id: localProducts[0].id,
                    quantity: Number(product.quantity || 1)
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
            items
        }, null);

        return { status: 'created', orderId: result.id };
    }

    async processWebhookEvent(payload, salesService) {
        const eventRecord = await this.recordWebhookEvent(payload);
        if (eventRecord.duplicate) {
            return { status: 'duplicate' };
        }

        try {
            if (eventRecord.event.startsWith('order/')) {
                const order = await this.fetchOrder(eventRecord.resourceId, eventRecord.storeId);
                const result = await this.importOrderPayload(order, salesService);
                await this.markWebhookEvent(eventRecord.eventId, 'processed');
                return { status: 'processed', orderId: result.orderId, importStatus: result.status };
            }

            await this.markWebhookEvent(eventRecord.eventId, 'processed');
            return { status: 'ignored' };
        } catch (error) {
            await this.markWebhookEvent(eventRecord.eventId, 'failed', error.message);
            throw error;
        }
    }

    async getCredentials() {
        const [rows] = await this.db.query(`
            SELECT tiendanube_access_token, tiendanube_store_id,
                   tiendanube_client_id, tiendanube_client_secret
            FROM company_settings
            LIMIT 1
        `);
        const settings = rows[0] || {};
        
        const accessToken = decrypt(settings.tiendanube_access_token) || this.env.TIENDANUBE_ACCESS_TOKEN;
        const storeId = settings.tiendanube_store_id || this.env.TIENDANUBE_STORE_ID;
        const clientId = settings.tiendanube_client_id || this.env.TIENDANUBE_CLIENT_ID;
        const clientSecret = decrypt(settings.tiendanube_client_secret) || this.env.TIENDANUBE_CLIENT_SECRET;
        const userAgent = this.env.TIENDANUBE_USER_AGENT || 'WSM SportsERP (contacto@wsm.com)';

        if (!accessToken || !storeId) {
            return null;
        }

        return { accessToken, storeId, clientId, clientSecret, userAgent };
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
            
            const payload = {
                action: 'replace',
                value: Number(newStock),
                id: this.normalizeTiendanubeId(tiendanube_variant_id)
            };

            const response = await this.http.post(url, payload, {
                headers: this.requestHeaders(creds)
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
            SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts
            FROM failed_syncs
            WHERE id = ?
        `, [id]);

        if (rows.length === 0) {
            throw new Error('Registro de sincronización fallida no encontrado.');
        }

        const row = rows[0];
        const { product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts } = row;

        try {
            await this.db.query(`
                UPDATE failed_syncs
                SET status = 'retrying', last_attempt_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [id]);

            const url = this.apiUrl(creds.storeId, `/products/${tiendanube_product_id}/variants/stock`);
            const payload = {
                action: 'replace',
                value: Number(stock),
                id: this.normalizeTiendanubeId(tiendanube_variant_id)
            };

            await this.http.post(url, payload, {
                headers: this.requestHeaders(creds)
            });

            await this.db.query(`
                UPDATE failed_syncs
                SET status = 'completed', attempts = ?, last_error = NULL
                WHERE id = ?
            `, [attempts + 1, id]);

            return { success: true };
        } catch (error) {
            const nextAttempts = attempts + 1;
            const nextStatus = nextAttempts >= 5 ? 'failed' : 'pending';
            const errMsg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;

            await this.db.query(`
                UPDATE failed_syncs
                SET status = ?, attempts = ?, last_error = ?
                WHERE id = ?
            `, [nextStatus, nextAttempts, errMsg, id]);

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
            SELECT id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts
            FROM failed_syncs
            WHERE status IN ('pending', 'failed') AND attempts < max_attempts
            ORDER BY created_at ASC
        `);

        if (rows.length === 0) return;

        console.log(`[TiendaNube] Background sync starting for ${rows.length} failed syncs...`);

        for (const row of rows) {
            const { id, product_id, tiendanube_product_id, tiendanube_variant_id, stock, attempts } = row;
            try {
                await this.db.query(`
                    UPDATE failed_syncs
                    SET status = 'retrying', last_attempt_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [id]);

                const url = this.apiUrl(creds.storeId, `/products/${tiendanube_product_id}/variants/stock`);
                const payload = {
                    action: 'replace',
                    value: Number(stock),
                    id: this.normalizeTiendanubeId(tiendanube_variant_id)
                };

                await this.http.post(url, payload, {
                    headers: this.requestHeaders(creds)
                });

                await this.db.query(`
                    UPDATE failed_syncs
                    SET status = 'completed', attempts = ?, last_error = NULL
                    WHERE id = ?
                `, [attempts + 1, id]);

                console.log(`[TiendaNube] Background sync succeeded for product ${product_id} (Variant: ${tiendanube_variant_id})`);
            } catch (error) {
                const nextAttempts = attempts + 1;
                const nextStatus = nextAttempts >= 5 ? 'failed' : 'pending';
                const errMsg = error?.response?.data ? JSON.stringify(error.response.data) : error.message;

                await this.db.query(`
                    UPDATE failed_syncs
                    SET status = ?, attempts = ?, last_error = ?
                    WHERE id = ?
                `, [nextStatus, nextAttempts, errMsg, id]);

                console.error(`[TiendaNube] Background sync retry failed for product ${product_id}:`, errMsg);
            }
        }
    }

    async syncRecentOrders(salesService) {
        const creds = await this.getCredentials();
        if (!creds) {
            throw new Error('Credenciales de Tienda Nube no configuradas.');
        }

        const url = this.apiUrl(creds.storeId, '/orders?per_page=30');
        const response = await this.http.get(url, {
            headers: this.requestHeaders(creds)
        });

        const orders = response.data;
        let syncedCount = 0;

        for (const payload of orders) {
            // Verificamos si ya existe la orden buscando la nota identificadora
            const externalId = String(payload.id);
            const [existing] = await this.db.query(
                'SELECT id FROM orders WHERE external_source = ? AND external_id = ? LIMIT 1',
                ['tiendanube', externalId]
            );

            if (existing.length > 0) {
                continue; // Ya existe localmente
            }

            // Procesar y crear orden igual que el webhook
            if (!payload.products || !Array.isArray(payload.products)) {
                continue;
            }

            const items = [];
            for (const p of payload.products) {
                if (!p.sku) continue;
                
                const [localProducts] = await this.db.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [p.sku]);
                if (localProducts.length > 0) {
                    items.push({
                        product_id: localProducts[0].id,
                        quantity: p.quantity || 1
                    });
                }
            }

            if (items.length === 0) continue;

            const customerName = payload.customer?.name || payload.billing_address?.name || 'Cliente Tienda Nube';
            
            const orderData = {
                customer_name: customerName,
                counter_name: 'Sincronización Manual TN',
                payment_method: payload.payment_details?.method || 'transfer',
                shipping_method: 'delivery',
                shipping_address: payload.shipping_address?.address || null,
                notes: `TN_ORDER:${externalId}. Orden Tiendanube #${payload.number || externalId}. Sincronizada manualmente.`,
                external_source: 'tiendanube',
                external_id: externalId,
                items: items
            };

            await salesService.createOrder(orderData, null);
            console.log(`[TiendaNube Sync] Orden TN #${payload.id} sincronizada correctamente.`);
            syncedCount++;
        }

        return syncedCount;
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
                headers: this.requestHeaders(creds)
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
