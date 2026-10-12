import pool from '../config/db.js';
import crypto from 'crypto';
import auditService from './audit.service.js';
import { businessError } from '../utils/businessError.js';

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
        SELECT t.client_id, COALESCE(SUM(t.amount), 0) AS total_paid
        FROM transactions t
        WHERE t.type = 'sale'
          AND (
              EXISTS (
                  SELECT 1 FROM invoices payment_invoice
                  WHERE payment_invoice.id = t.reference_id
                    AND payment_invoice.deleted_at IS NULL
              )
              OR EXISTS (
                  SELECT 1
                  FROM orders payment_order
                  LEFT JOIN order_payments payment_split ON payment_split.order_id = payment_order.id
                  WHERE payment_order.id = t.reference_id
                    AND payment_order.deleted_at IS NULL
                    AND (
                        payment_order.payment_method = 'credit_account'
                        OR payment_split.payment_method = 'credit_account'
                    )
              )
          )
        GROUP BY t.client_id
    ) pay ON pay.client_id = c.id
    LEFT JOIN (
        SELECT credit_orders.client_id, COALESCE(SUM(credit_orders.credit_amount), 0) AS total_uninvoiced_credit
        FROM (
            SELECT o.id, o.client_id,
                   CASE
                       WHEN COALESCE(SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END), 0) > 0
                           THEN SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END)
                       WHEN o.payment_method = 'credit_account' THEN o.total_amount
                       ELSE 0
                   END AS credit_amount
            FROM orders o
            LEFT JOIN order_payments op ON op.order_id = o.id
            WHERE o.deleted_at IS NULL AND o.invoice_id IS NULL AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY o.id, o.client_id, o.payment_method, o.total_amount
        ) credit_orders
        WHERE credit_orders.credit_amount > 0
        GROUP BY credit_orders.client_id
    ) ord ON ord.client_id = c.id
`;

const CLIENT_BALANCE_SQL = `
    ROUND(
        COALESCE(inv.total_invoiced, 0)
        + COALESCE(ord.total_uninvoiced_credit, 0)
        - COALESCE(cn.total_credit_notes, 0)
        - COALESCE(pay.total_paid, 0),
        2
    )
`;

const withBalance = (row) => ({
    ...row,
    current_account_balance: Number(row.computed_balance || 0)
});

class ClientService {
    async listClients() {
        const [rows] = await pool.query(`
        SELECT c.*, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.deleted_at IS NULL
        ORDER BY c.created_at DESC
    `);
        return rows.map(withBalance);
    }

    async getClientById(id) {
        const [rows] = await pool.query(`
        SELECT c.*, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.id = ? AND c.deleted_at IS NULL
        LIMIT 1
    `, [id]);
        if (rows.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Cliente no encontrado' });
        }
        return withBalance(rows[0]);
    }

    async createClient({ body, actorId, ip }) {
        const { name, tax_id, email, phone, address, credit_limit } = body;
        const id = crypto.randomUUID();

        const [existing] = await pool.query('SELECT id FROM clients WHERE tax_id = ? AND deleted_at IS NULL', [tax_id]);
        if (existing.length > 0) {
            throw businessError(409, { error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'INSERT INTO clients (id, name, tax_id, email, phone, address, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, name, tax_id, email, phone, address, credit_limit || 0]
        );

        const [newItem] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
        await auditService.log({
            user_id: actorId || null,
            action: 'CREATE_CLIENT',
            entity_type: 'client',
            entity_id: id,
            new_values: newItem[0] || body,
            ip_address: ip
        });
        return newItem[0];
    }

    async updateClient({ id, body, actorId, ip }) {
        const { name, tax_id, email, phone, address, credit_limit } = body;

        const [existing] = await pool.query('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
        if (existing.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Cliente no encontrado' });
        }

        const [existingTaxId] = await pool.query('SELECT id FROM clients WHERE tax_id = ? AND id != ? AND deleted_at IS NULL', [tax_id, id]);
        if (existingTaxId.length > 0) {
            throw businessError(409, { error: 'duplicate_tax_id', message: 'Ya existe un cliente con ese RUC/CI/CUIT' });
        }

        await pool.query(
            'UPDATE clients SET name = ?, tax_id = ?, email = ?, phone = ?, address = ?, credit_limit = ? WHERE id = ? AND deleted_at IS NULL',
            [name, tax_id, email, phone, address, credit_limit || 0, id]
        );

        const [updated] = await pool.query('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL', [id]);
        await auditService.log({
            user_id: actorId || null,
            action: 'UPDATE_CLIENT',
            entity_type: 'client',
            entity_id: id,
            old_values: existing[0],
            new_values: updated[0] || body,
            ip_address: ip
        });
        return updated[0];
    }

    async deleteClient({ id, actorId, ip }) {
        const [existing] = await pool.query(`
        SELECT c.id, c.name, ${CLIENT_BALANCE_SQL} AS computed_balance
        FROM clients c
        ${CLIENT_BALANCE_JOINS}
        WHERE c.id = ? AND c.deleted_at IS NULL
        LIMIT 1
    `, [id]);
        if (existing.length === 0) throw businessError(404, { error: 'not_found' });

        const balance = Number(existing[0].computed_balance || 0);
        if (Math.abs(balance) > 0.000001) {
            throw businessError(409, { error: 'has_balance', message: 'No se puede eliminar un cliente con saldo pendiente' });
        }

        await pool.query('UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [id]);
        await auditService.log({
            user_id: actorId || null,
            action: 'DELETE_CLIENT',
            entity_type: 'client',
            entity_id: id,
            old_values: existing[0],
            ip_address: ip
        });
    }
}

export default new ClientService();
