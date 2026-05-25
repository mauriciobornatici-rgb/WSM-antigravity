import pool from '../config/db.js';
import crypto from 'crypto';
import auditService from './audit.service.js';
import accountingService from './accounting.service.js';

class FinanceService {
    _buildValidationError(message, errorCode = 'VALIDATION_ERROR') {
        const err = new Error(message);
        err.statusCode = 400;
        err.status = 'fail';
        err.errorCode = errorCode;
        return err;
    }

    _roundMoney(value) {
        const number = Number(value || 0);
        return Math.round((number + Number.EPSILON) * 100) / 100;
    }

    _resolvePaymentStatus(totalAmount, paidAmount) {
        const safeTotal = this._roundMoney(totalAmount);
        const safePaid = this._roundMoney(paidAmount);

        if (safePaid <= 0) return 'pending';
        if (safePaid + 0.01 < safeTotal) return 'partial';
        return 'paid';
    }

    _normalizePaymentLines(payments, fallbackMethod = 'cash') {
        if (!Array.isArray(payments) || payments.length === 0) {
            throw this._buildValidationError('Debe incluir al menos una linea de pago', 'MISSING_PAYMENTS');
        }

        return payments.map((payment, index) => {
            const amount = this._roundMoney(payment?.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw this._buildValidationError(
                    `Monto de pago invalido en posicion ${index + 1}`,
                    'INVALID_PAYMENT_AMOUNT'
                );
            }

            const method = String(payment?.method || fallbackMethod || 'cash').trim().toLowerCase();
            if (!method) {
                throw this._buildValidationError(
                    `Metodo de pago invalido en posicion ${index + 1}`,
                    'INVALID_PAYMENT_METHOD'
                );
            }

            return { method, amount };
        });
    }

    _normalizeOrderStatus(status) {
        const str = String(status || '').trim().toLowerCase();
        return str || 'pending';
    }

    async _registerInvoicePayments(connection, { invoiceId, clientId, invoiceLabel, payments }) {
        for (const payment of payments) {
            if (!payment || Number(payment.amount || 0) <= 0) continue;
            await connection.query(
                `INSERT INTO transactions (id, type, amount, description, reference_id, client_id, date)
                 VALUES (?, 'sale', ?, ?, ?, ?, NOW())`,
                [
                    crypto.randomUUID(),
                    this._roundMoney(payment.amount),
                    `Cobro factura ${invoiceLabel} (${payment.method})`,
                    invoiceId,
                    clientId || null
                ]
            );

            const cashAccount = ['transfer', 'bank'].includes(String(payment.method).toLowerCase())
                ? '1.1.02.01'
                : '1.1.01.01';

            const payAmount = this._roundMoney(payment.amount);
            await accountingService.createJournalEntry(connection, {
                date: new Date(),
                description: `Cobro Factura ${invoiceLabel} - (${payment.method})`,
                reference_type: 'invoice',
                reference_id: invoiceId,
                lines: [
                    { account_code: cashAccount, debit: payAmount, credit: 0, notes: `Cobro Factura ${invoiceLabel}` },
                    { account_code: '1.1.03.01', debit: 0, credit: payAmount, notes: `Cancelación Parcial/Total Cliente` }
                ]
            });
        }
    }

    async registerInvoicePayments(invoiceId, payload, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invoices] = await connection.query(
                'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [invoiceId]
            );
            if (invoices.length === 0) {
                const err = new Error('Invoice not found');
                err.statusCode = 404;
                err.status = 'fail';
                err.errorCode = 'INVOICE_NOT_FOUND';
                throw err;
            }

            const invoice = invoices[0];
            const totalAmount = this._roundMoney(invoice.total_amount || 0);
            if (totalAmount <= 0) {
                throw this._buildValidationError('La factura no tiene monto pendiente', 'INVALID_INVOICE_TOTAL');
            }

            const [paymentRows] = await connection.query(
                `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                 FROM transactions
                 WHERE reference_id = ? AND type = 'sale'`,
                [invoiceId]
            );
            const paidBefore = this._roundMoney(paymentRows[0]?.paid_amount || 0);

            const normalizedPayments = this._normalizePaymentLines(
                payload?.payments,
                invoice.payment_method || 'cash'
            );
            const paidNow = this._roundMoney(
                normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
            );
            const paidAfter = this._roundMoney(paidBefore + paidNow);

            if (paidAfter > totalAmount + 0.01) {
                throw this._buildValidationError(
                    `El total de pagos (${paidAfter}) supera el total de la factura (${totalAmount})`,
                    'PAYMENTS_EXCEED_TOTAL'
                );
            }

            const invoiceLabel = `${invoice.invoice_type}-${String(invoice.point_of_sale).padStart(4, '0')}-${String(invoice.invoice_number).padStart(8, '0')}`;
            await this._registerInvoicePayments(connection, {
                invoiceId,
                clientId: invoice.client_id || null,
                invoiceLabel,
                payments: normalizedPayments
            });

            const paymentStatus = this._resolvePaymentStatus(totalAmount, paidAfter);
            const paymentMethod = normalizedPayments.length > 1
                ? 'multiple'
                : normalizedPayments[0]?.method || invoice.payment_method || null;

            await connection.query(
                'UPDATE invoices SET payment_status = ?, payment_method = ? WHERE id = ?',
                [paymentStatus, paymentMethod, invoiceId]
            );

            if (invoice.order_id) {
                const [orders] = await connection.query(
                    'SELECT id, status FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                    [invoice.order_id]
                );
                if (orders.length > 0) {
                    const currentOrderStatus = this._normalizeOrderStatus(orders[0].status);
                    const shouldComplete =
                        paymentStatus === 'paid'
                        && currentOrderStatus !== 'completed'
                        && currentOrderStatus !== 'cancelled'
                        && currentOrderStatus !== 'returned';
                    const nextOrderStatus = shouldComplete ? 'completed' : currentOrderStatus;

                    await connection.query(
                        'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
                        [paymentStatus, nextOrderStatus, invoice.order_id]
                    );
                }
            }

            if (invoice.client_id) {
                await connection.query(
                    `UPDATE clients
                     SET current_account_balance = GREATEST(COALESCE(current_account_balance, 0) - ?, 0)
                     WHERE id = ?`,
                    [paidNow, invoice.client_id]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'REGISTER_INVOICE_PAYMENT',
                entity_type: 'invoice',
                entity_id: invoiceId,
                new_values: {
                    paid_now: paidNow,
                    paid_before: paidBefore,
                    paid_after: paidAfter,
                    total_amount: totalAmount,
                    payment_status: paymentStatus,
                    payment_method: paymentMethod,
                    payments: normalizedPayments,
                    notes: payload?.notes || null
                }
            });

            await connection.commit();
            return {
                id: invoiceId,
                total_amount: totalAmount,
                paid_before: paidBefore,
                paid_now: paidNow,
                paid_amount: paidAfter,
                pending_amount: this._roundMoney(totalAmount - paidAfter),
                payment_status: paymentStatus
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new FinanceService();
