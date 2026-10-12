import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class SupplierPaymentService {
    async getSupplierPayments(supplierId = null) {
        let query = `
            SELECT sp.*, s.name AS supplier_name
            FROM supplier_payments sp
            LEFT JOIN suppliers s ON sp.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];
        if (supplierId) {
            query += ' AND sp.supplier_id = ?';
            params.push(supplierId);
        }
        query += ' ORDER BY sp.payment_date DESC, sp.created_at DESC';

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createSupplierPayment(data, userId, ipAddress = null) {
        const { supplier_id, payment_date, notes, payments } = data;

        if (!supplier_id) {
            const err = new Error('supplier_id es obligatorio');
            err.errorCode = 'MISSING_SUPPLIER';
            throw err;
        }
        if (!Array.isArray(payments) || payments.length === 0) {
            const err = new Error('Debe incluir al menos una línea de pago');
            err.errorCode = 'MISSING_PAYMENTS';
            throw err;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            let total = 0;
            const createdIds = [];
            for (const payment of payments) {
                const amount = Number(payment.amount || 0);
                if (amount <= 0) continue;

                const id = crypto.randomUUID();
                createdIds.push(id);
                total += amount;

                await connection.query(`
                    INSERT INTO supplier_payments (id, supplier_id, amount, payment_date, payment_method, reference_number, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    id,
                    supplier_id,
                    amount,
                    payment_date || new Date().toISOString().slice(0, 10),
                    payment.payment_method || 'Efectivo',
                    payment.reference_number || null,
                    notes || null
                ]);
            }

            if (total <= 0) {
                const err = new Error('El monto total del pago debe ser mayor a 0');
                err.errorCode = 'INVALID_TOTAL';
                throw err;
            }

            await connection.query(`
                UPDATE suppliers
                SET account_balance = GREATEST(COALESCE(account_balance, 0) - ?, 0)
                WHERE id = ?
            `, [total, supplier_id]);

            await connection.query(`
                INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
                VALUES (?, 'expense', ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                total,
                'Pago a proveedor',
                createdIds[0] || null,
                supplier_id
            ]);

            await connection.commit();

            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_SUPPLIER_PAYMENT',
                entity_type: 'supplier_payment',
                entity_id: createdIds[0] || null,
                new_values: {
                    supplier_id,
                    payment_date: payment_date || new Date().toISOString().slice(0, 10),
                    notes: notes || null,
                    payment_ids: createdIds,
                    total
                },
                ip_address: ipAddress
            });

            return { success: true, ids: createdIds, total };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new SupplierPaymentService();
