import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';

class WarrantiesService extends BaseService {
    constructor() {
        super('warranty_claims');
    }

    async getWarranties(filters = {}) {
        let query = `
            SELECT w.*, c.name AS client_name, p.name AS product_name, p.sku
            FROM warranty_claims w
            LEFT JOIN clients c ON w.client_id = c.id
            LEFT JOIN products p ON w.product_id = p.id
            WHERE (w.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND w.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND w.status = ?';
            params.push(filters.status);
        }

        query += ' ORDER BY w.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createWarranty(data) {
        const payload = { id: data.id || crypto.randomUUID(), ...data };
        return super.create(payload);
    }
}

class ReturnsService extends BaseService {
    constructor() {
        super('client_returns');
    }

    _buildDomainError(message, errorCode, statusCode = 400) {
        const err = new Error(message);
        err.errorCode = errorCode;
        err.statusCode = statusCode;
        err.status = 'fail';
        return err;
    }

    async _nextCreditNoteNumber(connection) {
        const year = new Date().getFullYear();
        const prefix = `NC-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM credit_notes
             WHERE number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `credit_note:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    async _increaseInventoryForReturn(connection, { returnId, item, actorUserId }) {
        const quantity = Number(item.quantity || 0);
        if (quantity <= 0) return { restocked: 0, discarded: 0 };

        const condition = String(item.condition_status || 'sellable').toLowerCase();
        const isSellable = condition === 'sellable';
        const location = 'General';

        if (isSellable) {
            const [existingInventory] = await connection.query(
                'SELECT id FROM inventory WHERE product_id = ? AND location = ? LIMIT 1 FOR UPDATE',
                [item.product_id, location]
            );

            if (existingInventory.length > 0) {
                await connection.query(
                    'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                    [quantity, existingInventory[0].id]
                );
            } else {
                await connection.query(
                    'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                    [crypto.randomUUID(), item.product_id, location, quantity]
                );
            }
        }

        await connection.query(
            `INSERT INTO inventory_movements (
                id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'client_return', ?, ?)`,
            [
                crypto.randomUUID(),
                isSellable ? 'return' : 'damage',
                item.product_id,
                isSellable ? location : null,
                quantity,
                Number(item.unit_price || 0),
                isSellable ? 'Client return approved - restocked' : 'Client return approved - non sellable',
                returnId,
                actorUserId || null
            ]
        );

        return {
            restocked: isSellable ? quantity : 0,
            discarded: isSellable ? 0 : quantity
        };
    }

    async getReturns(filters = {}) {
        let query = `
            SELECT r.*, c.name AS client_name, o.id AS order_number
            FROM client_returns r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN orders o ON r.order_id = o.id
            WHERE (r.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND r.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND r.status = ?';
            params.push(filters.status);
        }

        query += ' ORDER BY r.created_at DESC';
        const [rows] = await pool.query(query, params);

        if (rows.length === 0) return rows;

        const returnIds = rows.map((r) => r.id);
        const [items] = await pool.query(`
            SELECT i.*, p.name AS product_name, p.sku
            FROM client_return_items i
            LEFT JOIN products p ON i.product_id = p.id
            WHERE i.return_id IN (?)
        `, [returnIds]);

        return rows.map((r) => ({
            ...r,
            items: items.filter((i) => i.return_id === r.id)
        }));
    }

