import pool from '../config/db.js';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';

export const getSuppliers = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY created_at DESC');
    res.json(rows);
});

export const createSupplier = catchAsync(async (req, res) => {
    const { name, tax_id, contact_name, email, phone, address } = req.body;
    const id = crypto.randomUUID();

    const [existing] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ? AND deleted_at IS NULL', [tax_id]);
    if (existing.length > 0) {
        return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
    }

    await pool.query(
        'INSERT INTO suppliers (id, name, tax_id, contact_name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, tax_id, contact_name, email, phone, address]
    );

    const [newItem] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: id,
        new_values: newItem[0] || req.body,
        ip_address: getRequestIp(req)
    });
    res.json(newItem[0]);
});

export const updateSupplier = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { name, tax_id, contact_name, email, phone, address } = req.body;

    const [existing] = await pool.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'not_found' });

    const [existingTaxId] = await pool.query('SELECT id FROM suppliers WHERE tax_id = ? AND id != ? AND deleted_at IS NULL', [tax_id, id]);
    if (existingTaxId.length > 0) {
        return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un proveedor con ese RUC/CI/CUIT' });
    }

    await pool.query(
        'UPDATE suppliers SET name = ?, tax_id = ?, contact_name = ?, email = ?, phone = ?, address = ? WHERE id = ? AND deleted_at IS NULL',
        [name, tax_id, contact_name, email, phone, address, id]
    );

    const [updated] = await pool.query('SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: id,
        old_values: existing[0],
        new_values: updated[0] || req.body,
        ip_address: getRequestIp(req)
    });
    res.json(updated[0]);
});

export const deleteSupplier = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT id, name, account_balance FROM suppliers WHERE id = ? AND deleted_at IS NULL', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'not_found' });

    const balance = Number(existing[0].account_balance || 0);
    if (Math.abs(balance) > 0.000001) {
        return res.status(409).json({ error: 'has_balance', message: 'No se puede eliminar un proveedor con saldo pendiente' });
    }

    await pool.query('UPDATE suppliers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'DELETE_SUPPLIER',
        entity_type: 'supplier',
        entity_id: id,
        old_values: existing[0],
        ip_address: getRequestIp(req)
    });
    res.json({ success: true });
});
