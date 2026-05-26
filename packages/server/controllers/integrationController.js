import axios from 'axios';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';

export const authorizeTiendaNube = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT tiendanube_client_id FROM company_settings LIMIT 1');
    const clientId = rows[0]?.tiendanube_client_id;
    
    if (!clientId) {
        return res.status(400).send('Tienda Nube Client ID no está configurado en la aplicación.');
    }
    
    const redirectUrl = `https://www.tiendanube.com/apps/${clientId}/authorize`;
    res.redirect(redirectUrl);
});

export const callbackTiendaNube = catchAsync(async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('Authorization code no recibido.');
    }

    const [rows] = await pool.query('SELECT tiendanube_client_id, tiendanube_client_secret FROM company_settings LIMIT 1');
    const settings = rows[0] || {};
    const clientId = settings.tiendanube_client_id;
    const clientSecret = settings.tiendanube_client_secret;

    if (!clientId || !clientSecret) {
        return res.status(400).send('Las credenciales OAuth de Tienda Nube no están configuradas.');
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
            [access_token, user_id]
        );

        await auditService.log({
            user_id: req.user?.id || null,
            action: 'OAUTH_TIENDANUBE_SUCCESS',
            entity_type: 'company_settings',
            entity_id: '1',
            new_values: { tiendanube_store_id: user_id }
        });

        // Redirigir al usuario al ERP
        res.redirect('/settings?tab=tiendanube&success=1');
    } catch (error) {
        console.error('Error in OAuth callback:', error.response?.data || error.message);
        res.status(500).send('Error al autorizar con Tienda Nube.');
    }
});

import salesService from '../services/sales.service.js';

export const webhookOrdersCreated = catchAsync(async (req, res) => {
    const storeId = req.headers['x-tiendanube-store-id'];
    const event = req.headers['x-tiendanube-event'];
    
    console.log(`[TiendaNube Webhook] Received ${event} for store ${storeId}`);

    // Immediately acknowledge receipt to TiendaNube (Webhook best practice)
    res.status(200).send('OK');

    try {
        const payload = req.body;
        
        // Example structure of TiendaNube webhook payload for an order:
        // payload.products is an array of items { sku, quantity, price, name }
        // payload.customer is { name, email, phone }
        // payload.billing_address / payload.shipping_address
        
        if (!payload || !payload.products || !Array.isArray(payload.products)) {
            console.log('[TiendaNube Webhook] Invalid or empty products payload');
            return;
        }

        const items = [];
        for (const p of payload.products) {
            if (!p.sku) continue; // Skip products without SKU, we can't map them
            
            // Find local product by SKU
            const [localProducts] = await pool.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [p.sku]);
            if (localProducts.length > 0) {
                items.push({
                    product_id: localProducts[0].id,
                    quantity: p.quantity || 1
                });
            }
        }

        if (items.length === 0) {
            console.log('[TiendaNube Webhook] No matching products found locally by SKU.');
            return;
        }

        const customerName = payload.customer?.name || payload.billing_address?.name || 'Cliente Tienda Nube';
        
        const orderData = {
            customer_name: customerName,
            counter_name: 'Sincronización Automática TN',
            payment_method: payload.payment_details?.method || 'transfer',
            shipping_method: 'delivery',
            shipping_address: payload.shipping_address?.address || null,
            notes: `Orden TN #${payload.id || 'N/A'}. Creada desde Webhook.`,
            items: items
        };

        // Create the order locally
        const newOrder = await salesService.createOrder(orderData, null);
        console.log(`[TiendaNube Webhook] Successfully created local order ${newOrder.id} for TN Order #${payload.id}`);

    } catch (err) {
        console.error('[TiendaNube Webhook] Error processing webhook async:', err);
    }
});
