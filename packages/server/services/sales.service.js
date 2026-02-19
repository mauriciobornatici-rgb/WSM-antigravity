import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';

class SalesService extends BaseService {
    constructor() {
        super('orders');
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

    async _decreaseInventoryForOrder(connection, { orderId, productId, productName, quantity }) {
        const requestedQty = Number.parseInt(String(quantity), 10);
        if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
            const err = new Error(`Cantidad invalida para producto ${productName || productId}`);
            err.statusCode = 400;
            err.status = 'fail';
            err.errorCode = 'INVALID_QUANTITY';
            throw err;
        }

        const [stockRows] = await connection.query(
            `SELECT id, location, quantity
             FROM inventory
             WHERE product_id = ? AND quantity > 0
             ORDER BY quantity DESC
             FOR UPDATE`,
            [productId]
        );

        const availableQty = stockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
        if (availableQty < requestedQty) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }

        let remaining = requestedQty;
        for (const row of stockRows) {
            if (remaining <= 0) break;
            const rowQty = Number(row.quantity || 0);
            const consume = Math.min(rowQty, remaining);
            if (consume <= 0) continue;

            await connection.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [consume, row.id]);
            await connection.query(
                `INSERT INTO inventory_movements (
                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                ) VALUES (?, 'sale', ?, ?, ?, ?, ?, 'order', ?)`,
                [
                    crypto.randomUUID(),
                    productId,
                    row.location || 'General',
                    consume,
                    0,
                    'Order stock deduction',
                    orderId
                ]
            );
            remaining -= consume;
        }

        if (remaining > 0) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }
    }

    async _restoreInventoryForCancelledOrder(connection, orderId) {
        const [deductionMovements] = await connection.query(
            `SELECT product_id, from_location, quantity, unit_cost
             FROM inventory_movements
             WHERE reference_type = 'order'
               AND reference_id = ?
               AND type = 'sale'
               AND reason = 'Order stock deduction'
             FOR UPDATE`,
            [orderId]
        );

        const restoreBuckets = new Map();
        const addBucket = (productId, location, quantity, unitCost = 0) => {
            const safeQty = Number.parseInt(String(quantity), 10);
            if (!Number.isFinite(safeQty) || safeQty <= 0) return;
            const safeLocation = location || 'General';
            const key = `${productId}::${safeLocation}`;
            const current = restoreBuckets.get(key) || { productId, location: safeLocation, quantity: 0, unitCost: 0 };
            current.quantity += safeQty;
            current.unitCost = Number(unitCost || 0);
            restoreBuckets.set(key, current);
        };

        if (deductionMovements.length > 0) {
            for (const movement of deductionMovements) {
                addBucket(
                    movement.product_id,
                    movement.from_location,
                    movement.quantity,
                    movement.unit_cost
                );
            }
        } else {
            const [orderItems] = await connection.query(
                'SELECT product_id, quantity FROM order_items WHERE order_id = ? FOR UPDATE',
                [orderId]
            );
            for (const item of orderItems) {
                addBucket(item.product_id, 'General', item.quantity, 0);
            }
        }

        for (const bucket of restoreBuckets.values()) {
            await connection.query(
                `INSERT INTO inventory (id, product_id, location, quantity)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                [crypto.randomUUID(), bucket.productId, bucket.location, bucket.quantity]
            );

            await connection.query(
                `INSERT INTO inventory_movements (
                    id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id
                ) VALUES (?, 'restock', ?, ?, ?, ?, ?, 'order', ?)`,
                [
                    crypto.randomUUID(),
                    bucket.productId,
                    bucket.location,
                    bucket.quantity,
                    Number(bucket.unitCost || 0),
                    'Order cancellation restock',
                    orderId
                ]
            );
        }
    }

    async createOrder(orderData, userId) {
        const orderId = crypto.randomUUID();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const productIds = orderData.items.map((item) => item.product_id);
            const [products] = await connection.query(
                'SELECT id, sale_price, name FROM products WHERE id IN (?)',
                [productIds]
            );
            const priceByProduct = new Map(products.map((p) => [p.id, Number(p.sale_price || 0)]));
            const nameByProduct = new Map(products.map((p) => [p.id, p.name || p.id]));

            for (const item of orderData.items) {
                if (!priceByProduct.has(item.product_id)) {
                    throw new Error(`Producto no encontrado: ${item.product_id}`);
                }
            }

            const computedTotal = orderData.items.reduce(
                (sum, item) => sum + Number(item.quantity) * priceByProduct.get(item.product_id),
                0
            );

            await connection.query(
                `INSERT INTO orders (
                    id, client_id, customer_name, total_amount, status, payment_status, payment_method, shipping_address
                ) VALUES (?, ?, ?, ?, 'pending', 'pending', ?, ?)`,
                [
                    orderId,
                    orderData.client_id || null,
                    orderData.customer_name || null,
                    computedTotal,
                    orderData.payment_method || 'cash',
                    orderData.shipping_address || null
                ]
            );

            for (const item of orderData.items) {
                await this._decreaseInventoryForOrder(connection, {
                    orderId,
                    productId: item.product_id,
                    productName: nameByProduct.get(item.product_id),
                    quantity: item.quantity
                });

                const itemId = crypto.randomUUID();
                const unitPrice = priceByProduct.get(item.product_id);
                await connection.query(
                    'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
                    [itemId, orderId, item.product_id, item.quantity, unitPrice]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'CREATE_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                new_values: {
                    ...orderData,
                    total_amount: computedTotal
                }
            });

            await connection.commit();
            return { id: orderId, total_amount: computedTotal };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async transitionOrderStatus(orderId, requestedStatus) {
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

            if (nextStatus === 'cancelled') {
                await this._restoreInventoryForCancelledOrder(connection, orderId);
            }

            await connection.query(
                'UPDATE orders SET status = ? WHERE id = ? AND deleted_at IS NULL',
                [nextStatus, orderId]
            );
            const [updated] = await connection.query(
                'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL',
                [orderId]
            );

            await connection.commit();
            return updated[0];
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getOrders(filters = {}, options = {}) {
        let query = `
            SELECT o.*, c.name AS client_name
            FROM orders o
            LEFT JOIN clients c ON o.client_id = c.id
            WHERE (o.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND o.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND o.status = ?';
            params.push(filters.status);
        }

        const orderBy = this._sanitizeOrdersSortColumn(options.orderBy);
        const orderDir = options.order === 'ASC' ? 'ASC' : 'DESC';
        query += ` ORDER BY o.${orderBy} ${orderDir}`;

        const [orders] = await pool.query(query, params);
        if (orders.length === 0) return [];

        const orderIds = orders.map((o) => o.id);
        const [items] = await pool.query(`
            SELECT oi.*, p.name AS product_name, p.sku, p.location
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id IN (?)
        `, [orderIds]);

        return orders.map((o) => ({
            ...o,
            items: items.filter((i) => i.order_id === o.id)
        }));
    }

    async dispatchOrder(orderId, data, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
            if (orders.length === 0) throw new Error('Order not found');
            const currentStatus = this._normalizeOrderStatus(orders[0].status);

            const isPickup = data.shipping_method === 'pickup';
            const requestedNextStatus = isPickup ? 'delivered' : 'dispatched';
            const nextStatus = this._assertOrderTransition(currentStatus, requestedNextStatus);

            await connection.query(`
                UPDATE orders
                SET
                    status = ?,
                    shipping_method = ?,
                    tracking_number = ?,
                    estimated_delivery = ?,
                    shipping_address = ?,
                    recipient_name = ?,
                    recipient_dni = ?,
                    dispatched_at = NOW(),
                    delivered_at = CASE WHEN ? = 1 THEN NOW() ELSE delivered_at END
                WHERE id = ?
            `, [
                nextStatus,
                data.shipping_method || null,
                data.tracking_number || null,
                data.estimated_delivery || null,
                data.shipping_address || null,
                data.recipient_name || null,
                data.recipient_dni || null,
                isPickup ? 1 : 0,
                orderId
            ]);

            await auditService.log({
                user_id: userId,
                action: 'DISPATCH_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                new_values: { status: nextStatus, ...data }
            });

            await connection.commit();
            const [updated] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
            return updated[0];
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async deliverOrder(orderId, data, userId) {
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL', [orderId]);
        if (orders.length === 0) throw new Error('Order not found');
        this._assertOrderTransition(orders[0].status, 'delivered');

        await pool.query(`
            UPDATE orders
            SET status = 'delivered',
                recipient_name = ?,
                recipient_dni = ?,
                delivery_notes = ?,
                delivered_at = NOW()
            WHERE id = ?
        `, [data.recipient_name || null, data.recipient_dni || null, data.delivery_notes || null, orderId]);

        await auditService.log({
            user_id: userId,
            action: 'DELIVER_ORDER',
            entity_type: 'order',
            entity_id: orderId,
            new_values: data
        });

        const [updated] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        return updated[0];
    }

    async pickOrderItem(itemId, pickedQuantity, userId) {
        const [items] = await pool.query('SELECT * FROM order_items WHERE id = ?', [itemId]);
        if (items.length === 0) throw new Error('Order item not found');

        const item = items[0];
        const safeQty = Math.max(0, Math.min(Number(pickedQuantity || 0), Number(item.quantity)));
        await pool.query('UPDATE order_items SET picked_quantity = ? WHERE id = ?', [safeQty, itemId]);

        await auditService.log({
            user_id: userId,
            action: 'PICK_ORDER_ITEM',
            entity_type: 'order_item',
            entity_id: itemId,
            new_values: { picked_quantity: safeQty }
        });

        const [updatedRows] = await pool.query('SELECT * FROM order_items WHERE id = ?', [itemId]);
        return updatedRows[0];
    }

    async getOrderSummary(orderId) {
        const [orders] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (orders.length === 0) throw new Error('Order not found');

        const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
        const totalItems = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
        const totalPicked = items.reduce((sum, i) => sum + Number(i.picked_quantity || 0), 0);

        return {
            order: orders[0],
            items,
            summary: {
                total_items: totalItems,
                total_picked: totalPicked,
                completion_percent: totalItems > 0 ? Math.round((totalPicked / totalItems) * 100) : 0
            }
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

            return { method, amount };
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
        }
    }

    async createInvoice(orderId, invoiceData, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
            if (orders.length === 0) throw new Error('Order not found');
            const order = orders[0];

            if (order.invoice_id) throw new Error('Order already invoiced');

            const [items] = await connection.query(`
                SELECT oi.*, p.name AS product_name, p.sku
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [orderId]);
            if (items.length === 0) throw new Error('Order has no items');

            const invoiceItems = items
                .map((item) => {
                    const qty = Number(item.picked_quantity || 0) > 0 ? Number(item.picked_quantity) : Number(item.quantity);
                    return {
                        product_id: item.product_id,
                        product_name: item.product_name,
                        sku: item.sku,
                        quantity: qty,
                        unit_price: Number(item.unit_price || 0),
                        vat_rate: 21
                    };
                })
                .filter((item) => item.quantity > 0);

            if (invoiceItems.length === 0) throw new Error('No picked items found');

            const [settings] = await connection.query('SELECT tax_rate FROM company_settings WHERE id = 1');
            const taxRate = settings.length > 0 && settings[0].tax_rate != null
                ? Number(settings[0].tax_rate)
                : 0.21;

            const netAmount = this._roundMoney(
                invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
            );
            const vatAmount = this._roundMoney(netAmount * taxRate);
            const totalAmount = this._roundMoney(netAmount + vatAmount);

            const invoiceType = invoiceData.invoice_type || 'B';
            const pointOfSale = Number(invoiceData.point_of_sale || 1);
            const invoiceNumber = await this._nextInvoiceNumber(connection, invoiceType, pointOfSale);
            const invoiceId = crypto.randomUUID();

            const client = await this._resolveClientSnapshot(connection, order.client_id, order.customer_name);
            const paymentData = this._normalizePayments(
                invoiceData.payments,
                totalAmount,
                order.payment_method || 'cash'
            );
            const paymentMethod = paymentData.primaryMethod;
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
                const base = item.quantity * item.unit_price;
                const lineVat = base * (item.vat_rate / 100);
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
                    lineVat,
                    base + lineVat,
                    item.product_name || 'Producto',
                    item.sku || null
                ]);
            }

            await this._registerInvoicePayments(connection, {
                invoiceId,
                clientId: client.client_id,
                invoiceLabel,
                payments: paymentData.payments
            });

            const nextOrderStatus = paymentData.paymentStatus === 'paid' ? 'completed' : order.status;
            await connection.query(
                'UPDATE orders SET invoice_id = ?, status = ?, payment_status = ? WHERE id = ?',
                [invoiceId, nextOrderStatus, paymentData.paymentStatus, orderId]
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
                    paid_amount: paymentData.paidAmount,
                    payment_status: paymentData.paymentStatus
                }
            });

            await connection.commit();
            return {
                id: invoiceId,
                invoice_type: invoiceType,
                point_of_sale: pointOfSale,
                invoice_number: invoiceNumber,
                total_amount: totalAmount,
                paid_amount: paymentData.paidAmount,
                payment_status: paymentData.paymentStatus
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async createManualInvoice(invoiceData, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

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

                const base = quantity * unitPrice * (1 - (discount / 100));
                const lineVat = base * (vatRate / 100);
                const totalLine = base + lineVat;

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
            const paymentData = this._normalizePayments(
                invoiceData.payments,
                totalAmount,
                invoiceData.payment_method || 'cash'
            );
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

            await this._registerInvoicePayments(connection, {
                invoiceId,
                clientId: client.client_id,
                invoiceLabel,
                payments: paymentData.payments
            });

            if (invoiceData.order_id) {
                await connection.query(
                    `UPDATE orders
                     SET invoice_id = ?,
                         status = CASE WHEN ? = 'paid' THEN 'completed' ELSE status END,
                         payment_status = ?
                     WHERE id = ?`,
                    [invoiceId, paymentData.paymentStatus, paymentData.paymentStatus, invoiceData.order_id]
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
                    paid_amount: paymentData.paidAmount,
                    payment_status: paymentData.paymentStatus
                }
            });

            await connection.commit();
            return {
                id: invoiceId,
                invoice_type: invoiceType,
                point_of_sale: pointOfSale,
                invoice_number: invoiceNumber,
                total_amount: totalAmount,
                issue_date: new Date().toISOString(),
                status: 'issued',
                client_name: client.client_name,
                paid_amount: paymentData.paidAmount,
                payment_status: paymentData.paymentStatus
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async authorizeInvoice(invoiceId, userId) {
        const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        if (rows.length === 0) throw new Error('Invoice not found');
        if (rows[0].status === 'authorized') return rows[0];

        const cae = String(Math.floor(10000000000000 + Math.random() * 90000000000000));
        const expiration = new Date();
        expiration.setDate(expiration.getDate() + 10);

        await pool.query(
            'UPDATE invoices SET status = "authorized", cae = ?, cae_expiration_date = ? WHERE id = ?',
            [cae, expiration.toISOString().slice(0, 10), invoiceId]
        );

        await auditService.log({
            user_id: userId,
            action: 'AUTHORIZE_INVOICE',
            entity_type: 'invoice',
            entity_id: invoiceId,
            new_values: { cae, cae_expiration_date: expiration.toISOString().slice(0, 10) }
        });

        const [updated] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
        return updated[0];
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

    async getInvoiceItems(invoiceId) {
        const [rows] = await pool.query(
            'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC',
            [invoiceId]
        );
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
