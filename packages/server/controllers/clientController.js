import pool from '../config/db.js';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';

export const getClients = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY created_at DESC');
    res.json(rows);
});

export const getClientById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
    if (rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
    }
    res.json(rows[0]);
});

export const createClient = catchAsync(async (req, res) => {
    const { name, tax_id, email, phone, address, credit_limit } = req.body;
    const id = crypto.randomUUID();

    const [existing] = await pool.query('SELECT id FROM clients WHERE tax_id = ? AND deleted_at IS NULL', [tax_id]);
    if (existing.length > 0) {
        return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
    }

    await pool.query(
        'INSERT INTO clients (id, name, tax_id, email, phone, address, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, tax_id, email, phone, address, credit_limit || 0]
    );

    const [newItem] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_CLIENT',
        entity_type: 'client',
        entity_id: id,
        new_values: newItem[0] || req.body,
        ip_address: req.ip
    });
    res.json(newItem[0]);
});

export const updateClient = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { name, tax_id, email, phone, address, credit_limit } = req.body;

    const [existing] = await pool.query('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
    if (existing.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
    }

    const [existingTaxId] = await pool.query('SELECT id FROM clients WHERE tax_id = ? AND id != ? AND deleted_at IS NULL', [tax_id, id]);
    if (existingTaxId.length > 0) {
        return res.status(409).json({ error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
    }

    await pool.query(
        'UPDATE clients SET name = ?, tax_id = ?, email = ?, phone = ?, address = ?, credit_limit = ? WHERE id = ? AND deleted_at IS NULL',
        [name, tax_id, email, phone, address, credit_limit || 0, id]
    );

    const [updated] = await pool.query('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_CLIENT',
        entity_type: 'client',
        entity_id: id,
        old_values: existing[0],
        new_values: updated[0] || req.body,
        ip_address: req.ip
    });
    res.json(updated[0]);
});

export const deleteClient = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT id, name, current_account_balance FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'not_found' });

    const balance = Number(existing[0].current_account_balance || 0);
    if (Math.abs(balance) > 0.000001) {
        return res.status(409).json({ error: 'has_balance', message: 'No se puede eliminar un cliente con saldo pendiente' });
    }

    await pool.query('UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'DELETE_CLIENT',
        entity_type: 'client',
        entity_id: id,
        old_values: existing[0],
        ip_address: req.ip
    });
    res.json({ success: true });
});