    async createReturn(data) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const returnId = crypto.randomUUID();
            await conn.query(
                `INSERT INTO client_returns (id, client_id, customer_name, order_id, reason, status, created_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
                [returnId, data.client_id || null, data.customer_name || null, data.order_id || null, data.reason || null]
            );

            if (data.items && data.items.length > 0) {
                const values = data.items.map((item) => [
                    crypto.randomUUID(),
                    returnId,
                    item.product_id,
                    item.quantity,
                    item.condition_status || 'sellable',
                    item.unit_price || 0
                ]);
                await conn.query(
                    `INSERT INTO client_return_items (id, return_id, product_id, quantity, condition_status, unit_price) VALUES ?`,
                    [values]
                );

                const [totals] = await conn.query(
                    `SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM client_return_items WHERE return_id = ?`,
                    [returnId]
                );
                await conn.query('UPDATE client_returns SET total_amount = ? WHERE id = ?', [totals[0].total, returnId]);
            }

            await conn.commit();
            return { id: returnId };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    async approveReturn(returnId, actorUserId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [returns] = await conn.query(
                'SELECT * FROM client_returns WHERE id = ? FOR UPDATE',
                [returnId]
            );
            if (returns.length === 0) {
                throw this._buildDomainError('Devolucion no encontrada', 'RETURN_NOT_FOUND', 404);
            }

            const returnRow = returns[0];
            if (returnRow.status === 'approved') {
                throw this._buildDomainError('La devolucion ya fue aprobada', 'RETURN_ALREADY_APPROVED', 409);
            }
            if (returnRow.status === 'rejected' || returnRow.status === 'cancelled') {
                throw this._buildDomainError('La devolucion no puede aprobarse en su estado actual', 'RETURN_INVALID_STATE', 400);
            }

            const [items] = await conn.query(
                'SELECT * FROM client_return_items WHERE return_id = ? FOR UPDATE',
                [returnId]
            );
            if (items.length === 0) {
                throw this._buildDomainError('La devolucion no tiene items', 'RETURN_WITHOUT_ITEMS', 400);
            }

            let totalAmount = Number(returnRow.total_amount || 0);
            if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
                totalAmount = items.reduce(
                    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
                    0
                );
            }
            totalAmount = Math.round((totalAmount + Number.EPSILON) * 100) / 100;
            if (totalAmount <= 0) {
                throw this._buildDomainError(
                    'El monto total de la devolucion debe ser mayor a 0 para emitir nota de credito',
                    'RETURN_TOTAL_INVALID',
                    400
                );
            }

            let restockedTotal = 0;
            let discardedTotal = 0;
            for (const item of items) {
                const impact = await this._increaseInventoryForReturn(conn, {
                    returnId,
                    item,
                    actorUserId
                });
                restockedTotal += impact.restocked;
                discardedTotal += impact.discarded;
            }

            const creditNoteId = crypto.randomUUID();
            const creditNoteNumber = await this._nextCreditNoteNumber(conn);
            await conn.query(
                `INSERT INTO credit_notes (
                    id, number, client_id, customer_name, reference_type, reference_id, amount, status, notes
                ) VALUES (?, ?, ?, ?, 'return', ?, ?, 'issued', ?)`,
                [
                    creditNoteId,
                    creditNoteNumber,
                    returnRow.client_id || null,
                    returnRow.customer_name || null,
                    returnId,
                    totalAmount,
                    `Generada automaticamente por aprobacion de devolucion ${returnId}`
                ]
            );

            await conn.query(
                `INSERT INTO transactions (id, type, amount, description, reference_id, client_id, date)
                 VALUES (?, 'adjustment', ?, ?, ?, ?, NOW())`,
                [
                    crypto.randomUUID(),
                    totalAmount,
                    `Nota de credito ${creditNoteNumber} por devolucion de cliente`,
                    creditNoteId,
                    returnRow.client_id || null
                ]
            );

            if (returnRow.client_id) {
                await conn.query(
                    `UPDATE clients
                     SET current_account_balance = COALESCE(current_account_balance, 0) - ?
                     WHERE id = ?`,
                    [totalAmount, returnRow.client_id]
                );
            }

            await conn.query(
                'UPDATE client_returns SET status = "approved", total_amount = ? WHERE id = ?',
                [totalAmount, returnId]
            );

            await conn.commit();
            return {
                success: true,
                return_id: returnId,
                credit_note_id: creditNoteId,
                credit_note_number: creditNoteNumber,
                total_amount: totalAmount,
                restocked_quantity: restockedTotal,
                discarded_quantity: discardedTotal
            };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

class CreditNotesService extends BaseService {
    constructor() {
        super('credit_notes');
    }

    async getCreditNotes(filters = {}) {
        let query = `
            SELECT cn.*, c.name AS client_name
            FROM credit_notes cn
            LEFT JOIN clients c ON cn.client_id = c.id
            WHERE (cn.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND cn.client_id = ?';
            params.push(filters.client_id);
        }

        query += ' ORDER BY cn.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }
}

export const warrantiesService = new WarrantiesService();
export const returnsService = new ReturnsService();
export const creditNotesService = new CreditNotesService();
