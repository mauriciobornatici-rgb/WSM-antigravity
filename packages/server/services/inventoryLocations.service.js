import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { businessError } from '../utils/businessError.js';

class InventoryLocationsService {
    async getLocations() {
        const [rows] = await pool.query(`
        SELECT wl.*,
               COUNT(DISTINCT i.product_id) AS sku_count,
               COALESCE(SUM(i.quantity), 0) AS total_quantity
        FROM warehouse_locations wl
        LEFT JOIN inventory i ON i.location = wl.code
        GROUP BY wl.id
        ORDER BY wl.active DESC, wl.name ASC
    `);
        return rows.map((row) => ({
            ...row,
            active: Boolean(row.active),
            sku_count: Number(row.sku_count || 0),
            total_quantity: Number(row.total_quantity || 0)
        }));
    }

    async createLocation(body, userId, ipAddress) {
        const code = String(body?.code || '').trim();
        const name = String(body?.name || code).trim();
        const description = String(body?.description || '').trim() || null;
        if (!code || !name) {
            throw businessError(400, { error: 'invalid_location', message: 'Código y nombre son obligatorios' });
        }
        const id = crypto.randomUUID();
        try {
            await pool.query(
                `INSERT INTO warehouse_locations (id, code, name, description, active, created_by)
             VALUES (?, ?, ?, ?, TRUE, ?)`,
                [id, code, name, description, userId || null]
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, { error: 'duplicate_location', message: 'Ya existe una ubicación con ese código' });
            }
            throw error;
        }
        await auditService.log({
            user_id: userId || null,
            action: 'CREATE_WAREHOUSE_LOCATION',
            entity_type: 'warehouse_location',
            entity_id: id,
            new_values: { code, name, description },
            ip_address: ipAddress
        });
        const [rows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
        return rows[0];
    }

    async updateLocation(id, body, userId, ipAddress) {
        const [existingRows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
        if (existingRows.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Ubicación no encontrada' });
        }
        const existing = existingRows[0];
        const code = String(body?.code ?? existing.code).trim();
        const name = String(body?.name ?? existing.name).trim();
        const description = body?.description == null ? existing.description : String(body.description).trim() || null;
        const active = body?.active == null ? Boolean(existing.active) : Boolean(body.active);
        if (!code || !name) {
            throw businessError(400, { error: 'invalid_location', message: 'Código y nombre son obligatorios' });
        }
        if (code !== existing.code) {
            const [[usage]] = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM inventory WHERE location = ?) +
              (SELECT COUNT(*) FROM products WHERE location = ?) AS usage_count
        `, [existing.code, existing.code]);
            if (Number(usage?.usage_count || 0) > 0) {
                throw businessError(409, {
                    error: 'location_in_use',
                    message: 'El código no puede cambiar mientras tenga productos. Traslade el stock primero; el nombre y la descripción sí pueden editarse.'
                });
            }
        }
        try {
            await pool.query(
                'UPDATE warehouse_locations SET code = ?, name = ?, description = ?, active = ? WHERE id = ?',
                [code, name, description, active, id]
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, { error: 'duplicate_location', message: 'Ya existe una ubicación con ese código' });
            }
            throw error;
        }
        await auditService.log({
            user_id: userId || null,
            action: 'UPDATE_WAREHOUSE_LOCATION',
            entity_type: 'warehouse_location',
            entity_id: id,
            old_values: existing,
            new_values: { code, name, description, active },
            ip_address: ipAddress
        });
        const [rows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
        return rows[0];
    }
}

export default new InventoryLocationsService();