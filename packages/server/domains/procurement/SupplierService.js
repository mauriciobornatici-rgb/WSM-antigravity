import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { businessError } from '../../utils/businessError.js';

export class SupplierService {
    async getSuppliers() {
        const [rows] = await pool.query('SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at DESC');
        return rows;
    }

    async createSupplier(data, userId, ipAddress = null) {
        const { name, tax_id, contact_name, email, phone, address } = data;
        const id = crypto.randomUUID();

        const [existing] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ? AND deleted_at IS NULL', [tax_id]);
        if (existing.length > 0) {
            throw businessError(409, { error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'INSERT INTO suppliers (id, name, tax_id, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, name, tax_id, contact_name, email, phone, address]
        );

        const [newItem] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
        await auditService.log({
            user_id: userId || null,
            action: 'CREATE_SUPPLIER',
            entity_type: 'supplier',
            entity_id: id,
            new_values: newItem[0] || data,
            ip_address: ipAddress
        });
        return newItem[0];
    }

    async updateSupplier(id, data, userId, ipAddress = null) {
        const { name, tax_id, contact_name, email, phone, address } = data;

        const [existing] = await pool.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
        if (existing.length === 0) throw businessError(404, { error: 'not_found' });

        const [existingTaxId] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ? AND id != ? AND deleted_at IS NULL', [tax_id, id]);
        if (existingTaxId.length > 0) {
            throw businessError(409, { error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'UPDATE suppliers SET name = ?, tax_id = ?, contact_name = ?, email = ?, phone = ?, address = ? WHERE id = ? AND deleted_at IS NULL',
            [name, tax_id, contact_name, email, phone, address, id]
        );

        const [updated] = await pool.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
        await auditService.log({
            user_id: userId || null,
            action: 'UPDATE_SUPPLIER',
            entity_type: 'supplier',
            entity_id: id,
            old_values: existing[0],
            new_values: updated[0] || data,
            ip_address: ipAddress
        });
        return updated[0];
    }

    async deleteSupplier(id, userId, ipAddress = null) {
        const [existing] = await pool.query('SELECT id, name, account_balance FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
        if (existing.length === 0) throw businessError(404, { error: 'not_found' });

        const balance = Number(existing[0].account_balance || 0);
        if (Math.abs(balance) > 0.000001) {
            throw businessError(409, { error: 'has_balance', message: 'No se puede eliminar un proveedor con saldo pendiente' });
        }

        await pool.query('UPDATE suppliers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id]);
        await auditService.log({
            user_id: userId || null,
            action: 'DELETE_SUPPLIER',
            entity_type: 'supplier',
            entity_id: id,
            old_values: existing[0],
            ip_address: ipAddress
        });
        return { success: true };
    }
}

export default new SupplierService();
