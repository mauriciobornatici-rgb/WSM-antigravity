import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class CreateOrderUseCase {
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
            `SELECT id, location, quantity, reserved_quantity, (quantity - reserved_quantity) AS available_quantity
             FROM inventory
             WHERE product_id = ? AND (quantity - reserved_quantity) > 0 AND location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
             ORDER BY (quantity - reserved_quantity) DESC
             FOR UPDATE`,
            [productId]
        );

        const availableQty = stockRows.reduce((sum, row) => sum + Number(row.available_quantity || 0), 0);
        if (availableQty < requestedQty) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }

        let remaining = requestedQty;
        for (const row of stockRows) {
            if (remaining <= 0) break;
            const rowAvailable = Number(row.available_quantity || 0);
            const consume = Math.min(rowAvailable, remaining);
            if (consume <= 0) continue;

            await connection.query(
                'UPDATE inventory SET reserved_quantity = reserved_quantity + ? WHERE id = ?',
                [consume, row.id]
            );
            remaining -= consume;
        }

        if (remaining > 0) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }
    }

    async execute(orderData, userId) {
        const orderId = crypto.randomUUID();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            if (orderData.external_source && orderData.external_id) {
                const [existingOrders] = await connection.query(
                    `SELECT id, total_amount
                     FROM orders
                     WHERE external_source = ? AND external_id = ?
                     LIMIT 1`,
                    [orderData.external_source, orderData.external_id]
                );
                if (existingOrders.length > 0) {
                    await connection.rollback();
                    return {
                        id: existingOrders[0].id,
                        total_amount: Number(existingOrders[0].total_amount || 0),
                        idempotent_replay: true
                    };
                }
            }

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
                (sum, item) => {
                    const requestedPrice = Number(item.unit_price);
                    const unitPrice = Number.isFinite(requestedPrice) && requestedPrice >= 0
                        ? requestedPrice
                        : priceByProduct.get(item.product_id);
                    return sum + Number(item.quantity) * unitPrice;
                },
                0
            );
            const externalTotal = Number(orderData.external_total_amount);
            const resolvedTotal = orderData.external_source && Number.isFinite(externalTotal) && externalTotal >= 0
                ? externalTotal
                : computedTotal;
            const allowedPaymentStatuses = new Set(['pending', 'paid', 'refunded', 'voided']);
            const resolvedPaymentStatus = orderData.external_source && allowedPaymentStatuses.has(orderData.payment_status)
                ? orderData.payment_status
                : 'pending';
            const normalizedPayments = Array.isArray(orderData.payments)
                ? orderData.payments.map((payment) => ({
                    method: String(payment.method || '').trim().toLowerCase(),
                    amount: Math.round(Number(payment.amount || 0) * 100) / 100,
                    check: payment.check || null
                }))
                : [];
            if (normalizedPayments.length > 0) {
                const allocatedTotal = Math.round(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
                if (normalizedPayments.some((payment) => !payment.method || payment.amount <= 0) || Math.abs(allocatedTotal - resolvedTotal) > 0.01) {
                    const err = new Error(`Los medios de pago deben sumar el total del pedido (${resolvedTotal})`);
                    err.statusCode = 400;
                    err.errorCode = 'INVALID_ORDER_PAYMENT_ALLOCATION';
                    throw err;
                }
            }
            const resolvedPaymentMethod = normalizedPayments.length > 1
                ? 'multiple'
                : normalizedPayments[0]?.method || orderData.payment_method || 'cash';

            let counterName = String(orderData.counter_name || '').trim();
            if (!counterName && userId) {
                const [users] = await connection.query(
                    'SELECT name FROM users WHERE id = ? LIMIT 1',
                    [userId]
                );
                counterName = String(users[0]?.name || '').trim();
            }
            const resolvedCounterName = counterName || null;

            await connection.query(
                `INSERT INTO orders (
                    id, client_id, counter_user_id, customer_name, counter_name,
                    total_amount, status, payment_status, payment_method,
                    shipping_method, shipping_address, estimated_delivery,
                    recipient_name, recipient_dni, delivery_notes, notes,
                    external_source, external_id
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    orderData.client_id || null,
                    userId || orderData.counter_user_id || null,
                    orderData.customer_name || null,
                    resolvedCounterName,
                    resolvedTotal,
                    resolvedPaymentStatus,
                    resolvedPaymentMethod,
                    orderData.shipping_method || null,
                    orderData.shipping_address || null,
                    orderData.estimated_delivery || null,
                    orderData.recipient_name || null,
                    orderData.recipient_dni || null,
                    orderData.delivery_notes || null,
                    orderData.notes || null,
                    orderData.external_source || null,
                    orderData.external_id || null
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
                const requestedPrice = Number(item.unit_price);
                const unitPrice = Number.isFinite(requestedPrice) && requestedPrice >= 0
                    ? requestedPrice
                    : priceByProduct.get(item.product_id);
                await connection.query(
                    'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)',
                    [itemId, orderId, item.product_id, item.quantity, unitPrice]
                );
            }

            for (const payment of normalizedPayments) {
                await connection.query(
                    `INSERT INTO order_payments (id, order_id, payment_method, amount, check_payload)
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        crypto.randomUUID(),
                        orderId,
                        payment.method,
                        payment.amount,
                        payment.check ? JSON.stringify(payment.check) : null
                    ]
                );
            }

            let finalTotal = resolvedTotal;
            let pointsRedeemed = Number(orderData.points_redeemed || 0);
            let pointsEarned = 0;

            if (orderData.client_id) {
                if (pointsRedeemed > 0) {
                    const [cliRows] = await connection.query("SELECT loyalty_points FROM clients WHERE id = ?", [orderData.client_id]);
                    const currentPoints = Number(cliRows[0]?.loyalty_points || 0);
                    if (pointsRedeemed > currentPoints) {
                        pointsRedeemed = currentPoints;
                    }
                    const discountAmount = pointsRedeemed * 10; // 1 punto = $10 descuento
                    finalTotal = Math.max(0, resolvedTotal - discountAmount);
                }

                pointsEarned = Math.floor(finalTotal / 1000); // 1 punto por cada $1.000 consumidos
                await connection.query(
                    "UPDATE clients SET loyalty_points = GREATEST(0, loyalty_points - ? + ?) WHERE id = ?",
                    [pointsRedeemed, pointsEarned, orderData.client_id]
                );
            }

            await auditService.log({
                user_id: userId,
                action: 'CREATE_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                new_values: {
                    ...orderData,
                    total_amount: finalTotal,
                    points_redeemed: pointsRedeemed,
                    points_earned: pointsEarned
                }
            }, connection);

            await connection.commit();
            return { id: orderId, total_amount: finalTotal, points_earned: pointsEarned, points_redeemed: pointsRedeemed };
        } catch (err) {
            await connection.rollback();
            if (err?.code === 'ER_DUP_ENTRY' && orderData.external_source && orderData.external_id) {
                const [existingOrders] = await pool.query(
                    `SELECT id, total_amount
                     FROM orders
                     WHERE external_source = ? AND external_id = ?
                     LIMIT 1`,
                    [orderData.external_source, orderData.external_id]
                );
                if (existingOrders.length > 0) {
                    return {
                        id: existingOrders[0].id,
                        total_amount: Number(existingOrders[0].total_amount || 0),
                        idempotent_replay: true
                    };
                }
            }
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new CreateOrderUseCase();
