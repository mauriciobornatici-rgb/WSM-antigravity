import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';

export class SupplierReturnService {
    async decreaseInventory(connection, productId, quantityToRemove) {
        const qty = Number(quantityToRemove || 0);
        if (qty <= 0) return;

        const [stockRows] = await connection.query(
            'SELECT id, quantity FROM inventory WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC FOR UPDATE',
            [productId]
        );

        let remaining = qty;
        for (const row of stockRows) {
            if (remaining <= 0) break;
            const available = Number(row.quantity || 0);
            const consume = Math.min(available, remaining);
            await connection.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [consume, row.id]);
            remaining -= consume;
        }

        if (remaining > 0) {
            const err = new Error('Stock insuficiente para procesar la devolución');
            err.errorCode = 'INSUFFICIENT_STOCK';
            throw err;
        }
    }

    async approveSupplierReturn(id, userId, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [returns] = await connection.query('SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE', [id]);
            if (returns.length === 0) {
                await connection.rollback();
                const err = new Error('Devolución no encontrada');
                err.errorCode = 'RETURN_NOT_FOUND';
                throw err;
            }
            const supplierReturn = returns[0];
            if (supplierReturn.status === 'approved') {
                await connection.rollback();
                const err = new Error('La devolución ya fue aprobada');
                err.errorCode = 'RETURN_ALREADY_APPROVED';
                throw err;
            }

            const [items] = await connection.query('SELECT * FROM supplier_return_items WHERE return_id = ?', [id]);
            if (items.length === 0) {
                const err = new Error('La devolución no tiene ítems');
                err.errorCode = 'RETURN_WITHOUT_ITEMS';
                throw err;
            }

            let totalAmount = 0;
            for (const item of items) {
                await this.decreaseInventory(connection, item.product_id, Number(item.quantity));
                totalAmount += Number(item.quantity) * Number(item.unit_cost || 0);

                await connection.query(`
                    INSERT INTO inventory_movements (
                        id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                    ) VALUES (?, 'return', ?, ?, ?, ?, ?, 'supplier_return', ?)
                `, [
                    crypto.randomUUID(),
                    item.product_id,
                    'General',
                    item.quantity,
                    item.unit_cost || 0,
                    item.reason || 'Return to supplier',
                    id
                ]);
            }

            await connection.query('UPDATE supplier_returns SET status = "approved" WHERE id = ?', [id]);

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
