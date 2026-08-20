import axios from 'axios';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import tiendaNubeService from '../services/tiendanube.service.js';
import salesService from '../services/sales.service.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { getEnvConfig } from '../config/env.js';
import { applyPaginationHeaders } from '../utils/pagination.js';

function settingsRedirect(params = {}) {
    const baseUrl = getEnvConfig().appBaseUrl;
    const url = new URL('/settings', baseUrl);
    url.searchParams.set('tab', 'tiendanube');
    for (const [key, value] of Object.entries(params)) {
        if (value != null) url.searchParams.set(key, String(value));
    }
    return url.toString();
}

export const authorizeTiendaNube = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT tiendanube_client_id FROM company_settings LIMIT 1');
    const clientId = rows[0]?.tiendanube_client_id;

    if (!clientId) {
        return res.status(400).send('Tienda Nube Client ID no esta configurado en la aplicacion.');
    }

    const state = tiendaNubeService.createOAuthState({ userId: req.user?.id || null });
    const redirectUrl = `https://www.tiendanube.com/apps/${clientId}/authorize?state=${encodeURIComponent(state)}`;
    res.redirect(redirectUrl);
});

export const callbackTiendaNube = catchAsync(async (req, res) => {
    const { code, state } = req.query;
    if (!code) {
        return res.status(400).send('Authorization code no recibido.');
    }
    if (!state) {
        return res.status(400).send('OAuth state no recibido.');
    }

    const oauthState = tiendaNubeService.verifyOAuthState(state);

    const [rows] = await pool.query('SELECT id, tiendanube_client_id, tiendanube_client_secret FROM company_settings LIMIT 1');
    const settings = rows[0] || {};
    const clientId = settings.tiendanube_client_id;
    const clientSecret = decrypt(settings.tiendanube_client_secret);

    if (!clientId || !clientSecret) {
        return res.status(400).send('Las credenciales OAuth de Tienda Nube no estan configuradas.');
    }

    try {
        const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code
        }, { timeout: 10000 });

        const { access_token, user_id } = response.data;
        if (!access_token || !user_id) {
            throw new Error('Tiendanube OAuth response did not include access_token and user_id');
        }

        await pool.query(
            `UPDATE company_settings SET tiendanube_access_token = ?, tiendanube_store_id = ?,
                tiendanube_connection_status = 'connected' WHERE id = ?`,
            [encrypt(access_token), user_id, rows[0].id]
        );

        await auditService.log({
            user_id: oauthState.userId || null,
            action: 'OAUTH_TIENDANUBE_SUCCESS',
            entity_type: 'company_settings',
            entity_id: '1',
            new_values: { tiendanube_store_id: user_id }
        });

        let webhookStatus = 'not_configured';
        const webhookUrl = getEnvConfig().tiendanubeWebhookUrl;
        if (webhookUrl) {
            try {
                const webhook = await tiendaNubeService.ensureOrderWebhook(webhookUrl);
                webhookStatus = webhook.configured ? 'configured' : 'not_configured';
            } catch (webhookError) {
                webhookStatus = 'error';
                console.error('[TiendaNube OAuth] Token saved but webhook registration failed:', webhookError.message);
            }
        }

        res.redirect(settingsRedirect({ success: 1, webhook: webhookStatus }));
    } catch (error) {
        console.error('Error in OAuth callback:', error.response?.data || error.message);
        res.status(500).send('Error al autorizar con Tienda Nube.');
    }
});

