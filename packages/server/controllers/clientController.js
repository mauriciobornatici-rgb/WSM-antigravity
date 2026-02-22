import pool from '../config/db.js';
import crypto from 'crypto';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';

const CLIENT_BALANCE_JOINS = `
    LEFT JOIN (
        SELECT client_id, COALESCE(SUM(total_amount), 0) AS total_invoiced
        FROM invoices
        WHERE deleted_at IS NULL
        GROUP BY client_id
    ) inv ON inv.client_id = c.id
    LEFT JOIN (
        SELECT client_id, COALESCE(SUM(amount), 0) AS total_credit_notes
        FROM credit_notes
        WHERE deleted_at IS NULL AND (status IS NULL OR status != 'cancelled')
        GROUP BY client_id
    ) cn ON cn.client_id = c.id
    LEFT JOIN (
        SELECT client_id, COALESCE(SUM(amount), 0) AS total_paid
        FROM transactions
        WHERE type = 'sale'
        GROUP BY client_id
    ) pay ON pay.client_id = c.id
`;

const CLIENT_BALANCE_SQL = `
    ROUND(
        COALESCE(inv.total_invoiced, 0)
        - COALESCE(cn.total_credit_notes, 0)
        - COALESCE(pay.total_paid, 0),
        2
    )
`;

export const getClients = catchAsync(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT c.*, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC
    `);
    res.json(rows.map((row) => ({
        ...row,
        current_account_balance: Number(row.computed_balance || 0)
    })));
});

export const getClientById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [rows] = await pool.query(`
        SELECT c.*, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.id = ? AND c.deleted_at IS NULL
        LIMIT 1
    `, [id]);
    if (rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Cliente no encontrado' });
    }
    res.json({
        ...rows[0],
        current_account_balance: Number(rows[0].computed_balance || 0)
    });
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
    const [existing] = await pool.query(`
        SELECT c.id, c.name, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.id = ? AND c.deleted_at IS NULL
        LIMIT 1
    `, [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'not_found' });

    const balance = Number(existing[0].computed_balance || 0);
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
