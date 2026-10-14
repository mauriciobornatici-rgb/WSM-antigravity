import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { ACCOUNTS, disbursementAccountFor } from '../../utils/paymentAccounts.js';
import { recordDrawerOutflow } from '../../services/cashShift.service.js';
import { claimIdempotentRequest, saveIdempotentResponse } from '../../utils/idempotency.js';
import { ensureTreasuryFunds, lockTreasury } from '../../services/treasury.service.js';

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

            // ADR-015: a double click or a lost response must not pay (nor take cash out) twice.
            const { replay } = await claimIdempotentRequest(connection, 'supplier_payment', data.idempotency_key, data);
            if (replay) {
                await connection.commit();
                return replay;
            }

            // Lock order (ADR-015): Caja 2 before any drawer shift, as in treasury transfers.
            if (payments.some((p) => disbursementAccountFor(p.payment_method || 'Efectivo') === ACCOUNTS.TREASURY_CASH)) {
                await lockTreasury(connection);
            }

            let total = 0;
            const createdIds = [];
            for (const payment of payments) {
                const amount = Number(payment.amount || 0);
                if (amount <= 0) continue;

                const id = crypto.randomUUID();
                const method = payment.payment_method || 'Efectivo';
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
                    method,
                    payment.reference_number || null,
                    notes || null
                ]);

                // Same posting as the invoice-by-invoice payment: the supplier debt goes down
                // and so does the bank or cash account it was paid from.
                const sourceAccount = disbursementAccountFor(method);
                if (sourceAccount === ACCOUNTS.CASH) {
                    // Cash leaves the drawer: recorded once, in the open shift (ADR-014).
                    await recordDrawerOutflow(connection, { registerId: data.cash_register_id || null, amount, referenceId: id });
                } else if (sourceAccount === ACCOUNTS.TREASURY_CASH) {
                    // "Caja 2" (ADR-015): never spend more than it holds.
                    await ensureTreasuryFunds(connection, amount);
                }
                await accountingService.createJournalEntry(connection, {
                    date: new Date(),
                    description: `Pago a proveedor (${method})`,
                    reference_type: 'supplier_payment',
                    reference_id: id,
                    lines: [
                        { account_code: ACCOUNTS.SUPPLIERS, debit: amount, credit: 0, notes: 'Cancelación deuda proveedor' },
                        { account_code: sourceAccount, debit: 0, credit: amount, notes: payment.reference_number || 'Pago a proveedor' }
                    ]
                });
            }

            if (total <= 0) {
                const err = new Error('El monto total del pago debe ser mayor a 0');
                err.errorCode = 'INVALID_TOTAL';
                throw err;
            }

            await connection.query(`
                UPDATE suppliers
                SET account_balance = COALESCE(account_balance, 0) - ?
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

            // Audited inside the transaction: a failing audit no longer leaves a committed
            // payment behind for a retry to post twice.
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
            }, connection);
            const response = { success: true, ids: createdIds, total };
            await saveIdempotentResponse(connection, 'supplier_payment', data.idempotency_key, response);
            await connection.commit();

            return response;
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new SupplierPaymentService();
