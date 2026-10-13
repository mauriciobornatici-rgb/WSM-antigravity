import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { businessError } from '../../utils/businessError.js';

const NOT_FOUND = { error: 'not_found', message: 'Proveedor no encontrado' };
const DUPLICATE_TAX_ID = { error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' };

const normalizeTaxId = (taxId) => {
    const value = taxId == null ? '' : String(taxId).trim();
    return value || null;
};

export class SupplierService {
    async getSuppliers() {
        const [rows] = await pool.query('SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at DESC');
        return rows;
    }

    // Runs fn in a transaction holding a named lock for the tax id: two requests creating or
    // renaming suppliers with the same CUIT cannot both pass the duplicate check (a unique key is
    // not possible: deleted suppliers keep their CUIT). Without a CUIT there is nothing to check.
    async _withTaxIdLock(taxId, fn) {
        const connection = await pool.getConnection();
        const lockName = taxId ? `supplier_tax_id:${taxId}`.slice(0, 64) : null;
        try {
            if (lockName) {
                const [[lock]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
                if (Number(lock?.acquired) !== 1) {
                    throw businessError(409, { error: 'busy', message: 'Otro usuario está guardando un proveedor con ese CUIT: reintentá en unos segundos.' });
                }
            }
            await connection.beginTransaction();
            try {
                const result = await fn(connection);
                await connection.commit();
                return result;
            } catch (error) {
                await connection.rollback();
                throw error;
            }
        } finally {
            if (lockName) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
            connection.release();
        }
    }

    async createSupplier(data, userId, ipAddress = null) {
        const { name, contact_name, email, phone, address } = data;
        const taxId = normalizeTaxId(data.tax_id);
        const id = crypto.randomUUID();

        const created = await this._withTaxIdLock(taxId, async (connection) => {
            if (taxId) {
                const [existing] = await connection.query('SELECT id FROM suppliers WHERE tax_id = ? AND deleted_at IS NULL', [taxId]);
                if (existing.length > 0) throw businessError(409, DUPLICATE_TAX_ID);
            }
            await connection.query(
                'INSERT INTO suppliers (id, name, tax_id, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, name, taxId, contact_name, email, phone, address]
            );
            const [newItem] = await connection.query('SELECT * FROM suppliers WHERE id = ?', [id]);
            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_SUPPLIER',
                entity_type: 'supplier',
                entity_id: id,
                new_values: newItem[0] || data,
                ip_address: ipAddress
            }, connection);
            return newItem[0];
        });
        return created;
    }

    async updateSupplier(id, data, userId, ipAddress = null) {
        const { name, contact_name, email, phone, address } = data;
        const taxId = normalizeTaxId(data.tax_id);

        return this._withTaxIdLock(taxId, async (connection) => {
            const [existing] = await connection.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]);
            if (existing.length === 0) throw businessError(404, NOT_FOUND);

            if (taxId) {
                const [existingTaxId] = await connection.query(
                    'SELECT id FROM suppliers WHERE tax_id = ? AND id != ? AND deleted_at IS NULL',
                    [taxId, id]
                );
                if (existingTaxId.length > 0) throw businessError(409, DUPLICATE_TAX_ID);
            }

            await connection.query(
                'UPDATE suppliers SET name = ?, tax_id = ?, contact_name = ?, email = ?, phone = ?, address = ? WHERE id = ? AND deleted_at IS NULL',
                [name, taxId, contact_name, email, phone, address, id]
            );

            const [updated] = await connection.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
            await auditService.log({
                user_id: userId || null,
                action: 'UPDATE_SUPPLIER',
                entity_type: 'supplier',
                entity_id: id,
                old_values: existing[0],
                new_values: updated[0] || data,
                ip_address: ipAddress
            }, connection);
            return updated[0];
        });
    }

    // The supplier row is locked: an invoice or payment being recorded at the same time either
    // commits first (and the balance check sees it) or waits and then finds the supplier deleted.
    async deleteSupplier(id, userId, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [existing] = await connection.query(
                'SELECT id, name, account_balance FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [id]
            );
            if (existing.length === 0) throw businessError(404, NOT_FOUND);

            const balance = Number(existing[0].account_balance || 0);
            if (Math.abs(balance) > 0.000001) {
                throw businessError(409, { error: 'has_balance', message: 'No se puede eliminar un proveedor con saldo pendiente' });
            }

            await connection.query('UPDATE suppliers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id]);
            await auditService.log({
                user_id: userId || null,
                action: 'DELETE_SUPPLIER',
                entity_type: 'supplier',
                entity_id: id,
                old_values: existing[0],
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { success: true };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new SupplierService();
