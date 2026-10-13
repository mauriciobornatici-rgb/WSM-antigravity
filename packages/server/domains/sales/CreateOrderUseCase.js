import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import defaultStockLedger from '../inventory/StockLedger.js';
import accountingService from '../../services/accounting.service.js';
import { lineAmounts } from '../../utils/vatMath.js';
import { hasPermission, PERMISSIONS } from '@wsm/common';

// A POS checkout without shipping is a counter sale: the customer leaves with the
// goods, so stock is deducted now instead of being reserved for picking.
export function isCounterSale(orderData) {
    return orderData.external_source === 'pos' && !orderData.shipping_method;
}

const OFFLINE_REPLAY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isOfflineReplay(orderData, now = Date.now()) {
    if (orderData.external_source !== 'pos' || !orderData.offline_captured_at) return false;
    const capturedAt = Date.parse(orderData.offline_captured_at);
    return Number.isFinite(capturedAt) && capturedAt <= now + CLOCK_SKEW_MS && now - capturedAt <= OFFLINE_REPLAY_MAX_AGE_MS;
}

/**
 * Net unit price stored for a line (ADR-015). A requested price within half a cent of the
 * catalog is the catalog price itself (the screen shows it rounded): keeping the catalog's
 * 4 decimals makes the line charge exactly the final price on the shelf. Anything else is
 * an override (checked by resolvePriceOverrides) and is kept at 4 decimals.
 */
export function resolveUnitPrice(item, priceByProduct) {
    const catalog = priceByProduct.get(item.product_id);
    const requested = Number(item.unit_price);
    if (item.unit_price == null || !Number.isFinite(requested) || requested < 0) return catalog;
    if (Math.abs(requested - catalog) < 0.005) return catalog;
    return Math.round(requested * 10000) / 10000;
}

/**
 * Lines whose requested price differs from the catalog (ADR-008). Such prices are
 * accepted only from marketplace imports, users with ORDERS_PRICE_OVERRIDE, or a POS
 * sale captured offline (the sale already happened at that price); all are audited.
 */
export function resolvePriceOverrides(orderData, priceByProduct, nameByProduct, actor) {
    const overrides = [];
    for (const item of orderData.items) {
        const requested = Number(item.unit_price);
        if (item.unit_price == null || !Number.isFinite(requested) || requested < 0) continue;
        const catalog = priceByProduct.get(item.product_id);
        if (Math.abs(requested - catalog) < 0.005) continue;
        overrides.push({ product_id: item.product_id, catalog_price: catalog, unit_price: requested });
    }
    if (overrides.length === 0) return { overrides, source: null };

    const isMarketplaceImport = Boolean(orderData.external_source) && orderData.external_source !== 'pos';
    if (isMarketplaceImport) return { overrides, source: orderData.external_source };
    if (isOfflineReplay(orderData)) return { overrides, source: 'offline_pos' };
    if (hasPermission(actor?.role, PERMISSIONS.ORDERS_PRICE_OVERRIDE)) return { overrides, source: 'authorized_user' };

    const first = overrides[0];
    const err = new Error(
        `El precio de ${nameByProduct.get(first.product_id) || first.product_id} no coincide con el catálogo ` +
        `($${first.catalog_price}). Actualizá los precios en pantalla; cambiar precios requiere autorización.`
    );
    err.statusCode = 409;
    err.status = 'fail';
    err.errorCode = 'PRICE_OVERRIDE_NOT_ALLOWED';
    err.details = overrides;
    throw err;
}

async function syncOnlineStock(productIds) {
    const { default: inventoryService } = await import('../../services/inventory.service.js');
    const { default: tiendanubeService } = await import('../../services/tiendanube.service.js');
    for (const productId of productIds) {
        const totalStock = await inventoryService.getProductStock(productId);
        await tiendanubeService.syncStock(productId, totalStock);
    }
}

export class CreateOrderUseCase {
    constructor({ stockLedger = defaultStockLedger, onStockChanged = syncOnlineStock } = {}) {
        this.stockLedger = stockLedger;
        this.onStockChanged = onStockChanged;
    }

    _buildStockError(productId, productName, requestedQty, availableQty) {
        const name = productName || productId;
        const err = new Error(`Stock insuficiente para ${name}. Disponible: ${availableQty}, solicitado: ${requestedQty}`);
        err.statusCode = 409;
        err.status = 'fail';
        err.errorCode = 'INSUFFICIENT_STOCK';
        return err;
    }

