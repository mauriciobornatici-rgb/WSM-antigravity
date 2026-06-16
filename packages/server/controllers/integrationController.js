import axios from 'axios';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import tiendaNubeService from '../services/tiendanube.service.js';
import salesService from '../services/sales.service.js';
import { encrypt, decrypt } from '../utils/crypto.js';

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

    const [rows] = await pool.query('SELECT tiendanube_client_id, tiendanube_client_secret FROM company_settings LIMIT 1');
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
        });

        const { access_token, user_id } = response.data;

        await pool.query(
            'UPDATE company_settings SET tiendanube_access_token = ?, tiendanube_store_id = ? WHERE id = 1',
            [encrypt(access_token), user_id]
        );

        await auditService.log({
            user_id: oauthState.userId || null,
            action: 'OAUTH_TIENDANUBE_SUCCESS',
            entity_type: 'company_settings',
            entity_id: '1',
            new_values: { tiendanube_store_id: user_id }
        });

        res.redirect('/settings?tab=tiendanube&success=1');
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

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(payload), 'utf8');
    const verified = tiendaNubeService.verifyWebhookSignature(rawBody, signature, creds.clientSecret);
    if (!verified) {
        return res.status(401).json({ error: 'invalid_tiendanube_signature' });
    }

    console.log(`[TiendaNube Webhook] Received ${payload.event} for store ${payload.store_id}`);
    res.status(200).send('OK');

    setImmediate(async () => {
        try {
            const result = await tiendaNubeService.processWebhookEvent(payload, salesService);
            console.log(`[TiendaNube Webhook] Processed ${payload.event} ${payload.id}: ${result.status}`);
        } catch (err) {
            console.error('[TiendaNube Webhook] Error processing webhook async:', err);
        }
    });
});

export const webhookOrdersCreated = webhookTiendaNube;

export const syncRecentOrdersController = catchAsync(async (req, res) => {
    try {
        const syncedCount = await tiendaNubeService.syncRecentOrders(salesService);
        res.json({ success: true, syncedCount });
    } catch (error) {
        console.error('[TiendaNube Sync Error]', error);
        res.status(500).json({ error: error.message || 'Error sincronizando ordenes' });
    }
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
