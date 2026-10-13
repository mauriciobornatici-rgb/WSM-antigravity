import pool from '../../config/db.js';
import defaultAuditService from '../../services/audit.service.js';
import defaultSalesService from '../../services/sales.service.js';
import defaultCreateOrderUseCase, { isOfflineReplay } from './CreateOrderUseCase.js';
import { lockOpenShift, recordShiftSalePayments } from '../../services/cashShift.service.js';

/**
 * A POS counter checkout as ONE transaction: the sale (stock deducted with its
 * movements), the invoice when requested, and the cash-shift payments. Before this the
 * browser made 3+ separate calls and a failure between them left a sale without its
 * invoice or its cash record.
 *
 * Idempotent by `idempotency_key`: a replay (network retry or offline queue) completes
 * whatever is missing — invoice, shift payments — and never duplicates the sale.
 */
export class PosCheckoutUseCase {
    constructor({
        db = pool,
        auditService = defaultAuditService,
        salesService = defaultSalesService,
        createOrderUseCase = defaultCreateOrderUseCase,
    } = {}) {
        this.db = db;
        this.auditService = auditService;
        this.salesService = salesService;
        this.createOrderUseCase = createOrderUseCase;
    }

    async execute(payload, userId, actor = null) {
        try {
            return await this._checkout(payload, userId, actor);
        } catch (error) {
            // Two simultaneous requests with the same key (double click, network retry):
            // the loser retries once and finds the committed sale as a replay.
            if (error?.code === 'ER_DUP_ENTRY' || error?.code === 'ER_LOCK_DEADLOCK') {
                return this._checkout(payload, userId, actor);
            }
            throw error;
        }
    }

    async _checkout(payload, userId, actor) {
        const {
            idempotency_key: idempotencyKey,
            shift_id: requestedShiftId,
            emit_invoice: emitInvoice = false,
            invoice_type: invoiceType,
            point_of_sale: pointOfSale,
            ...orderFields
        } = payload;
        const orderData = { ...orderFields, external_source: 'pos', external_id: idempotencyKey };
        delete orderData.shipping_method; // a counter checkout is always take-away

        const connection = await this.db.getConnection();
        let syncStock = null;
        try {
            await connection.beginTransaction();

            // Same offline criterion as prices and stock (captured ≤ 30 days ago, no future dates).
            const shift = await lockOpenShift(connection, requestedShiftId, {
                allowReassign: isOfflineReplay(orderData),
            });

            const [existing] = await connection.query(
                "SELECT id, total_amount, invoice_id FROM orders WHERE external_source = 'pos' AND external_id = ? FOR UPDATE",
                [idempotencyKey]
            );
            const replay = existing.length > 0;
            let order;
            let payments = orderData.payments;
            if (replay) {
                order = { id: existing[0].id, total_amount: Number(existing[0].total_amount || 0), invoice_id: existing[0].invoice_id };
                // The payments stored with the order (an offline sale may have absorbed cents).
                const [stored] = await connection.query(
                    'SELECT payment_method AS method, amount, check_payload FROM order_payments WHERE order_id = ? ORDER BY created_at, id',
                    [order.id]
                );
                if (stored.length > 0) {
                    payments = stored.map((row) => ({
                        method: row.method,
                        amount: Number(row.amount),
                        check: typeof row.check_payload === 'string' ? JSON.parse(row.check_payload) : row.check_payload || null,
                    }));
                }
            } else {
                const created = await this.createOrderUseCase.execute(orderData, userId, actor, connection);
                syncStock = created.syncStock;
                payments = created.payments ?? orderData.payments;
                order = { id: created.id, total_amount: created.total_amount, invoice_id: null };
            }

            let invoice = null;
            if (emitInvoice && !order.invoice_id) {
                // ADR-021 / AUD-009: a sale made offline is never lost over the invoice letter:
                // its number is still provisional, so a letter ARCA would refuse is corrected.
                invoice = await this.salesService.createInvoice(order.id, {
                    invoice_type: invoiceType,
                    point_of_sale: pointOfSale,
                    payments,
                }, userId, connection, { checkReceiverCondition: !isOfflineReplay(orderData) });
            } else if (order.invoice_id) {
                const [invoices] = await connection.query('SELECT * FROM invoices WHERE id = ?', [order.invoice_id]);
                invoice = invoices[0] || null;
            }

            const cash = await recordShiftSalePayments(connection, {
                shiftId: shift.shiftId,
                orderId: order.id,
                payments,
            });

            await this.auditService.log({
                user_id: userId,
                action: 'POS_CHECKOUT',
                entity_type: 'order',
                entity_id: order.id,
                new_values: {
                    idempotent_replay: replay,
                    shift_id: shift.shiftId,
                    ...(shift.reassigned ? { original_shift_id: shift.originalShiftId, reason: 'offline sale synced after shift close' } : {}),
                    invoice_id: invoice?.id || null,
                    ...(invoice && invoiceType && String(invoice.invoice_type).toUpperCase() !== String(invoiceType).toUpperCase()
                        ? { invoice_type_requested: invoiceType, invoice_type_issued: invoice.invoice_type }
                        : {}),
                    shift_payments: cash.inserted,
                },
            }, connection);

            await connection.commit();
            syncStock?.();

            return {
                order_id: order.id,
                total_amount: order.total_amount,
                invoice,
                shift_id: shift.shiftId,
                expected_balance: cash.expected_balance,
                idempotent_replay: replay,
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new PosCheckoutUseCase();