export const webhookTiendaNube = catchAsync(async (req, res) => {
    const payload = req.body || {};
    const signature = req.headers['x-linkedstore-hmac-sha256'];
    const creds = await tiendaNubeService.getCredentials();

    if (!creds?.clientSecret) {
        return res.status(503).json({ error: 'tiendanube_not_configured' });
    }

    // Without the raw bytes the HMAC cannot be verified; re-serializing the
    // parsed body produces a different signature and would silently reject.
    if (!req.rawBody) {
        console.error('[TiendaNube Webhook] rawBody unavailable: check express.json verify option');
        return res.status(500).json({ error: 'raw_body_unavailable' });
    }

    const verified = tiendaNubeService.verifyWebhookSignature(req.rawBody, signature, creds.clientSecret);
    if (!verified) {
        return res.status(401).json({ error: 'invalid_tiendanube_signature' });
    }

    console.log(`[TiendaNube Webhook] Received ${payload.event} for store ${payload.store_id}`);

    try {
        const eventRecord = await tiendaNubeService.recordWebhookEvent(payload);
        if (!eventRecord.duplicate) {
            setImmediate(() => {
                tiendaNubeService.processRecordedWebhookEvent(eventRecord, payload, salesService)
                    .then((result) => console.log(`[TiendaNube Webhook] Processed ${payload.event} ${payload.id}: ${result.status}`))
                    .catch((error) => console.error('[TiendaNube Webhook] Deferred processing failed:', error));
            });
        }
        return res.status(eventRecord.duplicate ? 200 : 202).send('OK');
    } catch (err) {
        console.error('[TiendaNube Webhook] Error processing webhook:', err);
        return res.status(500).json({ error: 'webhook_processing_failed' });
    }
});

export const webhookOrdersCreated = webhookTiendaNube;

export const syncRecentOrdersController = catchAsync(async (req, res) => {
    try {
        const result = await tiendaNubeService.syncRecentOrders(salesService);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[TiendaNube Sync Error]', error);
        res.status(500).json({ error: error.message || 'Error sincronizando ordenes' });
    }
});

export const getTiendaNubeStatusController = catchAsync(async (req, res) => {
    const status = await tiendaNubeService.getIntegrationStatus(getEnvConfig().tiendanubeWebhookUrl);
    res.json(status);
});

export const ensureTiendaNubeWebhookController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.ensureOrderWebhook(getEnvConfig().tiendanubeWebhookUrl);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'ENSURE_TIENDANUBE_WEBHOOK',
        entity_type: 'company_settings',
        entity_id: '1',
        new_values: result
    });
    res.json({ success: true, ...result });
});

export const disconnectTiendaNubeController = catchAsync(async (req, res) => {
    if (process.env.TIENDANUBE_ACCESS_TOKEN || process.env.TIENDANUBE_STORE_ID) {
        return res.status(409).json({
            error: 'tiendanube_environment_credentials',
            message: 'La integración usa credenciales de entorno. Elimínelas antes de desconectar desde la aplicación.'
        });
    }
    let webhookResult = { removed: 0 };
    try {
        webhookResult = await tiendaNubeService.removeOrderWebhook(getEnvConfig().tiendanubeWebhookUrl);
    } catch (error) {
        console.error('[TiendaNube Disconnect] Could not remove remote webhook:', error.message);
    }

    await pool.query(
        `UPDATE company_settings
         SET tiendanube_access_token = NULL, tiendanube_store_id = NULL,
             tiendanube_connection_status = 'disconnected'
         WHERE id = 1`
    );
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'DISCONNECT_TIENDANUBE',
        entity_type: 'company_settings',
        entity_id: '1',
        new_values: webhookResult
    });
    res.json({ success: true, ...webhookResult });
});

export const getFailedSyncsController = catchAsync(async (req, res) => {
    const rows = await tiendaNubeService.getFailedSyncs();
    res.json(rows);
});

export const retryFailedSyncController = catchAsync(async (req, res) => {
    const { id } = req.params;
    try {
        await tiendaNubeService.retrySync(id);
        res.json({ success: true, message: 'Reintento exitoso' });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error al reintentar la sincronización' });
    }
});

export const retryAllFailedSyncsController = catchAsync(async (req, res) => {
    try {
        await tiendaNubeService.processFailedSyncs();
        res.json({ success: true, message: 'Cola de reintentos ejecutada' });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Error al procesar la cola de reintentos' });
    }
});

export const autoLinkCatalogController = catchAsync(async (req, res) => {
    try {
        const result = await tiendaNubeService.autoLinkCatalog();
        
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'AUTOLINK_TIENDANUBE_CATALOG_SUCCESS',
            entity_type: 'company_settings',
            entity_id: '1',
            new_values: result
        });

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[TiendaNube Auto Link Error]', error);
        res.status(500).json({ error: error.message || 'Error vinculando catálogo automáticamente' });
    }
});

