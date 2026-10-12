import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';
import financeService from './finance.service.js';
import accountingService from './accounting.service.js';
import invoiceAuthorizationUseCase from '../domains/sales/InvoiceAuthorizationUseCase.js';
import createOrderUseCase from '../domains/sales/CreateOrderUseCase.js';
import stockLedger from '../domains/inventory/StockLedger.js';
import { lineAmounts } from '../utils/vatMath.js';
import dispatchOrderUseCase from '../domains/sales/DispatchOrderUseCase.js';
import deliverOrderUseCase from '../domains/sales/DeliverOrderUseCase.js';

class SalesService extends BaseService {
    constructor() {
        super('orders');
        dispatchOrderUseCase.normalizeOrderStatus = this._normalizeOrderStatus.bind(this);
        dispatchOrderUseCase.assertOrderTransition = this._assertOrderTransition.bind(this);
        deliverOrderUseCase.assertOrderTransition = this._assertOrderTransition.bind(this);
    }

    _sanitizeOrdersSortColumn(columnName) {
        const allowed = new Set([
            'created_at',
            'updated_at',
            'status',
            'total_amount',
            'customer_name'
        ]);
        const normalized = String(columnName || 'created_at').trim().toLowerCase();
        if (!allowed.has(normalized)) return 'created_at';
        return normalized;
    }

    _buildOrderTransitionError(currentStatus, nextStatus) {
        const err = new Error(`Transicion de estado invalida: ${currentStatus} -> ${nextStatus}`);
        err.statusCode = 409;
        err.status = 'fail';
        err.errorCode = 'INVALID_ORDER_TRANSITION';
        return err;
    }

    _normalizeOrderStatus(status) {
        const raw = String(status || '').trim().toLowerCase();
        const alias = {
            confirmed: 'picking',
            paid: 'packed'
        };
        return alias[raw] || raw;
    }

    _buildStockInvariantError(productId, where) {
        const err = new Error(
            `El stock del producto ${productId} (${where}) no coincide con sus reservas; ` +
            'revisá el inventario (conteo) antes de continuar.'
        );
        err.statusCode = 409;
        err.status = 'fail';
        err.errorCode = 'STOCK_INVARIANT_VIOLATION';
        return err;
    }

    _canTransitionOrder(currentStatus, nextStatus) {
        if (currentStatus === nextStatus) return true;

        const transitions = {
            pending: ['picking', 'cancelled'],
            picking: ['packed', 'cancelled'],
            packed: ['dispatched', 'delivered', 'cancelled'],
            dispatched: ['delivered', 'cancelled'],
            delivered: ['completed', 'returned'],
            completed: ['returned'],
            cancelled: [],
            returned: []
        };

        const allowed = transitions[currentStatus] || [];
        return allowed.includes(nextStatus);
    }

    _assertOrderTransition(currentStatus, nextStatus) {
        const current = this._normalizeOrderStatus(currentStatus);
        const next = this._normalizeOrderStatus(nextStatus);
        if (!this._canTransitionOrder(current, next)) {
            throw this._buildOrderTransitionError(current, next);
        }
        return next;
    }

    _buildStockError(productId, productName, requestedQty, availableQty) {
        const name = productName || productId;
        const err = new Error(`Stock insuficiente para ${name}. Disponible: ${availableQty}, solicitado: ${requestedQty}`);
        err.statusCode = 409;
        err.status = 'fail';
        err.errorCode = 'INSUFFICIENT_STOCK';
        return err;
    }

    async _decreaseInventoryForOrder(connection, payload) {
        return createOrderUseCase._decreaseInventoryForOrder(connection, payload);
    }

