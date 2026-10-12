import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';

function domainError(message, errorCode, statusCode) {
    const err = new Error(message);
    err.errorCode = errorCode;
    err.statusCode = statusCode;
    return err;
}

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
             ORDER BY FIELD(location, 'Devoluciones a Proveedores', 'Cuarentena', 'Mermas') DESC,
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
            throw domainError(
                'Stock no reservado insuficiente para procesar la devolución al proveedor',
                'INSUFFICIENT_STOCK',
                409
            );
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

    async approveSupplierReturn(id, userId, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [returns] = await connection.query('SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE', [id]);
            if (returns.length === 0) {
                throw domainError('Devolución no encontrada', 'RETURN_NOT_FOUND', 404);
            }
            const supplierReturn = returns[0];
            if (supplierReturn.status === 'approved') {
                throw domainError('La devolución ya fue aprobada', 'RETURN_ALREADY_APPROVED', 409);
            }

            const [items] = await connection.query('SELECT * FROM supplier_return_items WHERE return_id = ?', [id]);
            if (items.length === 0) {
                throw domainError('La devolución no tiene ítems', 'RETURN_WITHOUT_ITEMS', 400);
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