    async _decreaseInventoryForOrder(connection, { orderId, orderItemId, productId, productName, quantity }) {
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
        // ADR-015: orders are picked in the back: warehouse locations before the sales floor.
        const ordered = this.stockLedger.orderByChannel(
            stockRows,
            await this.stockLedger.salesFloorCodes(connection),
            'order'
        );
        stockRows.splice(0, stockRows.length, ...ordered);

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

            if (orderId && orderItemId) {
                await connection.query(
                    `INSERT INTO order_item_allocations (
                        id, order_id, order_item_id, product_id, inventory_id,
                        location_code, reserved_quantity, picked_quantity, shortage_quantity,
                        status, version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'reserved', 0)`,
                    [
                        crypto.randomUUID(),
                        orderId,
                        orderItemId,
                        productId,
                        row.id,
                        row.location || 'General',
                        consume
                    ]
                );
            }

            remaining -= consume;
        }

        if (remaining > 0) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }
    }

    /**
     * With existingConnection the order is created inside the caller's transaction
     * (no begin/commit/release here) and the caller must run esult.syncStock() after
     * its own commit, as createInvoice does.
     */
    async execute(orderData, userId, actor = null, existingConnection = null) {
        const orderId = crypto.randomUUID();
        const counterSale = isCounterSale(orderData);
        const offlineReplay = counterSale && isOfflineReplay(orderData);
        const stockShortages = [];
        const isExternalTx = Boolean(existingConnection);
        const connection = existingConnection || await pool.getConnection();

        try {
            if (!isExternalTx) await connection.beginTransaction();

            if (orderData.external_source && orderData.external_id) {
                const [existingOrders] = await connection.query(
                    `SELECT id, total_amount
                     FROM orders
                     WHERE external_source = ? AND external_id = ?
                     LIMIT 1`,
                    [orderData.external_source, orderData.external_id]
                );
                if (existingOrders.length > 0) {
                    if (!isExternalTx) await connection.rollback();
                    return {
                        id: existingOrders[0].id,
                        total_amount: Number(existingOrders[0].total_amount || 0),
                        idempotent_replay: true
                    };
                }
            }

            const productIds = orderData.items.map((item) => item.product_id);
            const [products] = await connection.query(
                'SELECT id, sale_price, name, vat_rate FROM products WHERE id IN (?)',
                [productIds]
            );
            const priceByProduct = new Map(products.map((p) => [p.id, Number(p.sale_price || 0)]));
            const nameByProduct = new Map(products.map((p) => [p.id, p.name || p.id]));
            // VAT always comes from the catalog, like the invoice: a client-sent vat_rate is ignored.
            const vatByProduct = new Map(products.map((p) => [p.id, p.vat_rate == null ? 21 : Number(p.vat_rate)]));

            for (const item of orderData.items) {
                if (!priceByProduct.has(item.product_id)) {
                    throw new Error(`Producto no encontrado: ${item.product_id}`);
                }
            }
            const priceOverride = resolvePriceOverrides(orderData, priceByProduct, nameByProduct, actor);

            const computedWithVat = orderData.items.reduce(
                (sum, item) => sum + lineAmounts(
                    // ADR-015: the line is charged at quantity × the final (VAT-included) price.
                    item.quantity, resolveUnitPrice(item, priceByProduct), vatByProduct.get(item.product_id)
                ).gross,
                0
            );

            const externalTotal = Number(orderData.external_total_amount ?? orderData.total_amount);
            // Order totals are VAT-included (ADR-008/015) and computed here: a client-sent total
            // is never trusted (an internal order used to keep the net total, or any total the
            // client sent, and the current account of uninvoiced credit orders read it).
            let resolvedTotal = Math.round(computedWithVat * 100) / 100;
            // ADR-017: the shipping of an order made here, charged to the customer or absorbed.
            const shippingCharge = !orderData.external_source && orderData.shipping_charge
                && Number(orderData.shipping_charge.amount) > 0
                ? {
                    kind: 'shipping',
                    description: 'Envío',
                    amount: Math.round(Number(orderData.shipping_charge.amount) * 100) / 100,
                    vat_rate: orderData.shipping_charge.vat_rate ?? 21,
                    billable: orderData.shipping_charge.charge_customer !== false,
                }
                : null;
            if (shippingCharge && !shippingCharge.billable && !hasPermission(actor?.role, PERMISSIONS.ORDERS_PRICE_OVERRIDE)) {
                // ADR-018: absorbing the shipping is a commercial concession (manager or admin).
                const err = new Error('Bonificar el envío requiere autorización de un gerente o administrador.');
                err.statusCode = 403;
                err.errorCode = 'SHIPPING_ABSORB_NOT_ALLOWED';
                throw err;
            }
            if (shippingCharge?.billable) resolvedTotal = Math.round((resolvedTotal + shippingCharge.amount) * 100) / 100;
            if (orderData.external_source && orderData.external_source !== 'pos'
                && Number.isFinite(externalTotal) && externalTotal >= 0) {
                // An external channel (Tiendanube) reports what its customer actually paid.
                resolvedTotal = externalTotal;
            }
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
            let paymentRoundingAdjustment = null;
            if (normalizedPayments.length > 0) {
                const allocatedTotal = Math.round(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;
                const gap = Math.round((resolvedTotal - allocatedTotal) * 100) / 100;
                // An offline sale queued by a client older than ADR-015 rounded the VAT on the
                // total, not per line: up to a cent per line apart. The sale already happened,
                // so the last payment absorbs the cents (audited) instead of losing the sale.
                const lastPayment = normalizedPayments[normalizedPayments.length - 1];
                if (offlineReplay && Math.abs(gap) > 0.01 && Math.abs(gap) <= 0.01 * orderData.items.length
                    && lastPayment && lastPayment.amount + gap > 0) {
                    paymentRoundingAdjustment = { method: lastPayment.method, from: lastPayment.amount, gap };
                    lastPayment.amount = Math.round((lastPayment.amount + gap) * 100) / 100;
                } else if (normalizedPayments.some((payment) => !payment.method || payment.amount <= 0) || Math.abs(gap) > 0.01) {
                    const err = new Error(`Los medios de pago deben sumar el total del pedido (${resolvedTotal})`);
                    err.statusCode = 400;
                    err.errorCode = 'INVALID_ORDER_PAYMENT_ALLOCATION';
                    throw err;
                }
            }
            const resolvedPaymentMethod = normalizedPayments.length > 1
                ? 'multiple'
                : normalizedPayments[0]?.method || orderData.payment_method || 'cash';

            const creditAccountAmount = normalizedPayments.length > 0
                ? normalizedPayments
                    .filter((payment) => payment.method === 'credit_account')
                    .reduce((sum, payment) => sum + payment.amount, 0)
                : (resolvedPaymentMethod === 'credit_account' ? resolvedTotal : 0);
            if (creditAccountAmount > 0) {
                if (!orderData.client_id) {
                    const err = new Error('La venta a cuenta corriente requiere seleccionar un cliente registrado. Consumidor final no puede tener cuenta corriente.');
                    err.statusCode = 400;
                    err.status = 'fail';
                    err.errorCode = 'CREDIT_ACCOUNT_REQUIRES_CLIENT';
                    throw err;
                }
                const [clients] = await connection.query(
                    'SELECT id, name FROM clients WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                    [orderData.client_id]
                );
                if (clients.length === 0 || String(clients[0].name || '').trim().toLowerCase() === 'consumidor final') {
                    const err = new Error('La cuenta corriente solo puede asignarse a un cliente registrado distinto de Consumidor final.');
                    err.statusCode = 400;
                    err.status = 'fail';
                    err.errorCode = 'INVALID_CREDIT_ACCOUNT_CLIENT';
                    throw err;
                }
            }

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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderId,
                    orderData.client_id || null,
                    userId || orderData.counter_user_id || null,
                    orderData.customer_name || null,
                    resolvedCounterName,
                    resolvedTotal,
                    counterSale ? 'completed' : 'pending',
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

            // Shipping, discounts and surcharges reported by an external channel (ADR-016, never
            // from the HTTP body: the schema strips them) and the shipping of an order made here
            // (ADR-017). Billable ones are invoiced next to the detail.
            const channelAdjustments = orderData.external_source && orderData.external_source !== 'pos' && Array.isArray(orderData.adjustments)
                ? orderData.adjustments
                : [];
            for (const adjustment of [...channelAdjustments, ...(shippingCharge ? [shippingCharge] : [])]) {
                const amount = Math.round(Number(adjustment.amount || 0) * 100) / 100;
                if (!amount) continue;
                await connection.query(
                    `INSERT INTO order_adjustments (id, order_id, kind, description, amount, vat_rate, billable)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), orderId, adjustment.kind, String(adjustment.description || adjustment.kind).slice(0, 255),
                        amount, adjustment.vat_rate == null ? 21 : Number(adjustment.vat_rate), adjustment.billable === false ? 0 : 1]
                );
            }

            // Stock rows are locked in product-id order in every path so that two
            // concurrent carts with the same products cannot deadlock each other.
            const lockedRows = counterSale
                ? await this.stockLedger.lockSellableRows(connection, productIds, { channel: 'counter' })
                : null;
            const unitCosts = counterSale
                ? await accountingService.productUnitCosts(connection, productIds)
                : new Map();
            const itemsInLockOrder = [...orderData.items].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));

            for (const item of itemsInLockOrder) {
                const itemId = crypto.randomUUID();
                const unitPrice = resolveUnitPrice(item, priceByProduct);

                if (counterSale) {
                    await connection.query(
                        'INSERT INTO order_items (id, order_id, product_id, quantity, picked_quantity, unit_price, vat_rate) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [itemId, orderId, item.product_id, item.quantity, item.quantity, unitPrice, vatByProduct.get(item.product_id)]
                    );
                    const { shortage } = await this.stockLedger.consumeAvailable(connection, lockedRows.get(item.product_id) || [], {
                        productId: item.product_id,
                        productName: nameByProduct.get(item.product_id),
                        quantity: item.quantity,
                        orderId,
                        userId,
                        reason: 'Venta mostrador POS',
                        // Cost at the moment of sale: a later return reverses CMV at this cost.
                        unitCost: unitCosts.get(item.product_id) || 0,
                        // An offline sale already happened: record it even without stock (ADR-010).
                        allowShortage: offlineReplay
                    });
                    if (shortage > 0) {
                        stockShortages.push({ product_id: item.product_id, requested: Number(item.quantity), shortage });
                    }
                    continue;
                }

                await connection.query(
                    'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, vat_rate) VALUES (?, ?, ?, ?, ?, ?)',
                    [itemId, orderId, item.product_id, item.quantity, unitPrice, vatByProduct.get(item.product_id)]
                );

                await this._decreaseInventoryForOrder(connection, {
                    orderId,
                    orderItemId: itemId,
                    productId: item.product_id,
                    productName: nameByProduct.get(item.product_id),
                    quantity: item.quantity
                });
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

            if (stockShortages.length > 0) {
                // Reviewed by a manager in the POS exceptions list; the stock needs a count.
                await auditService.log({
                    user_id: userId,
                    action: 'OFFLINE_SALE_STOCK_SHORTAGE',
                    entity_type: 'order',
                    entity_id: orderId,
                    new_values: { offline_captured_at: orderData.offline_captured_at, lines: stockShortages }
                }, connection);
            }

            if (paymentRoundingAdjustment) {
                await auditService.log({
                    user_id: userId,
                    action: 'OFFLINE_SALE_PAYMENT_ROUNDING',
                    entity_type: 'order',
                    entity_id: orderId,
                    new_values: { offline_captured_at: orderData.offline_captured_at, total: resolvedTotal, ...paymentRoundingAdjustment }
                }, connection);
            }

            if (priceOverride.overrides.length > 0) {
                await auditService.log({
                    user_id: userId,
                    action: 'ORDER_PRICE_OVERRIDE',
                    entity_type: 'order',
                    entity_id: orderId,
                    new_values: { source: priceOverride.source, role: actor?.role || null, lines: priceOverride.overrides }
                }, connection);
            }

            // Online stock follows physical stock; a sync failure must not undo the sale.
            const syncStock = () => {
                if (!counterSale) return;
                setImmediate(() => {
                    this.onStockChanged([...new Set(productIds)]).catch((err) => {
                        console.error('[TiendaNube Sync] Error syncing stock after counter sale:', err);
                    });
                });
            };
            const result = { id: orderId, total_amount: finalTotal, points_earned: pointsEarned, points_redeemed: pointsRedeemed };
            if (isExternalTx) {
                // The POS checkout records these same payments in the shift and the invoice:
                // hand back the amounts actually stored (after an offline rounding adjustment).
                const payments = paymentRoundingAdjustment
                    ? orderData.payments.map((payment, index) => (
                        index === normalizedPayments.length - 1 ? { ...payment, amount: normalizedPayments[index].amount } : payment
                    ))
                    : orderData.payments;
                return { ...result, payments, syncStock };
            }

            await connection.commit();
            syncStock();
            return result;
        } catch (err) {
            if (isExternalTx) throw err;
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
            if (!isExternalTx) connection.release();
        }
    }
}

export default new CreateOrderUseCase();
