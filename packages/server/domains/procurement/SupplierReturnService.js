import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';

export class SupplierReturnService {
    /**
     * Takes the returned goods out of stock that no order has reserved, preferring the
     * locations where goods waiting for the supplier usually sit. Every row touched gets
     * its own movement with its real location. Never drives stock below reservations.
     */
    async decreaseInventory(connection, item, returnId) {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) return;

        const [stockRows] = await connection.query(
            `SELECT id, location, quantity, reserved_quantity
             FROM inventory
             WHERE product_id = ? AND quantity - reserved_quantity > 0
             -- FIELD() ranks by position and unknown locations get 0: listed in reverse so that
             -- DESC tries 'Devoluciones a Proveedores' first, then Cuarentena, then Mermas.
             ORDER BY FIELD(location, 'Mermas', 'Cuarentena', 'Devoluciones a Proveedores') DESC,
                      quantity - reserved_quantity DESC, id
             FOR UPDATE`,
            [item.product_id]
        );

        let remaining = qty;
        for (const row of stockRows) {
            if (remaining <= 0) break;
            const available = Number(row.quantity || 0) - Number(row.reserved_quantity || 0);
            const consume = Math.min(available, remaining);
            if (consume <= 0) continue;
            const [result] = await connection.query(
                'UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity - reserved_quantity >= ?',
                [consume, row.id, consume]
            );
            if (Number(result?.affectedRows) !== 1) break;
            await connection.query(`
                INSERT INTO inventory_movements (
                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                ) VALUES (?, 'return', ?, ?, ?, ?, ?, 'supplier_return', ?)
            `, [
                crypto.randomUUID(),
                item.product_id,
                row.location || 'General',
                consume,
                item.unit_cost || 0,
                item.reason || 'Return to supplier',
                returnId
            ]);
            remaining -= consume;
        }

