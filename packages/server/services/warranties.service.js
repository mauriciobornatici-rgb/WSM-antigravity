import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';
import auditService from './audit.service.js';
import afipService from './afip.service.js';

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
        
        let targetLocation = null;
        let movementType = 'damage';
        let movementReason = '';

        if (condition === 'sellable') {
            targetLocation = 'General';
            movementType = 'return';
            movementReason = 'Devolución de cliente - Reingreso a stock';
        } else if (condition === 'supplier_rma') {
            targetLocation = 'Devoluciones a Proveedores';
            movementType = 'return';
            movementReason = 'Devolución de cliente - A enviar a proveedor';
        } else if (condition === 'loss') {
            targetLocation = null;
            movementType = 'damage';
            movementReason = 'Devolución de cliente - Pérdida asumida';
        } else if (condition === 'rejected') {
            targetLocation = null;
            movementType = 'rejected';
            movementReason = 'Devolución de cliente - Rechazada sin garantía';
        }

        if (targetLocation) {
            const [existingInventory] = await connection.query(
                'SELECT id FROM inventory WHERE product_id = ? AND location = ? LIMIT 1 FOR UPDATE',
                [item.product_id, targetLocation]
            );

            if (existingInventory.length > 0) {
                await connection.query(
                    'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                    [quantity, existingInventory[0].id]
                );
            } else {
                await connection.query(
                    'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                    [crypto.randomUUID(), item.product_id, targetLocation, quantity]
                );
            }
        }

        await connection.query(
            `INSERT INTO inventory_movements (
                id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'client_return', ?, ?)`,
            [
                crypto.randomUUID(),
                movementType,
                item.product_id,
                targetLocation,
                quantity,
                Number(item.unit_price || 0),
                movementReason,
                returnId,
                actorUserId || null
            ]
        );

        return {
            restocked: targetLocation === 'General' ? quantity : 0,
            discarded: targetLocation !== 'General' ? quantity : 0
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

    async getReturnsAnalytics() {
        const conn = await pool.getConnection();
        try {
            // Rate of returns (loss and rejected) by product
            const [productStats] = await conn.query(`
                SELECT p.name as product_name, p.sku,
                       SUM(CASE WHEN i.condition_status IN ('loss', 'rejected') THEN i.quantity ELSE 0 END) as defective_quantity,
                       SUM(i.quantity) as total_returned_quantity
                FROM client_return_items i
                JOIN products p ON i.product_id = p.id
                JOIN client_returns r ON i.return_id = r.id
                WHERE r.status = 'approved'
                GROUP BY i.product_id
                ORDER BY defective_quantity DESC
                LIMIT 5
            `);

            // Returns by reason
            const [reasonStats] = await conn.query(`
                SELECT r.reason, COUNT(*) as count
                FROM client_returns r
                WHERE r.status = 'approved' AND r.reason IS NOT NULL AND r.reason != ''
                GROUP BY r.reason
                ORDER BY count DESC
                LIMIT 5
            `);

            // Total financial loss
            const [lossStats] = await conn.query(`
                SELECT COALESCE(SUM(i.quantity * i.unit_price), 0) as total_loss_amount
                FROM client_return_items i
                JOIN client_returns r ON i.return_id = r.id
                WHERE r.status = 'approved' AND i.condition_status IN ('loss', 'rejected')
            `);

            return {
                topDefectiveProducts: productStats,
                topReasons: reasonStats,
                totalLossAmount: Number(lossStats[0]?.total_loss_amount || 0)
            };
        } finally {
            conn.release();
        }
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

            let totalAmount = 0;
            for (const item of items) {
                // If item is rejected, it does not contribute to the refund amount
                if (String(item.condition_status).toLowerCase() !== 'rejected') {
                    totalAmount += Number(item.quantity || 0) * Number(item.unit_price || 0);
                }
            }
            totalAmount = Math.round((totalAmount + Number.EPSILON) * 100) / 100;
            
            // It's possible that a return ONLY has rejected items, then totalAmount = 0
            // If totalAmount is 0, we just approve it without creating a Credit Note.
            
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

            let creditNoteId = null;
            let creditNoteNumber = null;

            if (totalAmount > 0) {
                creditNoteId = crypto.randomUUID();
                creditNoteNumber = await this._nextCreditNoteNumber(conn);

                let pointOfSale = 1;
                const [compRows] = await conn.query('SELECT billing_pos FROM company_settings LIMIT 1');
                if (compRows.length > 0 && compRows[0].billing_pos) {
                    pointOfSale = Number(compRows[0].billing_pos) || 1;
                }

                let creditNoteType = 'B';
                if (returnRow.client_id) {
                    const [clients] = await conn.query(
                        'SELECT tax_condition_id FROM clients WHERE id = ?',
                        [returnRow.client_id]
                    );
                    if (clients.length > 0) {
                        const condId = clients[0].tax_condition_id || '';
                        if (condId === 'tc_RespInscripto' || condId.toLowerCase().includes('inscripto')) {
                            creditNoteType = 'A';
                        }
                    }
                }

                await conn.query(
                    `INSERT INTO credit_notes (
                        id, number, client_id, point_of_sale, credit_note_type, customer_name, reference_type, reference_id, amount, status, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, 'return', ?, ?, 'issued', ?)`,
                    [
                        creditNoteId,
                        creditNoteNumber,
                        returnRow.client_id || null,
                        pointOfSale,
                        creditNoteType,
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

    async authorizeCreditNote(creditNoteId, userId) {
        const [rows] = await pool.query('SELECT * FROM credit_notes WHERE id = ? AND deleted_at IS NULL', [creditNoteId]);
        if (rows.length === 0) {
            const err = new Error('Credit Note not found');
            err.statusCode = 404;
            err.status = 'fail';
            err.errorCode = 'CREDIT_NOTE_NOT_FOUND';
            throw err;
        }

        const cn = rows[0];
        if (cn.status === 'authorized') return cn;
        
        let afipRes = null;
        
        // Consultar factura original si esta NC viene de una devolucion
        if (cn.reference_type === 'return' && cn.reference_id) {
            const [returns] = await pool.query('SELECT order_id FROM client_returns WHERE id = ?', [cn.reference_id]);
            if (returns.length > 0 && returns[0].order_id) {
                const [invoices] = await pool.query('SELECT * FROM invoices WHERE order_id = ? AND cae IS NOT NULL', [returns[0].order_id]);
                if (invoices.length > 0) {
                    // Factura validada en AFIP. Generar NC_A o NC_B
                    const originalInvoice = invoices[0];
                    const [settingsRows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
                    const companySettings = settingsRows[0] || {};
                    
                    const invoiceData = {
                        invoice_type: cn.credit_note_type === 'A' ? 'NC_A' : 'NC_B',
                        client_tax_id: originalInvoice.client_tax_id || null,
                        total_amount: cn.amount,
                        invoice_number: cn.number
                    };
                    
                    // Recuperar ítems reales de la devolución y sus tasas de IVA del catálogo de productos
                    const [itemsRows] = await pool.query(`
                        SELECT 
                            ri.quantity, 
                            ri.unit_price, 
                            COALESCE(p.vat_rate, 21) AS vat_rate
                        FROM client_return_items ri
                        JOIN products p ON ri.product_id = p.id
                        WHERE ri.return_id = ?
                    `, [cn.reference_id]);

                    const invoiceItems = itemsRows.length > 0 ? itemsRows : [
                        { quantity: 1, unit_price: cn.amount, vat_rate: 21 }
                    ];

                    try {
                        afipRes = await afipService.authorizeVoucher(invoiceData, invoiceItems, companySettings);
                    } catch (err) {
                        throw new Error(`AFIP rechazó la Nota de Crédito: ${err.message}`);
                    }
                }
            }
        }

        const cae = afipRes ? afipRes.cae : null;
        const expirationDate = afipRes ? afipRes.cae_expiration_date : null;

        await pool.query(
            'UPDATE credit_notes SET status = "authorized", cae = ?, cae_expiration_date = ? WHERE id = ?',
            [cae, expirationDate, creditNoteId]
        );

        await auditService.log({
            user_id: userId,
            action: 'AUTHORIZE_CREDIT_NOTE',
            entity_type: 'credit_note',
            entity_id: creditNoteId,
            new_values: { cae, cae_expiration_date: expirationDate }
        });

        const [updated] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [creditNoteId]);
        return updated[0];
    }
}

export const warrantiesService = new WarrantiesService();
export const returnsService = new ReturnsService();
export const creditNotesService = new CreditNotesService();
