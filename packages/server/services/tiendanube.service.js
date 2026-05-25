import axios from 'axios';
import pool from '../config/db.js';

class TiendaNubeService {
    constructor() {
        this.baseUrl = 'https://api.tiendanube.com/v1';
    }

    getCredentials() {
        const accessToken = process.env.TIENDANUBE_ACCESS_TOKEN;
        const storeId = process.env.TIENDANUBE_STORE_ID;
        const userAgent = process.env.TIENDANUBE_USER_AGENT || 'WSM SportsERP (contacto@wsm.com)';

        if (!accessToken || !storeId) {
            return null;
        }

        return { accessToken, storeId, userAgent };
    }

    async syncStock(productId, newStock) {
        const creds = this.getCredentials();
        if (!creds) {
            console.log(`[TiendaNube] Skipped sync for product ${productId} - API credentials not configured.`);
            return;
        }

        try {
            // Find the tiendanube product and variant ID for this local product
            const [rows] = await pool.query(`
                SELECT tiendanube_product_id, tiendanube_variant_id 
                FROM products 
                WHERE id = ?
            `, [productId]);

            if (rows.length === 0) return;

            const { tiendanube_product_id, tiendanube_variant_id } = rows[0];

            if (!tiendanube_product_id || !tiendanube_variant_id) {
                console.log(`[TiendaNube] Skipped sync for product ${productId} - Not linked to a Tienda Nube variant.`);
                return;
            }

            const url = `${this.baseUrl}/${creds.storeId}/variants/${tiendanube_variant_id}`;
            
            const payload = {
                stock: Number(newStock)
            };

            const response = await axios.put(url, payload, {
                headers: {
                    'Authentication': `bearer ${creds.accessToken}`,
                    'User-Agent': creds.userAgent,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[TiendaNube] Successfully synced stock for product ${productId} (TN Variant: ${tiendanube_variant_id}). New stock: ${newStock}`);
            return response.data;
        } catch (error) {
            console.error(`[TiendaNube] Failed to sync stock for product ${productId}:`, error?.response?.data || error.message);
            // We don't throw the error so it doesn't crash the main inventory transaction.
            // In a production system, we could save this to a 'failed_syncs' table for retry.
        }
    }
}

export default new TiendaNubeService();