    async _restoreInventoryForCancelledOrder(connection, orderId, originalStatus = 'pending') {
        const statusStr = String(originalStatus || '').trim().toLowerCase();
        
        // If order was already packed or dispatched, it had physical stock deductions, so we restore physically
        if (['packed', 'dispatched', 'completed', 'delivered'].includes(statusStr)) {
            const [deductionMovements] = await connection.query(
                `SELECT product_id, from_location, quantity, unit_cost
                 FROM inventory_movements
                 WHERE reference_type = 'order'
                   AND reference_id = ?
                   AND type = 'sale'
                 FOR UPDATE`,
                [orderId]
            );

            if (deductionMovements.length > 0) {
                for (const m of deductionMovements) {
                    const quantity = Number(m.quantity || 0);
                    if (quantity <= 0) continue;
                    await connection.query(
                        `INSERT INTO inventory (id, product_id, location, quantity)
                         VALUES (?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                        [crypto.randomUUID(), m.product_id, m.from_location || 'General', quantity]
                    );

                    await connection.query(
                        `INSERT INTO inventory_movements (
                            id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id
                        ) VALUES (?, 'restock', ?, ?, ?, ?, ?, 'order', ?)`,
                        [
                            crypto.randomUUID(),
                            m.product_id,
                            m.from_location || 'General',
                            quantity,
                            Number(m.unit_cost || 0),
                            'Order cancellation restock',
                            orderId
                        ]
                    );
                }
            }
        } else {
            // Check if exact allocations exist for this order
            const [allocations] = await connection.query(
                `SELECT id, product_id, inventory_id, reserved_quantity
                 FROM order_item_allocations
                 WHERE order_id = ? AND status = 'reserved'
                 FOR UPDATE`,
                [orderId]
            );

            if (allocations.length > 0) {
                for (const alloc of allocations) {
                    const [release] = await connection.query(
                        'UPDATE inventory SET reserved_quantity = reserved_quantity - ? WHERE id = ? AND reserved_quantity >= ?',
                        [alloc.reserved_quantity, alloc.inventory_id, alloc.reserved_quantity]
                    );
                    if (Number(release?.affectedRows) !== 1) {
                        throw this._buildStockInvariantError(alloc.product_id, alloc.inventory_id);
                    }
                    await connection.query(
                        "UPDATE order_item_allocations SET status = 'cancelled' WHERE id = ?",
                        [alloc.id]
                    );
                }
            } else {
                // Legacy fallback: release by product reservation
                const [orderItems] = await connection.query(
                    'SELECT product_id, quantity FROM order_items WHERE order_id = ? FOR UPDATE',
                    [orderId]
                );
                for (const item of orderItems) {
                    let remainingRelease = Number(item.quantity || 0);
                    const [reserveRows] = await connection.query(
                        `SELECT id, reserved_quantity 
                         FROM inventory 
                         WHERE product_id = ? AND reserved_quantity > 0 
                         ORDER BY reserved_quantity DESC 
                         FOR UPDATE`,
                        [item.product_id]
                    );

                    for (const r of reserveRows) {
                        if (remainingRelease <= 0) break;
                        const release = Math.min(Number(r.reserved_quantity || 0), remainingRelease);
                        await connection.query(
                            'UPDATE inventory SET reserved_quantity = reserved_quantity - ? WHERE id = ?',
                            [release, r.id]
                        );
                        remainingRelease -= release;
                    }
                    // A reservation that no longer exists is not released from another row.
                }
            }
        }
    }

    async createOrder(orderData, userId, actor = null) {
        return createOrderUseCase.execute(orderData, userId, actor);
    }

    /**
     * Applies a status reported by an external channel (Tiendanube) through the real
     * transitions, so every step has its stock effect. Never moves an order backwards.
     * cancelled -> releases or restocks; delivered/completed -> the goods left, so the
     * reservation is consumed as fully picked. Remote 'packed' is ignored: packing is local.
     */
    async applyExternalStatus(orderId, externalStatus, userId = null) {
        if (!['cancelled', 'dispatched', 'delivered', 'completed'].includes(externalStatus)) return null;
        const order = await this.findById(orderId);
        if (!order) return null;
        let current = this._normalizeOrderStatus(order.status);

        if (externalStatus === 'cancelled') {
            if (!['pending', 'picking', 'packed', 'dispatched'].includes(current)) return order;
            return this.transitionOrderStatus(orderId, 'cancelled', userId);
        }

        const steps = [];
        if (current === 'pending') steps.push('picking');
        if (['pending', 'picking'].includes(current)) steps.push('packed');
        if (externalStatus === 'dispatched') {
            if (['pending', 'picking', 'packed'].includes(current)) steps.push('dispatched');
        } else {
            if (['pending', 'picking', 'packed', 'dispatched'].includes(current)) steps.push('delivered');
            if (externalStatus === 'completed' && current !== 'completed') steps.push('completed');
        }

        let updated = order;
        for (const step of steps) {
            updated = await this.transitionOrderStatus(orderId, step, userId, { assumeFullyPicked: step === 'packed' });
            current = step;
        }
        return updated;
    }

    async transitionOrderStatus(orderId, requestedStatus, userId, { assumeFullyPicked = false } = {}) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [orders] = await connection.query(
                'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [orderId]
            );
            if (orders.length === 0) {
                const err = new Error('Order not found');
                err.statusCode = 404;
                err.status = 'fail';
                err.errorCode = 'ORDER_NOT_FOUND';
                throw err;
            }

            const order = orders[0];
            const nextStatus = this._assertOrderTransition(order.status, requestedStatus);
            if (this._normalizeOrderStatus(order.status) === nextStatus) {
                await connection.commit();
                return order;
            }

            if (nextStatus === 'packed' && assumeFullyPicked) {
                // The goods already left through another channel: treat every reserved
                // unit as picked so packing deducts it instead of releasing it as shortage.
                await connection.query('UPDATE order_items SET picked_quantity = quantity WHERE order_id = ?', [orderId]);
                await connection.query(
                    "UPDATE order_item_allocations SET picked_quantity = reserved_quantity WHERE order_id = ? AND status = 'reserved'",
                    [orderId]
                );
            }

            let cancellationCreditAmount = 0;
            if (nextStatus === 'cancelled') {
                if (order.invoice_id) {
                    const err = new Error('El pedido ya está facturado. Debe anularse mediante una nota de crédito para conservar la trazabilidad fiscal.');
                    err.statusCode = 409;
                    err.status = 'fail';
                    err.errorCode = 'INVOICED_ORDER_REQUIRES_CREDIT_NOTE';
                    throw err;
                }
                const [paymentRows] = await connection.query(
                    `SELECT COALESCE(SUM(amount), 0) AS paid_amount
                     FROM transactions
                     WHERE reference_id = ? AND type = 'sale'`,
                    [orderId]
                );
                cancellationCreditAmount = this._roundMoney(paymentRows[0]?.paid_amount || 0);
                await this._restoreInventoryForCancelledOrder(connection, orderId, order.status);
            }

            // Automate WMS picking session management
            if (nextStatus === 'picking') {
                const [sessions] = await connection.query(
                    'SELECT id FROM picking_sessions WHERE order_id = ? AND status = "in_progress" LIMIT 1',
                    [orderId]
                );
                if (sessions.length === 0) {
                    const [countRows] = await connection.query(
                        'SELECT COALESCE(SUM(quantity), 0) AS total_items FROM order_items WHERE order_id = ?',
                        [orderId]
                    );
                    const totalItems = countRows[0]?.total_items || 0;
                    const sessionId = crypto.randomUUID();
                    await connection.query(
                        `INSERT INTO picking_sessions (id, order_id, picker_id, status, total_items_requested, total_items_picked, started_at)
                         VALUES (?, ?, ?, 'in_progress', ?, 0, CURRENT_TIMESTAMP)`,
                        [sessionId, orderId, userId || 'unknown_picker', totalItems]
                    );
                }
            } else if (nextStatus === 'packed') {
                const [countRows] = await connection.query(
                    'SELECT COALESCE(SUM(quantity), 0) AS total_items, COALESCE(SUM(picked_quantity), 0) AS total_picked FROM order_items WHERE order_id = ?',
                    [orderId]
                );
                const totalItems = Number(countRows[0]?.total_items || 0);
                const totalPicked = Number(countRows[0]?.total_picked || 0);
                const hasShortage = totalPicked < totalItems;

                await connection.query(
                    `UPDATE picking_sessions 
                     SET status = 'completed', completed_at = CURRENT_TIMESTAMP, total_items_picked = ?, completed_with_shortage = ?
                     WHERE order_id = ? AND status = 'in_progress'`,
                    [totalPicked, hasShortage, orderId]
                );

                // 1. Check if exact allocations exist for this order
                const [allocations] = await connection.query(
                    `SELECT oia.*
                     FROM order_item_allocations oia
                     WHERE oia.order_id = ? AND oia.status = 'reserved'
                     FOR UPDATE`,
                    [orderId]
                );

                if (allocations.length > 0) {
                    const allocationCosts = await accountingService.productUnitCosts(connection, allocations.map((alloc) => alloc.product_id));
                    for (const alloc of allocations) {
                        const reserved = Number(alloc.reserved_quantity || 0);
                        const picked = Math.min(reserved, Math.max(Number(alloc.picked_quantity || 0), 0));

                        // Release the reservation and deduct what was picked in one conditional
                        // update: never clamp, never leave quantity below other orders' reservations.
                        const [stockUpdate] = await connection.query(
                            `UPDATE inventory
                             SET reserved_quantity = reserved_quantity - ?, quantity = quantity - ?
                             WHERE id = ? AND reserved_quantity >= ? AND quantity - ? >= reserved_quantity - ?`,
                            [reserved, picked, alloc.inventory_id, reserved, picked, reserved]
                        );
                        if (Number(stockUpdate?.affectedRows) !== 1) {
                            throw this._buildStockInvariantError(alloc.product_id, alloc.location_code);
                        }

                        if (picked > 0) {
                            await connection.query(
                                `INSERT INTO inventory_movements (
                                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                                ) VALUES (?, 'sale', ?, ?, ?, ?, 'Order stock deduction (allocated)', 'order', ?)`,
                                [crypto.randomUUID(), alloc.product_id, alloc.location_code || 'General', picked, allocationCosts.get(alloc.product_id) || 0, orderId]
                            );
                        }

                        await connection.query(
                            "UPDATE order_item_allocations SET status = 'picked', picked_quantity = ?, shortage_quantity = ? WHERE id = ?",
                            [picked, Math.max(0, reserved - picked), alloc.id]
                        );
                    }
                } else {
                    // Legacy fallback: release reservations & deduct physical stock
                    const [orderItems] = await connection.query(
                        'SELECT product_id, quantity, picked_quantity FROM order_items WHERE order_id = ?',
                        [orderId]
                    );

                    for (const item of orderItems) {
                        const reqQty = Number(item.quantity || 0);
                        const pickQty = Number(item.picked_quantity || 0);
                        
                        if (reqQty <= 0) continue;

                        let remainingRelease = reqQty;
                        const [reserveRows] = await connection.query(
                            `SELECT id, location, reserved_quantity 
                             FROM inventory 
                             WHERE product_id = ? AND reserved_quantity > 0 
                             ORDER BY reserved_quantity DESC 
                             FOR UPDATE`,
                            [item.product_id]
                        );

                        for (const r of reserveRows) {
                            if (remainingRelease <= 0) break;
                            const release = Math.min(Number(r.reserved_quantity || 0), remainingRelease);
                            await connection.query(
                                'UPDATE inventory SET reserved_quantity = reserved_quantity - ? WHERE id = ?',
                                [release, r.id]
                            );
                            remainingRelease -= release;
                        }
                        // A reservation that no longer exists is not "released" from some other
                        // row: that would free stock reserved by other orders.

                        // Deduct what was picked from unreserved stock, never below zero.
                        if (pickQty > 0) {
                            const lockedRows = await stockLedger.lockSellableRows(connection, [item.product_id]);
                            await stockLedger.consumeAvailable(connection, lockedRows.get(item.product_id) || [], {
                                productId: item.product_id,
                                productName: item.product_id,
                                quantity: pickQty,
                                orderId,
                                userId,
                                reason: 'Order stock deduction',
                                unitCost: (await accountingService.productUnitCosts(connection, [item.product_id])).get(item.product_id) || 0
                            });
                        }
                    }
                }
            }

            if (nextStatus === 'cancelled') {
                await connection.query(
                    `UPDATE orders
                     SET status = 'cancelled', payment_status = ?
                     WHERE id = ? AND deleted_at IS NULL`,
                    [cancellationCreditAmount > 0 ? 'credit_balance' : 'voided', orderId]
                );
            } else {
                await connection.query(
                    'UPDATE orders SET status = ? WHERE id = ? AND deleted_at IS NULL',
                    [nextStatus, orderId]
                );
            }
            const [updated] = await connection.query(
                'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL',
                [orderId]
            );

            await auditService.log({
                user_id: userId,
                action: 'UPDATE_ORDER_STATUS',
                entity_type: 'order',
                entity_id: orderId,
                old_values: { status: order.status },
                new_values: { status: nextStatus }
            }, connection);
            await connection.commit();
            return nextStatus === 'cancelled'
                ? {
                    ...updated[0],
                    cancellation_credit_amount: cancellationCreditAmount,
                    cancellation_financial_status: cancellationCreditAmount > 0 ? 'client_credit' : 'debt_voided'
                }
                : updated[0];
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getOrders(filters = {}, options = {}) {
        let filteredQuery = `
            SELECT o.*, c.name AS client_name
            FROM orders o
            LEFT JOIN clients c ON o.client_id = c.id
            WHERE (o.deleted_at IS NULL)
        `;
        const filterParams = [];

        if (filters.client_id) {
            filteredQuery += ' AND o.client_id = ?';
            filterParams.push(filters.client_id);
        }
        if (filters.status) {
            filteredQuery += ' AND o.status = ?';
            filterParams.push(filters.status);
        }

        let total = null;
        if (options.includeTotal) {
            const countQuery = `SELECT COUNT(*) AS total FROM (${filteredQuery}) AS filtered_orders`;
            const [countRows] = await pool.query(countQuery, filterParams);
            total = Number(countRows[0]?.total || 0);
        }

        const orderBy = this._sanitizeOrdersSortColumn(options.orderBy);
        const orderDir = options.order === 'ASC' ? 'ASC' : 'DESC';
        let query = `${filteredQuery} ORDER BY o.${orderBy} ${orderDir}`;
        const queryParams = [...filterParams];

        if (options.limit != null) {
            query += ' LIMIT ?';
            queryParams.push(Number(options.limit));
            if (options.offset != null) {
                query += ' OFFSET ?';
                queryParams.push(Number(options.offset));
            }
        }

        const [orders] = await pool.query(query, queryParams);
        if (orders.length === 0) {
            if (options.includeTotal) {
                return { rows: [], total: total ?? 0 };
            }
            return [];
        }

        const orderIds = orders.map((o) => o.id);
        const [items] = await pool.query(`
            SELECT oi.*, p.name AS product_name, p.sku, p.location, p.barcode, p.vat_rate
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id IN (?)
        `, [orderIds]);
        const [paymentRows] = await pool.query(`
            SELECT id, order_id, payment_method AS method, amount
            FROM order_payments
            WHERE order_id IN (?)
            ORDER BY created_at ASC
        `, [orderIds]);

        const rows = orders.map((o) => ({
            ...o,
            items: items.filter((i) => i.order_id === o.id),
            payments: paymentRows.filter((payment) => payment.order_id === o.id).map((payment) => ({
                id: payment.id,
                method: payment.method,
                amount: Number(payment.amount || 0)
            }))
        }));

        if (options.includeTotal) {
            return { rows, total: total ?? rows.length };
        }

        return rows;
    }

    async dispatchOrder(orderId, data, userId) {
        return dispatchOrderUseCase.execute(orderId, data, userId);
    }

    async deliverOrder(orderId, data, userId) {
        return deliverOrderUseCase.execute(orderId, data, userId);
    }

    async pickOrderItem(itemId, pickedQuantity, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [items] = await connection.query('SELECT * FROM order_items WHERE id = ? FOR UPDATE', [itemId]);
            if (items.length === 0) throw new Error('Order item not found');

            const item = items[0];
            const safeQty = Math.max(0, Math.min(Number(pickedQuantity || 0), Number(item.quantity)));
            await connection.query('UPDATE order_items SET picked_quantity = ? WHERE id = ?', [safeQty, itemId]);

            const [allocs] = await connection.query(
                'SELECT * FROM order_item_allocations WHERE order_item_id = ? FOR UPDATE',
                [itemId]
            );
            let firstAllocId = null;
            if (allocs.length > 0) {
                firstAllocId = allocs[0].id;
                let remainingPick = safeQty;
                for (const alloc of allocs) {
                    const thisPick = Math.min(Number(alloc.reserved_quantity || 0), remainingPick);
                    const thisShortage = Math.max(0, Number(alloc.reserved_quantity || 0) - thisPick);
                    await connection.query(
                        'UPDATE order_item_allocations SET picked_quantity = ?, shortage_quantity = ? WHERE id = ?',
                        [thisPick, thisShortage, alloc.id]
                    );
                    remainingPick -= thisPick;
                }
            }

            const [sessions] = await connection.query(
                'SELECT id FROM picking_sessions WHERE order_id = ? AND status = "in_progress" LIMIT 1 FOR UPDATE',
                [item.order_id]
            );
            if (sessions.length > 0) {
                await connection.query(
                    `INSERT INTO picking_session_events (id, session_id, product_id, order_item_id, allocation_id, picker_id, action_type, location_code, quantity)
                     VALUES (?, ?, ?, ?, ?, ?, 'quantity_confirmed', ?, ?)`,
                    [crypto.randomUUID(), sessions[0].id, item.product_id, itemId, firstAllocId, userId || null, item.location || 'General', safeQty]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'PICK_ORDER_ITEM',
                entity_type: 'order_item',
                entity_id: itemId,
                old_values: { picked_quantity: Number(item.picked_quantity || 0) },
                new_values: { picked_quantity: safeQty }
            }, connection);

            const [updatedRows] = await connection.query('SELECT * FROM order_items WHERE id = ?', [itemId]);
            await connection.commit();
            return updatedRows[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async recordPickingEvent(orderId, eventData, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [sessions] = await connection.query(
                'SELECT id FROM picking_sessions WHERE order_id = ? AND status = "in_progress" LIMIT 1 FOR UPDATE',
                [orderId]
            );
            let sessionId;
            if (sessions.length === 0) {
                sessionId = crypto.randomUUID();
                const [countRows] = await connection.query(
                    'SELECT COALESCE(SUM(quantity), 0) AS total_items FROM order_items WHERE order_id = ?',
                    [orderId]
                );
                const totalItems = countRows[0]?.total_items || 0;
                await connection.query(
                    `INSERT INTO picking_sessions (id, order_id, picker_id, status, total_items_requested, total_items_picked, started_at)
                     VALUES (?, ?, ?, 'in_progress', ?, 0, CURRENT_TIMESTAMP)`,
                    [sessionId, orderId, userId || 'unknown_picker', totalItems]
                );
            } else {
                sessionId = sessions[0].id;
            }

            const eventId = crypto.randomUUID();
            await connection.query(
                `INSERT INTO picking_session_events (id, session_id, product_id, action_type, location_code, barcode_scanned, quantity)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    eventId,
                    sessionId,
                    eventData.product_id,
                    eventData.action_type,
                    eventData.location_code || null,
                    eventData.barcode_scanned || null,
                    eventData.quantity || 0
                ]
            );
            await connection.commit();
            return { success: true, event_id: eventId, session_id: sessionId };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async getOrderSummary(orderId) {
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) throw new Error('Order not found');

        const [items] = await pool.query(`
            SELECT oi.*, p.name AS product_name, p.sku, p.location, p.barcode, p.vat_rate
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ?
        `, [orderId]);
        const [payments] = await pool.query(
            'SELECT id, payment_method AS method, amount FROM order_payments WHERE order_id = ? ORDER BY created_at ASC',
            [orderId]
        );
        const totalItems = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
        const totalPicked = items.reduce((sum, i) => sum + Number(i.picked_quantity || 0), 0);

        const [sessions] = await pool.query(
            `SELECT ps.*, u.name AS picker_name 
             FROM picking_sessions ps 
             LEFT JOIN users u ON ps.picker_id = u.id 
             WHERE ps.order_id = ? 
             ORDER BY ps.started_at DESC LIMIT 1`,
            [orderId]
        );

        const [allocations] = await pool.query(
            `SELECT oia.*, inv.location AS inventory_location
             FROM order_item_allocations oia
             LEFT JOIN inventory inv ON inv.id = oia.inventory_id
             WHERE oia.order_id = ?
             ORDER BY oia.location_code ASC`,
            [orderId]
        );

        return {
            order: { ...orders[0], payments: payments.map((payment) => ({ ...payment, amount: Number(payment.amount || 0) })) },
            items,
            allocations,
            summary: {
                total_items: totalItems,
                total_picked: totalPicked,
                completion_percent: totalItems > 0 ? Math.round((totalPicked / totalItems) * 100) : 0
            },
            picking_session: sessions[0] || null
        };
    }

    async _nextInvoiceNumber(connection, invoiceType = 'B', pointOfSale = 1) {
        const [rows] = await connection.query(
            `SELECT MAX(invoice_number) AS max_number
             FROM invoices
             WHERE invoice_type = ? AND point_of_sale = ?`,
            [invoiceType, pointOfSale]
        );
        const maxExisting = Number(rows[0]?.max_number || 0);
        const scope = `invoice:${String(invoiceType).toUpperCase()}:${Number(pointOfSale)}`;
        return nextDocumentSequence(connection, scope, maxExisting);
    }

    async _resolveClientSnapshot(connection, clientId, fallbackName = 'Consumidor Final') {
        if (clientId) {
            const [clients] = await connection.query(
                'SELECT id, name, tax_id, address FROM clients WHERE id = ? LIMIT 1',
                [clientId]
            );
            if (clients.length > 0) {
                return {
                    client_id: clients[0].id,
                    client_name: clients[0].name,
                    client_tax_id: clients[0].tax_id || null,
                    client_address: clients[0].address || null,
                    client_tax_condition: 'Consumidor Final'
                };
            }
        }

        return {
            client_id: null,
            client_name: fallbackName || 'Consumidor Final',
            client_tax_id: null,
            client_address: null,
            client_tax_condition: 'Consumidor Final'
        };
    }

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

            return { method, amount, ...(payment?.check ? { check: payment.check } : {}) };
        });
    }

    _normalizePayments(payments, totalAmount, fallbackMethod = 'cash') {
        const safeTotal = this._roundMoney(totalAmount);
        const source = Array.isArray(payments) && payments.length > 0
            ? payments
            : (safeTotal > 0 ? [{ method: fallbackMethod, amount: safeTotal }] : []);

        const normalizedPayments = source.map((payment, index) => {
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

            return { method, amount, ...(payment?.check ? { check: payment.check } : {}) };
        });

        const paidAmount = this._roundMoney(
            normalizedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        );

        if (paidAmount > safeTotal + 0.01) {
            throw this._buildValidationError(
                `El total de pagos (${paidAmount}) supera el total de la factura (${safeTotal})`,
                'PAYMENTS_EXCEED_TOTAL'
            );
        }

        return {
            payments: normalizedPayments,
            paidAmount,
            paymentStatus: this._resolvePaymentStatus(safeTotal, paidAmount),
            primaryMethod: normalizedPayments[0]?.method || String(fallbackMethod || 'cash')
        };
    }

    async _transferOrderReceivablePayments(connection, { orderId, invoiceId, invoiceLabel, totalAmount }) {
        if (!orderId) return 0;
        const [paymentRows] = await connection.query(
            `SELECT COALESCE(SUM(amount), 0) AS paid_amount
             FROM transactions
             WHERE reference_id = ? AND type = 'sale'`,
            [orderId]
        );
        const paidAmount = this._roundMoney(paymentRows[0]?.paid_amount || 0);
        if (paidAmount <= 0) return 0;
        if (paidAmount > this._roundMoney(totalAmount) + 0.01) {
            throw this._buildValidationError(
                'Los cobros anticipados del pedido superan el total de la factura. Revise importes antes de facturar.',
                'ORDER_PAYMENTS_EXCEED_INVOICE'
            );
        }

        await connection.query(
            `UPDATE transactions
             SET reference_id = ?, description = REPLACE(description, 'venta pedido', 'factura')
             WHERE reference_id = ? AND type = 'sale'`,
            [invoiceId, orderId]
        );
        await connection.query(
            `UPDATE customer_check_allocations cca
             JOIN transactions t ON t.id = cca.transaction_id
             SET cca.invoice_id = ?
             WHERE t.reference_id = ? AND cca.invoice_id IS NULL`,
            [invoiceId, invoiceId]
        );
        await accountingService.createJournalEntry(connection, {
            date: new Date(),
            description: `Aplicación de anticipos a factura ${invoiceLabel}`,
            reference_type: 'invoice',
            reference_id: invoiceId,
            lines: [
                { account_code: '2.1.03.01', debit: paidAmount, credit: 0, notes: 'Cancelación de anticipos de clientes' },
                { account_code: '1.1.03.01', debit: 0, credit: paidAmount, notes: `Aplicación a factura ${invoiceLabel}` }
            ]
        });
        return paidAmount;
    }



    async createInvoice(orderId, invoiceData, userId, existingConnection = null) {
        const connection = existingConnection || await pool.getConnection();
        const isExternalTx = Boolean(existingConnection);
        try {
            if (!isExternalTx) await connection.beginTransaction();

            const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
            if (orders.length === 0) throw new Error('Order not found');
            const order = orders[0];

            if (order.invoice_id) throw new Error('Order already invoiced');

            const [items] = await connection.query(`
                SELECT oi.*, p.name AS product_name, p.sku, p.vat_rate
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [orderId]);
            if (items.length === 0) throw new Error('Order has no items');

            let netAmount = 0;
            let vatAmount = 0;
            const invoiceItems = items
                .map((item) => {
                    const qty = Number(item.picked_quantity || 0) > 0 ? Number(item.picked_quantity) : Number(item.quantity);
                    const vatRate = item.vat_rate != null ? Number(item.vat_rate) : 21.00;
                    const unitPrice = Number(item.unit_price || 0);

                    // ADR-015: gross first, so the invoice charges exactly what the order showed.
                    const { net: lineNet, vat: lineVat, gross: lineTotal } = lineAmounts(qty, unitPrice, vatRate);

                    netAmount += lineNet;
                    vatAmount += lineVat;

                    return {
                        product_id: item.product_id,
                        product_name: item.product_name,
                        sku: item.sku,
                        quantity: qty,
                        unit_price: unitPrice,
                        vat_rate: vatRate,
                        vat_amount: lineVat,
                        total_line: lineTotal
                    };
                })
                .filter((item) => item.quantity > 0);

            if (invoiceItems.length === 0) throw new Error('No picked items found');

            netAmount = this._roundMoney(netAmount);
            vatAmount = this._roundMoney(vatAmount);
            const totalAmount = this._roundMoney(netAmount + vatAmount);

            const invoiceType = invoiceData.invoice_type || 'B';
            let pointOfSale = Number(invoiceData.point_of_sale);
            if (!pointOfSale || isNaN(pointOfSale)) {
                const [compRows] = await connection.query('SELECT billing_pos FROM company_settings LIMIT 1');
                pointOfSale = compRows[0]?.billing_pos ? Number(compRows[0].billing_pos) : 1;
            }
            const invoiceNumber = await this._nextInvoiceNumber(connection, invoiceType, pointOfSale);
            const invoiceId = crypto.randomUUID();

            const client = await this._resolveClientSnapshot(connection, order.client_id, order.customer_name);
            const [plannedPaymentRows] = await connection.query(
                'SELECT payment_method AS method, amount, check_payload FROM order_payments WHERE order_id = ? ORDER BY created_at ASC',
                [orderId]
            );
            const plannedPayments = plannedPaymentRows
                .filter((payment) => payment.method !== 'credit_account')
                .map((payment) => ({
                    method: payment.method,
                    amount: Number(payment.amount || 0),
                    ...(payment.check_payload ? { check: typeof payment.check_payload === 'string' ? JSON.parse(payment.check_payload) : payment.check_payload } : {})
                }));
            const paymentSource = Array.isArray(invoiceData.payments) && invoiceData.payments.length > 0
                ? invoiceData.payments
                : plannedPayments;
            const hasExplicitPayments = paymentSource.length > 0;
            const paymentData = hasExplicitPayments
                ? this._normalizePayments(
                    paymentSource,
                    totalAmount,
                    order.payment_method || 'cash'
                )
                : {
                    payments: [],
                    paidAmount: 0,
                    paymentStatus: 'pending',
                    primaryMethod: null
                };
            const paymentMethod = paymentData.primaryMethod || null;
            const invoiceLabel = `${invoiceType}-${String(pointOfSale).padStart(4, '0')}-${String(invoiceNumber).padStart(8, '0')}`;

            await connection.query(`
                INSERT INTO invoices (
                    id, order_id, client_id, client_name, client_tax_id, client_address, client_tax_condition,
                    invoice_type, point_of_sale, invoice_number,
                    net_amount, vat_amount, exempt_amount, total_amount, status, notes, created_by,
                    customer_name, subtotal, tax_amount, payment_method, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'issued', ?, ?, ?, ?, ?, ?, ?)
            `, [
                invoiceId,
                order.id,
                client.client_id,
                client.client_name,
                client.client_tax_id,
                client.client_address,
                client.client_tax_condition,
                invoiceType,
                pointOfSale,
                invoiceNumber,
                netAmount,
                vatAmount,
                totalAmount,
                invoiceData.notes || null,
                userId || invoiceData.created_by || null,
                order.customer_name || client.client_name,
                netAmount,
                vatAmount,
                paymentMethod,
                paymentData.paymentStatus
            ]);

            for (const item of invoiceItems) {
                await connection.query(`
                    INSERT INTO invoice_items (
                        id, invoice_id, product_id, description, quantity, unit_price,
                        discount_percentage, vat_rate, vat_amount, total_line, product_name, sku
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    invoiceId,
                    item.product_id,
                    item.product_name || 'Producto',
                    item.quantity,
                    item.unit_price,
                    item.vat_rate,
                    item.vat_amount,
                    item.total_line,
                    item.product_name || 'Producto',
                    item.sku || null
                ]);
            }

            await accountingService.postInvoiceAccountingEntries(connection, invoiceId);

            const anticipatedAmount = await this._transferOrderReceivablePayments(connection, {
                orderId,
                invoiceId,
                invoiceLabel,
                totalAmount
            });

            await financeService._registerInvoicePayments(connection, {
                invoiceId,
                clientId: client.client_id,
                invoiceLabel,
                payments: paymentData.payments,
                userId
            });

            const totalPaidAmount = this._roundMoney(anticipatedAmount + paymentData.paidAmount);
            const resolvedPaymentStatus = this._resolvePaymentStatus(totalAmount, totalPaidAmount);
            if (anticipatedAmount > 0) {
                await connection.query(
                    'UPDATE invoices SET payment_status = ? WHERE id = ?',
                    [resolvedPaymentStatus, invoiceId]
                );
            }

            if (client.client_id) {
                const outstanding = this._roundMoney(totalAmount - totalPaidAmount);
                if (outstanding > 0) {
                    await connection.query(
                        `UPDATE clients
                         SET current_account_balance = COALESCE(current_account_balance, 0) + ?
                         WHERE id = ?`,
                        [outstanding, client.client_id]
                    );
                }
            }

            // Invoicing only closes a delivered order (counter sales are born completed);
            // any earlier status still has its stock reserved and must go through packing.
            const nextOrderStatus = resolvedPaymentStatus === 'paid' && this._normalizeOrderStatus(order.status) === 'delivered'
                ? 'completed'
                : order.status;
            await connection.query(
                'UPDATE orders SET invoice_id = ?, status = ?, payment_status = ? WHERE id = ?',
                [invoiceId, nextOrderStatus, resolvedPaymentStatus, orderId]
            );

            await auditService.log({
                user_id: userId,
                action: 'GENERATE_INVOICE',
                entity_type: 'invoice',
                entity_id: invoiceId,
                new_values: {
                    orderId,
                    invoiceType,
                    pointOfSale,
                    invoiceNumber,
                    totalAmount,
                    paid_amount: totalPaidAmount,
                    payment_status: resolvedPaymentStatus
                }
            }, connection);

            if (!isExternalTx) await connection.commit();
            return {
                id: invoiceId,
                order_id: order.id,
                client_id: client.client_id,
                client_name: client.client_name || order.customer_name,
                client_tax_id: client.client_tax_id,
                client_address: client.client_address,
                client_tax_condition: client.client_tax_condition,
                invoice_type: invoiceType,
                point_of_sale: pointOfSale,
                invoice_number: invoiceNumber,
                net_amount: netAmount,
                vat_amount: vatAmount,
                exempt_amount: 0,
                total_amount: totalAmount,
                subtotal: netAmount,
                tax_amount: vatAmount,
                status: 'issued',
                issue_date: new Date().toISOString(),
                payment_method: paymentMethod,
                paid_amount: totalPaidAmount,
                payment_status: resolvedPaymentStatus,
                items: invoiceItems
            };
        } catch (err) {
            if (!isExternalTx) await connection.rollback();
            throw err;
        } finally {
            if (!isExternalTx) connection.release();
        }
    }

    async createManualInvoice(invoiceData, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            if (invoiceData.order_id) {
                const [orders] = await connection.query(
                    'SELECT id, invoice_id FROM orders WHERE id = ? FOR UPDATE',
                    [invoiceData.order_id]
                );
                if (orders.length === 0) throw new Error('Order not found');
                if (orders[0].invoice_id) {
                    const [existingInvoices] = await connection.query(
                        'SELECT * FROM invoices WHERE id = ? LIMIT 1',
                        [orders[0].invoice_id]
                    );
                    if (existingInvoices.length > 0) {
                        await connection.commit();
                        return { ...existingInvoices[0], idempotent_replay: true };
                    }
                }
                // Invoicing an order bills what was sold, at the order's prices and the
                // catalog VAT: client-sent items, prices, VAT or discounts are ignored (H4).
                const invoice = await this.createInvoice(invoiceData.order_id, invoiceData, userId, connection);
                await connection.commit();
                return invoice;
            }

            const items = invoiceData.items || [];
            if (items.length === 0) throw new Error('Invoice must contain items');

            const invoiceType = invoiceData.invoice_type || 'B';
            const pointOfSale = Number(invoiceData.point_of_sale || 1);
            const invoiceNumber = await this._nextInvoiceNumber(connection, invoiceType, pointOfSale);
            const invoiceId = crypto.randomUUID();

            const client = await this._resolveClientSnapshot(
                connection,
                invoiceData.client_id,
                invoiceData.customer_name || 'Consumidor Final'
            );

            let netAmount = 0;
            let vatAmount = 0;
            const parsedItems = items.map((item) => {
                const quantity = Number(item.quantity || 0);
                const unitPrice = Number(item.unit_price || 0);
                const discount = Number(item.discount_percentage ?? item.discount ?? 0);
                const vatRate = Number(item.vat_rate ?? 21);

                // ADR-015: gross first (quantity × final price, after discount), VAT = gross − net.
                const { net: base, vat: lineVat, gross: totalLine } = lineAmounts(quantity, unitPrice * (1 - (discount / 100)), vatRate);

                netAmount += base;
                vatAmount += lineVat;

                return {
                    product_id: item.product_id || null,
                    description: item.description || item.product_name || 'Producto',
                    product_name: item.product_name || item.description || 'Producto',
                    sku: item.sku || null,
                    quantity,
                    unit_price: unitPrice,
                    discount_percentage: discount,
                    vat_rate: vatRate,
                    vat_amount: lineVat,
                    total_line: totalLine
                };
            });

            netAmount = this._roundMoney(netAmount);
            vatAmount = this._roundMoney(vatAmount);
            const totalAmount = this._roundMoney(netAmount + vatAmount);
            const collectiblePayments = Array.isArray(invoiceData.payments)
                ? invoiceData.payments.filter((payment) => payment.method !== 'credit_account')
                : [];
            const paymentData = collectiblePayments.length > 0
                ? this._normalizePayments(collectiblePayments, totalAmount, invoiceData.payment_method || 'cash')
                : { payments: [], paidAmount: 0, paymentStatus: 'pending', primaryMethod: invoiceData.payment_method || null };
            const invoiceLabel = `${invoiceType}-${String(pointOfSale).padStart(4, '0')}-${String(invoiceNumber).padStart(8, '0')}`;

            await connection.query(`
                INSERT INTO invoices (
                    id, order_id, client_id, client_name, client_tax_id, client_address, client_tax_condition,
                    invoice_type, point_of_sale, invoice_number,
                    net_amount, vat_amount, exempt_amount, total_amount, status, notes, created_by,
                    customer_name, subtotal, tax_amount, payment_method, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'issued', ?, ?, ?, ?, ?, ?, ?)
            `, [
                invoiceId,
                invoiceData.order_id || null,
                client.client_id,
                client.client_name,
                client.client_tax_id,
                client.client_address,
                client.client_tax_condition,
                invoiceType,
                pointOfSale,
                invoiceNumber,
                netAmount,
                vatAmount,
                totalAmount,
                invoiceData.notes || null,
                userId || invoiceData.created_by || null,
                invoiceData.customer_name || client.client_name,
                netAmount,
                vatAmount,
                paymentData.primaryMethod,
                paymentData.paymentStatus
            ]);

            for (const item of parsedItems) {
                await connection.query(`
                    INSERT INTO invoice_items (
                        id, invoice_id, product_id, description, quantity, unit_price,
                        discount_percentage, vat_rate, vat_amount, total_line, product_name, sku
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    invoiceId,
                    item.product_id,
                    item.description,
                    item.quantity,
                    item.unit_price,
                    item.discount_percentage,
                    item.vat_rate,
                    item.vat_amount,
                    item.total_line,
                    item.product_name,
                    item.sku
                ]);
            }

            await accountingService.postInvoiceAccountingEntries(connection, invoiceId);

            const anticipatedAmount = await this._transferOrderReceivablePayments(connection, {
                orderId: invoiceData.order_id || null,
                invoiceId,
                invoiceLabel,
                totalAmount
            });

            await financeService._registerInvoicePayments(connection, {
                invoiceId,
                clientId: client.client_id,
                invoiceLabel,
                payments: paymentData.payments,
                userId
            });

            const totalPaidAmount = this._roundMoney(anticipatedAmount + paymentData.paidAmount);
            const resolvedPaymentStatus = this._resolvePaymentStatus(totalAmount, totalPaidAmount);
            if (anticipatedAmount > 0) {
                await connection.query('UPDATE invoices SET payment_status = ? WHERE id = ?', [resolvedPaymentStatus, invoiceId]);
            }

            if (client.client_id) {
                const outstanding = this._roundMoney(totalAmount - totalPaidAmount);
                if (outstanding > 0) {
                    await connection.query(
                        `UPDATE clients
                         SET current_account_balance = COALESCE(current_account_balance, 0) + ?
                         WHERE id = ?`,
                        [outstanding, client.client_id]
                    );
                }
            }

            if (invoiceData.order_id) {
                await connection.query(
                    `UPDATE orders
                     SET invoice_id = ?,
                         status = CASE WHEN ? = 'paid' AND status = 'delivered' THEN 'completed' ELSE status END,
                         payment_status = ?
                     WHERE id = ?`,
                    [invoiceId, resolvedPaymentStatus, resolvedPaymentStatus, invoiceData.order_id]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'CREATE_MANUAL_INVOICE',
                entity_type: 'invoice',
                entity_id: invoiceId,
                new_values: {
                    invoiceType,
                    pointOfSale,
                    invoiceNumber,
                    totalAmount,
                    paid_amount: totalPaidAmount,
                    payment_status: resolvedPaymentStatus
                }
            }, connection);

            await connection.commit();
            return {
                id: invoiceId,
                order_id: invoiceData.order_id || null,
                client_id: client.client_id,
                client_name: client.client_name || invoiceData.customer_name,
                client_tax_id: client.client_tax_id,
                client_address: client.client_address,
                client_tax_condition: client.client_tax_condition,
                invoice_type: invoiceType,
                point_of_sale: pointOfSale,
                invoice_number: invoiceNumber,
                net_amount: netAmount,
                vat_amount: vatAmount,
                exempt_amount: 0,
                total_amount: totalAmount,
                subtotal: netAmount,
                tax_amount: vatAmount,
                issue_date: new Date().toISOString(),
                status: 'issued',
                payment_method: paymentData.primaryMethod,
                paid_amount: totalPaidAmount,
                payment_status: resolvedPaymentStatus,
                items: parsedItems
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }



    async authorizeInvoice(invoiceId, userId) {
        return invoiceAuthorizationUseCase.execute(invoiceId, userId);
    }

    async getInvoices(filters = {}) {
        let query = `
            SELECT i.*, c.tax_id AS client_tax_id, c.address AS client_address
            FROM invoices i
            LEFT JOIN clients c ON i.client_id = c.id
            WHERE (i.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND i.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND i.status = ?';
            params.push(filters.status);
        }
        if (filters.start_date) {
            query += ' AND DATE(i.issue_date) >= DATE(?)';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            query += ' AND DATE(i.issue_date) <= DATE(?)';
            params.push(filters.end_date);
        }

        query += ' ORDER BY i.issue_date DESC, i.created_at DESC';

        const [rows] = await pool.query(query, params);
        return rows.map((row) => ({
            ...row,
            client_name: row.client_name || row.customer_name
        }));
    }

    async getInvoiceById(invoiceId) {
        const [rows] = await pool.query(`
            SELECT i.*, c.tax_id AS client_tax_id, c.address AS client_address
            FROM invoices i
            LEFT JOIN clients c ON i.client_id = c.id
            WHERE i.id = ? AND (i.deleted_at IS NULL)
        `, [invoiceId]);
        if (rows.length === 0) return null;
        const invoice = {
            ...rows[0],
            client_name: rows[0].client_name || rows[0].customer_name
        };
        invoice.items = await this.getInvoiceItems(invoiceId);
        return invoice;
    }

    async getInvoiceItems(invoiceId) {
        const [rows] = await pool.query(
            'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
            [invoiceId]
        );
        if (rows.length === 0) {
            const [fallbackRows] = await pool.query(`
                SELECT oi.id, ? AS invoice_id, oi.product_id,
                       COALESCE(p.name, 'Producto') AS description,
                       COALESCE(p.name, 'Producto') AS product_name,
                       p.sku, oi.quantity, oi.unit_price,
                       COALESCE(p.vat_rate, 21) AS vat_rate,
                       ROUND(oi.quantity * oi.unit_price, 2) AS total_line
                FROM invoices i
                JOIN order_items oi ON oi.order_id = i.order_id
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE i.id = ?
                ORDER BY oi.id ASC
            `, [invoiceId, invoiceId]);
            return fallbackRows;
        }
        return rows;
    }

    async getTaxConditions() {
        try {
            const [rows] = await pool.query('SELECT * FROM tax_conditions ORDER BY code ASC');
            return rows;
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [
                    { id: 'tc_RespInscripto', name: 'Responsable Inscripto', code: '01' },
                    { id: 'tc_Monotributo', name: 'Monotributista', code: '06' },
                    { id: 'tc_ConsFinal', name: 'Consumidor Final', code: '05' },
                    { id: 'tc_Exento', name: 'Exento', code: '04' }
                ];
            }
            throw err;
        }
    }
}

export default new SalesService();