function sendPaginated(res, query, result) {
    applyPaginationHeaders(res, {
        enabled: true,
        page: Number(query.page || 1),
        limit: Number(query.limit || 25)
    }, result.total);
    res.json(result.rows);
}

export const getOperationsOverviewController = catchAsync(async (req, res) => {
    res.json(await tiendaNubeService.getOperationsOverview());
});

export const listCatalogController = catchAsync(async (req, res) => {
    sendPaginated(res, req.query, await tiendaNubeService.listCatalog(req.query));
});

export const createCatalogController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.createCatalogFamily(req.body);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_TIENDANUBE_CATALOG_FAMILY',
        entity_type: 'tiendanube_catalog_family',
        entity_id: result.id,
        new_values: { name: result.name, visibility: result.visibility, variant_count: result.variant_count }
    });
    res.status(201).json(result);
});

export const updateCatalogController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.updateCatalogFamily(req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'not_found', message: 'Producto de tienda no encontrado' });
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_TIENDANUBE_CATALOG_FAMILY',
        entity_type: 'tiendanube_catalog_family',
        entity_id: req.params.id,
        new_values: req.body
    });
    res.json(result);
});

export const archiveCatalogController = catchAsync(async (req, res) => {
    const archived = await tiendaNubeService.archiveCatalogFamily(req.params.id);
    if (!archived) return res.status(404).json({ error: 'not_found', message: 'Producto de tienda no encontrado' });
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'ARCHIVE_TIENDANUBE_CATALOG_FAMILY',
        entity_type: 'tiendanube_catalog_family',
        entity_id: req.params.id
    });
    res.json({ success: true });
});

export const publishCatalogController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.publishCatalogFamily(req.params.id);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'PUBLISH_TIENDANUBE_CATALOG_FAMILY',
        entity_type: 'tiendanube_catalog_family',
        entity_id: req.params.id,
        new_values: { remote_product_id: result.remoteProductId }
    });
    res.json({ success: true, ...result });
});

export const importCatalogController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.importRemoteCatalog(req.body || {});
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'IMPORT_TIENDANUBE_CATALOG',
        entity_type: 'tiendanube_sync_run',
        entity_id: result.runId,
        new_values: { processed: result.processed, succeeded: result.succeeded, failures: result.failures.length }
    });
    res.json({ success: true, ...result });
});

export const listOperationsOrdersController = catchAsync(async (req, res) => {
    sendPaginated(res, req.query, await tiendaNubeService.listOperationsOrders(req.query));
});

export const listOperationsCustomersController = catchAsync(async (req, res) => {
    sendPaginated(res, req.query, await tiendaNubeService.listOperationsCustomers(req.query));
});

export const listFulfillmentsController = catchAsync(async (req, res) => {
    sendPaginated(res, req.query, await tiendaNubeService.listFulfillments(req.query));
});

export const syncFulfillmentsController = catchAsync(async (req, res) => {
    res.json({ success: true, ...(await tiendaNubeService.syncAllFulfillments()) });
});

export const updateFulfillmentController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.updateFulfillment(req.params.id, req.body);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_TIENDANUBE_FULFILLMENT',
        entity_type: 'tiendanube_fulfillment',
        entity_id: req.params.id,
        new_values: req.body
    });
    res.json(result);
});

export const createTrackingEventController = catchAsync(async (req, res) => {
    const result = await tiendaNubeService.createTrackingEvent(req.params.id, req.body);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_TIENDANUBE_TRACKING_EVENT',
        entity_type: 'tiendanube_fulfillment',
        entity_id: req.params.id,
        new_values: req.body
    });
    res.status(201).json(result);
});

export const getOperationsAnalyticsController = catchAsync(async (req, res) => {
    res.json(await tiendaNubeService.getOperationsAnalytics());
});

export const getSyncCenterController = catchAsync(async (req, res) => {
    res.json(await tiendaNubeService.getSyncCenter());
});