        if (remaining > 0) {
            throw Object.assign(new Error('Stock no reservado insuficiente para procesar la devolución al proveedor'), { errorCode: 'INSUFFICIENT_STOCK', statusCode: 409 });
        }
    }

    async _resolveReturnAccounting(connection, supplierId, netTotal) {
        const [invoices] = await connection.query(
            `SELECT si.net_amount, si.vat_amount
             FROM supplier_invoices si
             WHERE si.supplier_id = ?
               AND EXISTS (
                   SELECT 1 FROM journal_entries je
                   WHERE je.reference_type = 'supplier_invoice' AND je.reference_id = si.id
               )
             ORDER BY si.issue_date DESC, si.created_at DESC
             LIMIT 1`,
            [supplierId]
        );
        if (invoices.length === 0) return null;
        const invoiceNet = Number(invoices[0].net_amount || 0);
        const vatRatio = invoiceNet > 0 ? Number(invoices[0].vat_amount || 0) / invoiceNet : 0;
        const netCents = Math.round(netTotal * 100);
        const vatCents = Math.round(netCents * vatRatio);
        return { netAmount: netCents / 100, vatAmount: vatCents / 100, grossAmount: (netCents + vatCents) / 100 };
    }

    async nextSupplierReturnNumber(connection) {
        const year = new Date().getFullYear();
        const prefix = `SR-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(return_number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM supplier_returns
             WHERE return_number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `supplier_return:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    async getReturns(filters = {}) {
        const { supplier_id, status } = filters;
        let query = `
            SELECT sr.*, s.name AS supplier_name
            FROM supplier_returns sr
            LEFT JOIN suppliers s ON sr.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];
        if (supplier_id) {
            query += ' AND sr.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND sr.status = ?';
            params.push(status);
        }
        query += ' ORDER BY sr.created_at DESC';

        try {
            const [rows] = await pool.query(query, params);
            if (rows.length === 0) return rows;

            const ids = rows.map((r) => r.id);
            const [items] = await pool.query(`
                SELECT sri.*, p.name AS product_name, p.sku
                FROM supplier_return_items sri
                LEFT JOIN products p ON sri.product_id = p.id
                WHERE sri.return_id IN (?)
            `, [ids]);

            const itemsByReturn = {};
            for (const item of items) {
                if (!itemsByReturn[item.return_id]) itemsByReturn[item.return_id] = [];
                itemsByReturn[item.return_id].push(item);
            }

            return rows.map((r) => ({
                ...r,
                items: itemsByReturn[r.id] || []
            }));
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [];
            }
            throw err;
        }
    }

    async createReturn(data, userId, ipAddress = null) {
        const { supplier_id, items, notes } = data;
        const id = crypto.randomUUID();

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const returnNumber = await this.nextSupplierReturnNumber(connection);

            await connection.query(`
                INSERT INTO supplier_returns (id, return_number, supplier_id, notes, status)
                VALUES (?, ?, ?, ?, 'draft')
            `, [id, returnNumber, supplier_id, notes || null]);

            for (const item of items || []) {
                await connection.query(`
                    INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost, reason)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    id,
                    item.product_id,
                    item.quantity,
                    item.unit_cost || 0,
                    item.reason || null
                ]);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_SUPPLIER_RETURN',
                entity_type: 'supplier_return',
                entity_id: id,
                new_values: {
                    id,
                    return_number: returnNumber,
                    supplier_id,
                    notes: notes || null,
                    items: items || []
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id, return_number: returnNumber };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async approveSupplierReturn(id, userId, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [returns] = await connection.query('SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE', [id]);
            if (returns.length === 0) {
                throw Object.assign(new Error('Devolución no encontrada'), { errorCode: 'RETURN_NOT_FOUND', statusCode: 404 });
            }
            const supplierReturn = returns[0];
            if (supplierReturn.status === 'approved') {
                throw Object.assign(new Error('La devolución ya fue aprobada'), { errorCode: 'RETURN_ALREADY_APPROVED', statusCode: 409 });
            }

            const [items] = await connection.query('SELECT * FROM supplier_return_items WHERE return_id = ?', [id]);
            if (items.length === 0) {
                throw Object.assign(new Error('La devolución no tiene ítems'), { errorCode: 'RETURN_WITHOUT_ITEMS', statusCode: 400 });
            }

            let totalAmount = 0;
            // Stable lock order across products (no deadlock between two approvals).
            const orderedItems = [...items].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));
            for (const item of orderedItems) {
                await this.decreaseInventory(connection, item, id);
                totalAmount = Math.round((totalAmount + Number(item.quantity) * Number(item.unit_cost || 0)) * 100) / 100;
            }

            await connection.query('UPDATE supplier_returns SET status = "approved" WHERE id = ?', [id]);

            // Mirror of the purchase (ADR-011). Only the supplier invoice posts a purchase
            // (ADR-008): goods returned before any invoice were never booked, so they only
            // move stock. Otherwise the VAT treatment follows the supplier's last posted
            // invoice (its VAT/net ratio: 0 for a Factura C, 21 % or the mix for a Factura A).
            const accounting = totalAmount > 0
                ? await this._resolveReturnAccounting(connection, supplierReturn.supplier_id, totalAmount)
                : null;
            if (accounting) {
                const { netAmount, vatAmount, grossAmount } = accounting;
                await accountingService.createJournalEntry(connection, {
                    description: `Devolución a proveedor ${supplierReturn.return_number}`,
                    reference_type: 'supplier_return',
                    reference_id: id,
                    lines: [
                        { account_code: '2.1.01.01', debit: grossAmount, credit: 0, notes: 'Proveedores - devolución' },
                        { account_code: '1.1.04.01', debit: 0, credit: netAmount, notes: 'Salida de mercadería devuelta' },
                        ...(vatAmount > 0
                            ? [{ account_code: '1.1.05.02', debit: 0, credit: vatAmount, notes: 'Reversión de IVA Crédito Fiscal' }]
                            : [])
                    ]
                });

                // Not a cash outflow: an adjustment that reduces what we owe the supplier.
                await connection.query(`
                    INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
                    VALUES (?, 'adjustment', ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    grossAmount,
                    `Devolución a proveedor ${supplierReturn.return_number}`,
                    id,
                    supplierReturn.supplier_id
                ]);

                // May go below zero: a balance in our favour is real and must not vanish.
                await connection.query(`
                    UPDATE suppliers
                    SET account_balance = COALESCE(account_balance, 0) - ?
                    WHERE id = ?
                `, [grossAmount, supplierReturn.supplier_id]);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'APPROVE_SUPPLIER_RETURN',
                entity_type: 'supplier_return',
                entity_id: id,
                old_values: { status: supplierReturn.status },
                new_values: {
                    status: 'approved',
                    total_amount: totalAmount,
                    accounting: accounting || 'not_posted: no supplier invoice posted yet (goods never booked)'
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { success: true, message: 'Devolución aprobada correctamente' };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new SupplierReturnService();
