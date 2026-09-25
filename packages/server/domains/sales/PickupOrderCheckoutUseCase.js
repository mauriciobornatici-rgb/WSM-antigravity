import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import salesService from '../../services/sales.service.js';
import { calculateShiftExpectedBalance } from '../../services/cashShift.service.js';

export class PickupOrderCheckoutUseCase {
    constructor(dependencies = {}) {
        this.pool = dependencies.pool || pool;
        this.auditService = dependencies.auditService || auditService;
        this.salesService = dependencies.salesService || salesService;
        this.calculateShiftExpectedBalance = dependencies.calculateShiftExpectedBalance || calculateShiftExpectedBalance;
    }

    _normalizeOrderStatus(status) {
        const raw = String(status || '').trim().toLowerCase();
        const alias = {
            confirmed: 'picking',
            paid: 'packed'
        };
        return alias[raw] || raw;
    }

    _buildBusinessError(message, errorCode, statusCode = 400) {
        const err = new Error(message);
        err.statusCode = statusCode;
        err.errorCode = errorCode;
        return err;
    }

    async execute(orderId, payload = {}, userId = null) {
        const connection = await this.pool.getConnection();

        try {
            await connection.beginTransaction();

            const [orders] = await connection.query(
                'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [orderId]
            );

            if (orders.length === 0) {
                const err = new Error('Order not found');
                err.statusCode = 404;
                err.errorCode = 'ORDER_NOT_FOUND';
                throw err;
            }

            const order = orders[0];
            const currentStatus = this._normalizeOrderStatus(order.status);

            if (order.shipping_method !== 'pickup') {
                throw this._buildBusinessError(
                    'El pedido no está configurado para retiro en mostrador.',
                    'ORDER_NOT_PICKUP'
                );
            }

            if (['delivered', 'completed', 'cancelled', 'returned'].includes(currentStatus)) {
                throw this._buildBusinessError(
                    `El pedido ya se encuentra en estado finalizado o anulado (${order.status}).`,
                    'ORDER_ALREADY_FINALIZED'
                );
            }

            if (!['packed', 'dispatched'].includes(currentStatus)) {
                throw this._buildBusinessError(
                    `El pedido no está listo para entrega (estado actual: ${order.status}). Debe estar preparado por almacén.`,
                    'ORDER_NOT_READY_FOR_PICKUP'
                );
            }

            if (payload.shift_id !== undefined && payload.shift_id !== null) {
                const [shifts] = await connection.query(
                    'SELECT id, status FROM cash_shifts WHERE id = ? FOR UPDATE',
                    [payload.shift_id]
                );
                if (shifts.length === 0 || String(shifts[0].status || '').trim().toLowerCase() !== 'open') {
                    throw this._buildBusinessError(
                        'El turno de caja no existe o no está abierto.',
                        'CASH_SHIFT_NOT_OPEN',
                        409
                    );
                }
            }

            // 1. Process extra items if added at POS counter
            if (Array.isArray(payload.extra_items) && payload.extra_items.length > 0) {
                for (const item of payload.extra_items) {
                    const qty = parseInt(String(item.quantity), 10);
                    if (!Number.isFinite(qty) || qty <= 0) {
                        const err = new Error('Cantidad inválida para producto extra');
                        err.statusCode = 400;
                        err.errorCode = 'INVALID_QUANTITY';
                        throw err;
                    }

                    const [products] = await connection.query(
                        'SELECT id, name, sku, sale_price, vat_rate FROM products WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                        [item.product_id]
                    );

                    if (products.length === 0) {
                        const err = new Error(`Producto extra no encontrado: ${item.product_id}`);
                        err.statusCode = 404;
                        err.errorCode = 'PRODUCT_NOT_FOUND';
                        throw err;
                    }

                    const product = products[0];
                    const requestedPrice = Number(item.unit_price);
                    const unitPrice = Number.isFinite(requestedPrice) && requestedPrice >= 0
                        ? requestedPrice
                        : Number(product.sale_price || 0);

                    // Check physical availability
                    const [stockRows] = await connection.query(
                        `SELECT id, location, quantity, reserved_quantity, (quantity - reserved_quantity) AS available_quantity
                         FROM inventory
                         WHERE product_id = ? AND (quantity - reserved_quantity) > 0
                           AND location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
                         ORDER BY (quantity - reserved_quantity) DESC
                         FOR UPDATE`,
                        [item.product_id]
                    );

                    const availableQty = stockRows.reduce((sum, row) => sum + Number(row.available_quantity || 0), 0);
                    if (availableQty < qty) {
                        const err = new Error(`Stock insuficiente para ${product.name}. Disponible: ${availableQty}, solicitado: ${qty}`);
                        err.statusCode = 409;
                        err.errorCode = 'INSUFFICIENT_STOCK';
                        throw err;
                    }

                    // Deduct physical stock
                    let remaining = qty;
                    for (const row of stockRows) {
                        if (remaining <= 0) break;
                        const avail = Number(row.available_quantity || 0);
                        const consume = Math.min(avail, remaining);
                        if (consume <= 0) continue;

                        await connection.query(
                            'UPDATE inventory SET quantity = GREATEST(quantity - ?, 0) WHERE id = ?',
                            [consume, row.id]
                        );

                        await connection.query(
                            `INSERT INTO inventory_movements (
                                id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                            ) VALUES (?, 'sale', ?, ?, ?, 0, 'Mostrador POS - agregado a pedido', 'order', ?)`,
                            [crypto.randomUUID(), item.product_id, row.location || 'General', consume, orderId]
                        );

                        remaining -= consume;
                    }

                    // Record order item as already physically picked
                    const orderItemId = crypto.randomUUID();
                    const subtotal = Math.round(qty * unitPrice * 100) / 100;
                    await connection.query(
                        `INSERT INTO order_items (id, order_id, product_id, quantity, picked_quantity, unit_price, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [orderItemId, orderId, item.product_id, qty, qty, unitPrice, subtotal]
                    );

                    // Increment order total
                    await connection.query(
                        'UPDATE orders SET total_amount = total_amount + ? WHERE id = ?',
                        [subtotal, orderId]
                    );
                }
            }

            // 2. Mark order as delivered with recipient details
            const recipientName = payload.recipient_name || order.customer_name || 'Cliente Mostrador';
            const recipientDni = payload.recipient_dni || null;
            const deliveryNotes = payload.delivery_notes || 'Retiro en mostrador POS';

            await connection.query(
                `UPDATE orders
                 SET status = 'delivered',
                     recipient_name = ?,
                     recipient_dni = ?,
                     delivery_notes = ?,
                     delivered_at = NOW()
                 WHERE id = ?`,
                [recipientName, recipientDni, deliveryNotes, orderId]
            );

            await this.auditService.log({
                user_id: userId,
                action: 'DELIVER_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                old_values: { status: order.status },
                new_values: {
                    status: 'delivered',
                    recipient_name: recipientName,
                    recipient_dni: recipientDni,
                    delivery_notes: deliveryNotes
                }
            }, connection);

            // 3. Issue invoice (if not already issued)
            let invoice = null;
            if (!order.invoice_id) {
                invoice = await this.salesService.createInvoice(orderId, {
                    invoice_type: payload.invoice_type || 'B',
                    point_of_sale: payload.point_of_sale,
                    payments: payload.payments || [],
                    notes: payload.notes || deliveryNotes
                }, userId, connection);
            } else {
                const [invRows] = await connection.query(`
                    SELECT i.*, c.tax_id AS client_tax_id, c.address AS client_address
                    FROM invoices i
                    LEFT JOIN clients c ON i.client_id = c.id
                    WHERE i.id = ?
                `, [order.invoice_id]);
                invoice = invRows[0] || null;
            }

            if (invoice && (!invoice.items || invoice.items.length === 0)) {
                const [invItems] = await connection.query(
                    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
                    [invoice.id]
                );
                if (invItems.length > 0) {
                    invoice.items = invItems;
                }
            }

            // 4. Register payments in cashier's active shift (if shift_id provided)
            if (payload.shift_id !== undefined && payload.shift_id !== null) {
                const shiftId = payload.shift_id;
                const payments = Array.isArray(payload.payments) ? payload.payments : [];

                for (const payment of payments) {
                    const amount = Number(payment.amount || 0);
                    if (amount <= 0) continue;
                    const method = payment.method || 'cash';
                    const shiftPaymentId = crypto.randomUUID();

                    await connection.query(
                        `INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type)
                         VALUES (?, ?, ?, ?, ?, 'sale')
                         ON DUPLICATE KEY UPDATE amount = amount + VALUES(amount)`,
                        [shiftPaymentId, shiftId, orderId, method, amount]
                    );

                    await this.auditService.log({
                        user_id: userId,
                        action: 'ADD_SHIFT_PAYMENT',
                        entity_type: 'shift_payment',
                        entity_id: shiftPaymentId,
                        new_values: {
                            shift_id: shiftId,
                            order_id: orderId,
                            payment_method: method,
                            amount,
                            type: 'sale'
                        }
                    }, connection);
                }

                const shiftSummary = await this.calculateShiftExpectedBalance(connection, shiftId);
                await connection.query(
                    'UPDATE cash_shifts SET expected_balance = ? WHERE id = ?',
                    [shiftSummary.expected_balance, shiftId]
                );
            }

            const [updatedOrders] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
            const [updatedInvoices] = invoice?.id
                ? await connection.query('SELECT * FROM invoices WHERE id = ?', [invoice.id])
                : [[]];

            const invoiceSnapshot = invoice?.id
                ? {
                    ...invoice,
                    ...(updatedInvoices[0] || {}),
                    items: invoice.items ?? updatedInvoices[0]?.items ?? []
                }
                : invoice;
            const response = {
                order: updatedOrders[0] || order,
                invoice: invoiceSnapshot
            };

            await connection.commit();

            return response;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new PickupOrderCheckoutUseCase();
