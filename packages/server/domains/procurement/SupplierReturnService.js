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
                totalAmount += Number(item.quantity) * Number(item.unit_cost || 0);
            }

            await connection.query('UPDATE supplier_returns SET status = "approved" WHERE id = ?', [id]);

            if (totalAmount > 0) {
                await accountingService.createJournalEntry(connection, {
                    description: `Devolución a proveedor ${supplierReturn.return_number}`,
                    reference_type: 'supplier_return',
                    reference_id: id,
                    lines: [
                        { account_code: '2.1.01.01', debit: totalAmount, credit: 0 },
                        { account_code: '1.1.04.01', debit: 0, credit: totalAmount }
                    ]
                });

                await connection.query(`
                    INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
                    VALUES (?, 'expense', ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    totalAmount,
                    `Devolución a proveedor ${supplierReturn.return_number}`,
                    id,
                    supplierReturn.supplier_id
                ]);

                await connection.query(`
                    UPDATE suppliers
                    SET account_balance = GREATEST(COALESCE(account_balance, 0) - ?, 0)
                    WHERE id = ?
                `, [totalAmount, supplierReturn.supplier_id]);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'APPROVE_SUPPLIER_RETURN',
                entity_type: 'supplier_return',
                entity_id: id,
                old_values: { status: supplierReturn.status },
                new_values: { status: 'approved', total_amount: totalAmount },
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
