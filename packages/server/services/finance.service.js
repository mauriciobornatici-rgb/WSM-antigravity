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

            const referenceNumber = String(payment?.reference_number || '').trim();
            return {
                method,
                amount,
                ...(referenceNumber ? { reference_number: referenceNumber } : {}),
                ...(payment?.check ? { check: payment.check } : {})
            };
        });
    }

    async _resolveCustomerCheck(connection, { clientId, payment, userId }) {
        if (payment.method !== 'check') return null;
        const details = payment.check || {};
        const issuerName = String(details.issuer_name || '').trim();
        const bankName = String(details.bank_name || '').trim();
        const checkNumber = String(details.check_number || '').trim();
        const dueDate = String(details.due_date || '').trim();
        const instrumentAmount = this._roundMoney(details.instrument_amount || payment.amount);
        if (!issuerName || !bankName || !checkNumber || !dueDate || instrumentAmount <= 0) {
            throw this._buildValidationError('Faltan datos obligatorios del cheque', 'INVALID_CHECK_DETAILS');
        }

        const [existing] = await connection.query(
            'SELECT id, amount FROM customer_checks WHERE bank_name = ? AND check_number = ? FOR UPDATE',
            [bankName, checkNumber]
        );
        if (existing.length > 0) {
            if (Math.abs(Number(existing[0].amount || 0) - instrumentAmount) > 0.01) {
                throw this._buildValidationError('El cheque ya existe con un importe diferente', 'CHECK_AMOUNT_MISMATCH');
            }
            return existing[0].id;
        }

        const checkId = crypto.randomUUID();
        await connection.query(`
            INSERT INTO customer_checks (
                id, client_id, issuer_name, bank_name, check_number, amount,
                issue_date, due_date, status, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
        `, [
            checkId,
            clientId || null,
            issuerName,
            bankName,
            checkNumber,
            instrumentAmount,
            details.issue_date || null,
            dueDate,
            details.notes || null,
            userId || null
        ]);
        await connection.query(
            `INSERT INTO customer_check_events (id, check_id, status, notes, performed_by)
             VALUES (?, ?, 'received', 'Cheque recibido en cobranza', ?)`,
            [crypto.randomUUID(), checkId, userId || null]
        );
        return checkId;
    }

    _normalizeOrderStatus(status) {
        const str = String(status || '').trim().toLowerCase();
        return str || 'pending';
    }

    async _registerInvoicePayments(connection, { invoiceId, clientId, invoiceLabel, payments, userId = null }) {
        for (const payment of payments) {
            if (!payment || Number(payment.amount || 0) <= 0) continue;
            const checkId = await this._resolveCustomerCheck(connection, { clientId, payment, userId });
            const transactionId = crypto.randomUUID();
            await connection.query(
                `INSERT INTO transactions (id, type, amount, description, payment_method, check_id, reference_id, client_id, date)
                 VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    transactionId,
                    this._roundMoney(payment.amount),
                    `Cobro factura ${invoiceLabel} (${payment.method})`,
                    payment.method,
                    checkId,
                    invoiceId,
                    clientId || null
                ]
            );

            if (checkId) {
                await connection.query(
                    `INSERT INTO customer_check_allocations (id, check_id, transaction_id, invoice_id, amount)
                     VALUES (?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), checkId, transactionId, invoiceId, this._roundMoney(payment.amount)]
                );
            }

            const normalizedMethod = String(payment.method).toLowerCase();
            const cashAccount = normalizedMethod === 'check'
                ? '1.1.02.02'
                : (['transfer', 'bank'].includes(normalizedMethod) ? '1.1.02.01' : '1.1.01.01');

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

    async _registerOrderReceivablePayments(connection, { orderId, clientId, orderLabel, payments, userId = null }) {
        for (const payment of payments) {
            if (!payment || Number(payment.amount || 0) <= 0) continue;
            const checkId = await this._resolveCustomerCheck(connection, { clientId, payment, userId });
            const transactionId = crypto.randomUUID();
            const amount = this._roundMoney(payment.amount);
            await connection.query(
                `INSERT INTO transactions (id, type, amount, description, payment_method, check_id, reference_id, client_id, date)
                 VALUES (?, 'sale', ?, ?, ?, ?, ?, ?, NOW())`,
                [transactionId, amount, `Cobro venta ${orderLabel} (${payment.method})`, payment.method, checkId, orderId, clientId]
            );

            if (checkId) {
                await connection.query(
                    `INSERT INTO customer_check_allocations (id, check_id, transaction_id, invoice_id, amount)
                     VALUES (?, ?, ?, NULL, ?)`,
                    [crypto.randomUUID(), checkId, transactionId, amount]
                );
            }

            const normalizedMethod = String(payment.method).toLowerCase();
            const cashAccount = normalizedMethod === 'check'
                ? '1.1.02.02'
                : (['transfer', 'bank'].includes(normalizedMethod) ? '1.1.02.01' : '1.1.01.01');
            await accountingService.createJournalEntry(connection, {
                date: new Date(),
                description: `Cobro anticipado de venta ${orderLabel} - (${payment.method})`,
                reference_type: 'order_receivable',
                reference_id: orderId,
                lines: [
                    { account_code: cashAccount, debit: amount, credit: 0, notes: `Cobro de ${orderLabel}` },
                    { account_code: '2.1.03.01', debit: 0, credit: amount, notes: 'Anticipo recibido antes de facturar' }
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
                payments: normalizedPayments,
                userId
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
                    // Payment only closes an order that was already delivered: jumping from
                    // pending/picking/packed would skip the stock deduction done at packing.
                    const shouldComplete = paymentStatus === 'paid' && currentOrderStatus === 'delivered';
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
            }, connection);

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

    async registerBulkInvoicePayments(payload, userId) {
        const { clientId, allocations, notes } = payload;
        if (!clientId) throw this._buildValidationError('Falta clientId', 'MISSING_CLIENT_ID');
        if (!Array.isArray(allocations) || allocations.length === 0) {
            throw this._buildValidationError('Falta allocations', 'MISSING_ALLOCATIONS');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            let totalPaid = 0;
            const results = [];

            for (const alloc of allocations) {
                const documentType = alloc.documentType || (alloc.invoiceId ? 'invoice' : null);
                const documentId = alloc.documentId || alloc.invoiceId;
                const payments = alloc.payments;

                if (documentType === 'order') {
                    const [orders] = await connection.query(
                        `SELECT o.*, c.name AS client_name,
                                CASE
                                    WHEN COALESCE(SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END), 0) > 0
                                        THEN SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END)
                                    WHEN o.payment_method = 'credit_account' THEN o.total_amount
                                    ELSE 0
                                END AS receivable_amount
                         FROM orders o
                         JOIN clients c ON c.id = o.client_id AND c.deleted_at IS NULL
                         LEFT JOIN order_payments op ON op.order_id = o.id
                         WHERE o.id = ? AND o.client_id = ? AND o.deleted_at IS NULL AND o.invoice_id IS NULL
                         GROUP BY o.id, c.name
                         FOR UPDATE`,
                        [documentId, clientId]
                    );
                    if (orders.length === 0 || Number(orders[0].receivable_amount || 0) <= 0) {
                        throw this._buildValidationError(`Venta ${documentId} no encontrada o ya facturada`, 'ORDER_RECEIVABLE_NOT_FOUND');
                    }
                    const order = orders[0];
                    const totalAmount = this._roundMoney(order.receivable_amount);
                    const [paymentRows] = await connection.query(
                        `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                         FROM transactions WHERE reference_id = ? AND type = 'sale'`,
                        [documentId]
                    );
                    const paidBefore = this._roundMoney(paymentRows[0]?.paid_amount || 0);
                    const normalizedPayments = this._normalizePaymentLines(payments, 'cash');
                    const paidNow = this._roundMoney(normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
                    const paidAfter = this._roundMoney(paidBefore + paidNow);
                    if (paidAfter > totalAmount + 0.01) {
                        throw this._buildValidationError(
                            `El total de pagos (${paidAfter}) supera el saldo de la venta ${documentId} (${totalAmount})`,
                            'PAYMENTS_EXCEED_TOTAL'
                        );
                    }

                    await this._registerOrderReceivablePayments(connection, {
                        orderId: documentId,
                        clientId,
                        orderLabel: `pedido ${String(documentId).slice(0, 8)}`,
                        payments: normalizedPayments,
                        userId
                    });
                    const paymentStatus = this._resolvePaymentStatus(totalAmount, paidAfter);
                    await connection.query('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, documentId]);
                    totalPaid += paidNow;
                    results.push({
                        documentId,
                        documentType: 'order',
                        paid_now: paidNow,
                        payment_status: paymentStatus
                    });
                    continue;
                }

                const invoiceId = documentId;
                
                const [invoices] = await connection.query(
                    'SELECT * FROM invoices WHERE id = ? AND client_id = ? AND deleted_at IS NULL FOR UPDATE',
                    [invoiceId, clientId]
                );
                if (invoices.length === 0) {
                    throw this._buildValidationError(`Factura ${invoiceId} no encontrada para el cliente`, 'INVOICE_NOT_FOUND');
                }
                const invoice = invoices[0];
                const totalAmount = this._roundMoney(invoice.total_amount || 0);

                const [paymentRows] = await connection.query(
                    `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                     FROM transactions
                     WHERE reference_id = ? AND type = 'sale'`,
                    [invoiceId]
                );
                const paidBefore = this._roundMoney(paymentRows[0]?.paid_amount || 0);

                const normalizedPayments = this._normalizePaymentLines(payments, invoice.payment_method || 'cash');
                const paidNow = this._roundMoney(
                    normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                );
                const paidAfter = this._roundMoney(paidBefore + paidNow);

                if (paidAfter > totalAmount + 0.01) {
                    throw this._buildValidationError(
                        `El total de pagos (${paidAfter}) supera el total de la factura ${invoiceId} (${totalAmount})`,
                        'PAYMENTS_EXCEED_TOTAL'
                    );
                }

                totalPaid += paidNow;

                const invoiceLabel = `${invoice.invoice_type}-${String(invoice.point_of_sale).padStart(4, '0')}-${String(invoice.invoice_number).padStart(8, '0')}`;
                await this._registerInvoicePayments(connection, {
                    invoiceId,
                    clientId: invoice.client_id || null,
                    invoiceLabel,
                    payments: normalizedPayments,
                    userId
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
                        // Same rule as registerInvoicePayments: payment only closes a delivered order.
                        const shouldComplete = paymentStatus === 'paid' && currentOrderStatus === 'delivered';
                        const nextOrderStatus = shouldComplete ? 'completed' : currentOrderStatus;

                        await connection.query(
                            'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
                            [paymentStatus, nextOrderStatus, invoice.order_id]
                        );
                    }
                }

                results.push({
                    invoiceId,
                    documentId: invoiceId,
                    documentType: 'invoice',
                    paid_now: paidNow,
                    payment_status: paymentStatus
                });
            }

            if (totalPaid > 0) {
                await connection.query(
                    `UPDATE clients
                     SET current_account_balance = GREATEST(COALESCE(current_account_balance, 0) - ?, 0)
                     WHERE id = ?`,
                    [totalPaid, clientId]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'REGISTER_BULK_INVOICE_PAYMENTS',
                entity_type: 'client',
                entity_id: clientId,
                new_values: {
                    total_paid: totalPaid,
                    allocations: allocations,
                    notes: notes || null
                }
            }, connection);

            await connection.commit();
            return {
                success: true,
                total_paid: totalPaid,
                invoices: results
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getCustomerChecks(filters = {}) {
        let query = `
            SELECT cc.*, c.name AS client_name,
                   COALESCE(SUM(cca.amount), 0) AS allocated_amount,
                   COUNT(DISTINCT cca.invoice_id) AS invoice_count
            FROM customer_checks cc
            LEFT JOIN clients c ON c.id = cc.client_id
            LEFT JOIN customer_check_allocations cca ON cca.check_id = cc.id
            WHERE 1=1
        `;
        const params = [];
        if (filters.status) {
            query += ' AND cc.status = ?';
            params.push(filters.status);
        }
        query += ' GROUP BY cc.id ORDER BY cc.due_date ASC, cc.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows.map((row) => ({
            ...row,
            amount: this._roundMoney(row.amount),
            allocated_amount: this._roundMoney(row.allocated_amount),
            invoice_count: Number(row.invoice_count || 0)
        }));
    }

    async getCustomerCheck(checkId) {
        const [rows] = await pool.query(`
            SELECT cc.*, c.name AS client_name
            FROM customer_checks cc
            LEFT JOIN clients c ON c.id = cc.client_id
            WHERE cc.id = ?
        `, [checkId]);
        if (rows.length === 0) return null;
        const [events] = await pool.query(`
            SELECT cce.*, u.name AS performed_by_name
            FROM customer_check_events cce
            LEFT JOIN users u ON u.id = cce.performed_by
            WHERE cce.check_id = ?
            ORDER BY cce.created_at DESC
        `, [checkId]);
        const [allocations] = await pool.query(`
            SELECT cca.*, i.invoice_type, i.point_of_sale, i.invoice_number
            FROM customer_check_allocations cca
            LEFT JOIN invoices i ON i.id = cca.invoice_id
            WHERE cca.check_id = ?
            ORDER BY cca.created_at ASC
        `, [checkId]);
        return { ...rows[0], events, allocations };
    }

    async updateCustomerCheckStatus(checkId, payload, userId) {
        const allowedStatuses = new Set(['received', 'deposited', 'cleared', 'endorsed', 'rejected', 'cancelled']);
        const status = String(payload?.status || '').trim().toLowerCase();
        if (!allowedStatuses.has(status)) {
            throw this._buildValidationError('Estado de cheque inválido', 'INVALID_CHECK_STATUS');
        }
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT * FROM customer_checks WHERE id = ? FOR UPDATE', [checkId]);
            if (rows.length === 0) {
                const error = new Error('Cheque no encontrado');
                error.statusCode = 404;
                error.errorCode = 'CHECK_NOT_FOUND';
                throw error;
            }
            const current = rows[0];
            const deliveredTo = String(payload?.delivered_to || current.delivered_to || '').trim();
            if (status === 'endorsed' && !deliveredTo) {
                throw this._buildValidationError(
                    'Debe indicar a quién se entrega o endosa el cheque',
                    'CHECK_DELIVERY_RECIPIENT_REQUIRED'
                );
            }
            const movementNotes = String(payload?.notes || '').trim();
            const eventNotes = status === 'endorsed'
                ? `Entregado a ${deliveredTo}${movementNotes ? `. ${movementNotes}` : ''}`
                : (movementNotes || null);
            const timestampField = status === 'deposited' ? 'deposited_at' : (status === 'cleared' ? 'cleared_at' : null);
            let updateSql = 'UPDATE customer_checks SET status = ?, delivered_to = ?, notes = ?';
            if (timestampField) updateSql += `, ${timestampField} = NOW()`;
            updateSql += ' WHERE id = ?';
            await connection.query(updateSql, [
                status,
                deliveredTo || null,
                movementNotes || current.notes || null,
                checkId
            ]);
            await connection.query(
                `INSERT INTO customer_check_events (id, check_id, status, notes, performed_by)
                 VALUES (?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), checkId, status, eventNotes, userId || null]
            );
            if (status === 'cleared' && !current.cleared_at) {
                await accountingService.createJournalEntry(connection, {
                    date: new Date(),
                    description: `Acreditación cheque ${current.check_number} - ${current.bank_name}`,
                    reference_type: 'customer_check',
                    reference_id: checkId,
                    lines: [
                        { account_code: '1.1.02.01', debit: Number(current.amount), credit: 0, notes: 'Ingreso en banco' },
                        { account_code: '1.1.02.02', debit: 0, credit: Number(current.amount), notes: 'Baja de valores a depositar' }
                    ]
                });
            }
            await auditService.log({
                user_id: userId,
                action: 'UPDATE_CUSTOMER_CHECK_STATUS',
                entity_type: 'customer_check',
                entity_id: checkId,
                old_values: { status: current.status },
                new_values: { status, notes: movementNotes || null, delivered_to: deliveredTo || null }
            }, connection);
            await connection.commit();
            return this.getCustomerCheck(checkId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async _resolveOutgoingCheck(connection, { supplierId, payment, userId, notes }) {
        if (payment.method !== 'check') return null;

        const details = payment.check || {};
        const sourceType = details.source_type === 'third_party' ? 'third_party' : 'own';
        const sourceCheckId = sourceType === 'third_party' ? String(details.source_customer_check_id || '').trim() : null;
        const instrumentAmount = this._roundMoney(details.instrument_amount || payment.amount);
        let issuerName = String(details.issuer_name || '').trim();
        let bankName = String(details.bank_name || '').trim();
        let checkNumber = String(details.check_number || '').trim();
        let issueDate = String(details.issue_date || '').trim() || null;
        let dueDate = String(details.due_date || '').trim();

        if (sourceCheckId) {
            const [existingOutgoing] = await connection.query(
                'SELECT id, amount FROM outgoing_checks WHERE source_customer_check_id = ? FOR UPDATE',
                [sourceCheckId]
            );
            if (existingOutgoing.length > 0) {
                if (Math.abs(Number(existingOutgoing[0].amount || 0) - instrumentAmount) > 0.01) {
                    throw this._buildValidationError('El cheque de terceros ya fue aplicado con otro importe', 'OUTGOING_CHECK_AMOUNT_MISMATCH');
                }
                return existingOutgoing[0].id;
            }

            const [sourceRows] = await connection.query(
                'SELECT * FROM customer_checks WHERE id = ? FOR UPDATE',
                [sourceCheckId]
            );
            if (sourceRows.length === 0) {
                throw this._buildValidationError('El cheque de terceros seleccionado no existe', 'SOURCE_CHECK_NOT_FOUND');
            }
            const source = sourceRows[0];
            if (source.status !== 'received') {
                throw this._buildValidationError('El cheque de terceros ya no está disponible para endoso', 'SOURCE_CHECK_NOT_AVAILABLE');
            }
            issuerName = source.issuer_name;
            bankName = source.bank_name;
            checkNumber = source.check_number;
            issueDate = source.issue_date || null;
            dueDate = String(source.due_date || '').slice(0, 10);
            if (Math.abs(Number(source.amount || 0) - instrumentAmount) > 0.01) {
                throw this._buildValidationError('El pago debe usar el importe total del cheque de terceros', 'SOURCE_CHECK_PARTIAL_USE_NOT_ALLOWED');
            }
        }

        if (!issuerName || !bankName || !checkNumber || !dueDate || instrumentAmount <= 0) {
            throw this._buildValidationError('Faltan datos obligatorios del cheque emitido', 'INVALID_OUTGOING_CHECK_DETAILS');
        }

        const [existing] = await connection.query(
            'SELECT id, amount FROM outgoing_checks WHERE bank_name = ? AND check_number = ? FOR UPDATE',
            [bankName, checkNumber]
        );
        if (existing.length > 0) {
            if (Math.abs(Number(existing[0].amount || 0) - instrumentAmount) > 0.01) {
                throw this._buildValidationError('El cheque emitido ya existe con otro importe', 'OUTGOING_CHECK_AMOUNT_MISMATCH');
            }
            return existing[0].id;
        }

        const checkId = crypto.randomUUID();
        await connection.query(`
            INSERT INTO outgoing_checks (
                id, supplier_id, source_type, source_customer_check_id, issuer_name,
                bank_name, check_number, amount, issue_date, due_date, status,
                delivered_at, notes, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', NOW(), ?, ?)
        `, [
            checkId, supplierId, sourceType, sourceCheckId, issuerName,
            bankName, checkNumber, instrumentAmount, issueDate, dueDate,
            notes || null, userId || null
        ]);
        await connection.query(
            `INSERT INTO outgoing_check_events (id, check_id, status, notes, performed_by)
             VALUES (?, ?, 'delivered', ?, ?)`,
            [crypto.randomUUID(), checkId, 'Cheque entregado al proveedor', userId || null]
        );

        if (sourceCheckId) {
            await connection.query(
                `UPDATE customer_checks
                 SET status = 'endorsed', delivered_to = (SELECT name FROM suppliers WHERE id = ?), notes = ?
                 WHERE id = ?`,
                [supplierId, notes || 'Aplicado a pago de proveedor', sourceCheckId]
            );
            await connection.query(
                `INSERT INTO customer_check_events (id, check_id, status, notes, performed_by)
                 VALUES (?, ?, 'endorsed', CONCAT('Entregado a proveedor: ', (SELECT name FROM suppliers WHERE id = ?)), ?)`,
                [crypto.randomUUID(), sourceCheckId, supplierId, userId || null]
            );
        }

        return checkId;
    }

    async registerBulkSupplierPayments(payload, userId) {
        const { supplierId, allocations, notes } = payload;
        if (!supplierId) throw this._buildValidationError('Falta supplierId', 'MISSING_SUPPLIER_ID');
        if (!Array.isArray(allocations) || allocations.length === 0) {
            throw this._buildValidationError('Falta allocations', 'MISSING_ALLOCATIONS');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            let totalPaid = 0;
            const results = [];

            for (const alloc of allocations) {
                const { invoiceId, payments } = alloc;
                
                const [invoices] = await connection.query(
                    'SELECT * FROM supplier_invoices WHERE id = ? AND supplier_id = ? FOR UPDATE',
                    [invoiceId, supplierId]
                );
                if (invoices.length === 0) {
                    throw this._buildValidationError(`Factura de proveedor ${invoiceId} no encontrada`, 'INVOICE_NOT_FOUND');
                }
                const invoice = invoices[0];
                const totalAmount = this._roundMoney(invoice.total_amount || 0);

                const [paymentRows] = await connection.query(
                    `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                     FROM supplier_payments
                     WHERE supplier_invoice_id = ?`,
                    [invoiceId]
                );
                const paidBefore = this._roundMoney(paymentRows[0]?.paid_amount || 0);

                const normalizedPayments = this._normalizePaymentLines(payments, 'cash');
                const paidNow = this._roundMoney(
                    normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                );
                const paidAfter = this._roundMoney(paidBefore + paidNow);

                if (paidAfter > totalAmount + 0.01) {
                    throw this._buildValidationError(
                        `El total de pagos (${paidAfter}) supera el total de la factura de proveedor ${invoiceId} (${totalAmount})`,
                        'PAYMENTS_EXCEED_TOTAL'
                    );
                }

                totalPaid += paidNow;

                // Register supplier payments
                for (const payment of normalizedPayments) {
                    const payId = crypto.randomUUID();
                    const outgoingCheckId = await this._resolveOutgoingCheck(connection, {
                        supplierId,
                        payment,
                        userId,
                        notes
                    });
                    await connection.query(
                        `INSERT INTO supplier_payments (id, supplier_id, amount, payment_date, payment_method, reference_number, outgoing_check_id, notes, supplier_invoice_id)
                         VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
                        [
                            payId,
                            supplierId,
                            payment.amount,
                            payment.method,
                            payment.reference_number || null,
                            outgoingCheckId,
                            notes || null,
                            invoiceId
                        ]
                    );

                    if (outgoingCheckId) {
                        await connection.query(
                            `INSERT INTO outgoing_check_allocations (id, check_id, supplier_payment_id, supplier_invoice_id, amount)
                             VALUES (?, ?, ?, ?, ?)`,
                            [crypto.randomUUID(), outgoingCheckId, payId, invoiceId, payment.amount]
                        );
                    }

                    // Create expense transactions
                    await connection.query(
                        `INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id, date)
                         VALUES (?, 'expense', ?, ?, ?, ?, NOW())`,
                        [
                            crypto.randomUUID(),
                            payment.amount,
                            `Pago factura proveedor ${invoice.invoice_number} (${payment.method})`,
                            payId,
                            supplierId
                        ]
                    );

                    // Journal entry for bookkeeping
                    const checkSourceType = payment.check?.source_type === 'third_party' ? 'third_party' : 'own';
                    const cashAccount = payment.method === 'check' && checkSourceType === 'third_party'
                        ? '1.1.02.02' // Valores a depositar entregados al proveedor
                        : (['transfer', 'bank', 'check'].includes(String(payment.method).toLowerCase())
                            ? '1.1.02.01' // Banco / cheque propio
                            : '1.1.01.01'); // Caja

                    await accountingService.createJournalEntry(connection, {
                        date: new Date(),
                        description: `Pago Factura Proveedor ${invoice.invoice_number} - (${payment.method})`,
                        reference_type: 'supplier_payment',
                        reference_id: payId,
                        lines: [
                            { account_code: '2.1.01.01', debit: payment.amount, credit: 0, notes: `Cancelación Deuda Proveedor` }, // Proveedores (Pasivo - disminuye)
                            { account_code: cashAccount, debit: 0, credit: payment.amount, notes: `Pago Factura Proveedor ${invoice.invoice_number}` } // Caja/Banco (Activo - disminuye)
                        ]
                    });
                }

                const paymentStatus = this._resolvePaymentStatus(totalAmount, paidAfter);
                await connection.query(
                    'UPDATE supplier_invoices SET payment_status = ? WHERE id = ?',
                    [paymentStatus, invoiceId]
                );

                results.push({
                    invoiceId,
                    paid_now: paidNow,
                    payment_status: paymentStatus
                });
            }

            // Update supplier account balance
            await connection.query(
                `UPDATE suppliers
                 SET account_balance = GREATEST(COALESCE(account_balance, 0) - ?, 0)
                 WHERE id = ?`,
                [totalPaid, supplierId]
            );

            await auditService.log({
                user_id: userId,
                action: 'REGISTER_BULK_SUPPLIER_PAYMENTS',
                entity_type: 'supplier',
                entity_id: supplierId,
                new_values: {
                    total_paid: totalPaid,
                    allocations: allocations,
                    notes: notes || null
                }
            }, connection);

            await connection.commit();
            return {
                success: true,
                total_paid: totalPaid,
                invoices: results
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getOutgoingChecks(filters = {}) {
        let query = `
            SELECT oc.*, s.name AS supplier_name,
                   COALESCE(SUM(oca.amount), 0) AS allocated_amount,
                   COUNT(DISTINCT oca.supplier_invoice_id) AS invoice_count
            FROM outgoing_checks oc
            LEFT JOIN suppliers s ON s.id = oc.supplier_id
            LEFT JOIN outgoing_check_allocations oca ON oca.check_id = oc.id
            WHERE 1=1
        `;
        const params = [];
        if (filters.status) {
            query += ' AND oc.status = ?';
            params.push(filters.status);
        }
        query += ' GROUP BY oc.id ORDER BY oc.due_date ASC, oc.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows.map((row) => ({
            ...row,
            amount: this._roundMoney(row.amount),
            allocated_amount: this._roundMoney(row.allocated_amount),
            invoice_count: Number(row.invoice_count || 0)
        }));
    }

    async getOutgoingCheck(checkId) {
        const [rows] = await pool.query(`
            SELECT oc.*, s.name AS supplier_name
            FROM outgoing_checks oc
            LEFT JOIN suppliers s ON s.id = oc.supplier_id
            WHERE oc.id = ?
        `, [checkId]);
        if (rows.length === 0) return null;
        const [events] = await pool.query(`
            SELECT oce.*, u.name AS performed_by_name
            FROM outgoing_check_events oce
            LEFT JOIN users u ON u.id = oce.performed_by
            WHERE oce.check_id = ?
            ORDER BY oce.created_at DESC
        `, [checkId]);
        const [allocations] = await pool.query(`
            SELECT oca.*, si.invoice_type, si.invoice_number
            FROM outgoing_check_allocations oca
            LEFT JOIN supplier_invoices si ON si.id = oca.supplier_invoice_id
            WHERE oca.check_id = ?
            ORDER BY oca.created_at ASC
        `, [checkId]);
        return { ...rows[0], events, allocations };
    }

    async updateOutgoingCheckStatus(checkId, payload, userId) {
        const allowedStatuses = new Set(['delivered', 'cleared', 'rejected', 'cancelled']);
        const status = String(payload?.status || '').trim().toLowerCase();
        if (!allowedStatuses.has(status)) {
            throw this._buildValidationError('Estado de cheque emitido inválido', 'INVALID_OUTGOING_CHECK_STATUS');
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT * FROM outgoing_checks WHERE id = ? FOR UPDATE', [checkId]);
            if (rows.length === 0) {
                const error = new Error('Cheque emitido no encontrado');
                error.statusCode = 404;
                error.errorCode = 'OUTGOING_CHECK_NOT_FOUND';
                throw error;
            }
            const current = rows[0];
            const movementNotes = String(payload?.notes || '').trim();
            let updateSql = 'UPDATE outgoing_checks SET status = ?, notes = ?';
            if (status === 'cleared') updateSql += ', cleared_at = NOW()';
            updateSql += ' WHERE id = ?';
            await connection.query(updateSql, [status, movementNotes || current.notes || null, checkId]);
            await connection.query(
                `INSERT INTO outgoing_check_events (id, check_id, status, notes, performed_by)
                 VALUES (?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), checkId, status, movementNotes || null, userId || null]
            );
            await auditService.log({
                user_id: userId,
                action: 'UPDATE_OUTGOING_CHECK_STATUS',
                entity_type: 'outgoing_check',
                entity_id: checkId,
                old_values: { status: current.status },
                new_values: { status, notes: movementNotes || null }
            }, connection);
            await connection.commit();
            return this.getOutgoingCheck(checkId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new FinanceService();
