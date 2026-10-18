import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import defaultStockLedger from '../inventory/StockLedger.js';
import defaultValuation from '../inventory/InventoryValuation.js';
import { lineAmounts } from '../../utils/vatMath.js';
import { businessError } from '../../utils/businessError.js';
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

// ADR-019: the online store shows what can still be sold (physical minus reserved).
async function syncOnlineStock(productIds) {
    const { default: tiendanubeService } = await import('../../services/tiendanube.service.js');
    await tiendanubeService.pushAvailableStock(productIds);
}

export class CreateOrderUseCase {
    constructor({ stockLedger = defaultStockLedger, valuation = defaultValuation, onStockChanged = syncOnlineStock } = {}) {
        this.stockLedger = stockLedger;
        this.valuation = valuation;
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

    async _decreaseInventoryForOrder(connection, { orderId, orderItemId, productId, productName, quantity, allowShortage = false }) {
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
        if (availableQty < requestedQty && !allowShortage) {
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'reserved', 0)
                    ON DUPLICATE KEY UPDATE
                        -- A later reservation from the same stock row (an online order that waited
                        -- for goods, AUD-007) adds to the existing allocation.
                        reserved_quantity = reserved_quantity + VALUES(reserved_quantity),
                        version = version + 1`,
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

        if (remaining > 0 && !allowShortage) {
            throw this._buildStockError(productId, productName, requestedQty, availableQty);
        }
        // ADR-019: an online sale already happened: what could not be reserved is a shortage.
        return { shortage: Math.max(remaining, 0) };
    }

    /**
     * ADR-019 / AUD-007: an online order recorded without enough stock keeps waiting for it.
     * When goods arrive, its missing units are reserved automatically, oldest order first,
     * so the stock that comes in goes to whoever already paid for it. Returns what was reserved.
     */
    async reserveOpenShortages(productIds = null) {
        const ids = Array.isArray(productIds) ? [...new Set(productIds.filter(Boolean))] : null;
        if (ids && ids.length === 0) return [];
        const [candidates] = await pool.query(
            `SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, p.name AS product_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE o.allocation_tracked = 1 AND o.deleted_at IS NULL
               AND o.external_source IS NOT NULL AND o.external_source <> 'pos'
               AND o.status NOT IN ('packed', 'dispatched', 'delivered', 'completed', 'cancelled', 'returned')
               ${ids ? 'AND oi.product_id IN (?)' : ''}
               AND oi.quantity > COALESCE((SELECT SUM(a.reserved_quantity) FROM order_item_allocations a
                                           WHERE a.order_item_id = oi.id AND a.status IN ('reserved', 'picked')), 0)
             ORDER BY o.created_at, oi.id`,
            ids ? [ids] : []
        );
        const reserved = [];
        for (const candidate of candidates) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                // Same lock order as everywhere: the order first, then its stock rows.
                const [orders] = await connection.query(
                    "SELECT id, status FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
                    [candidate.order_id]
                );
                const status = String(orders[0]?.status || '').toLowerCase();
                if (!orders[0] || ['packed', 'dispatched', 'delivered', 'completed', 'cancelled', 'returned'].includes(status)) {
                    await connection.rollback();
                    continue;
                }
                const [[missingRow]] = await connection.query(
                    `SELECT oi.quantity - COALESCE((SELECT SUM(a.reserved_quantity) FROM order_item_allocations a
                                                    WHERE a.order_item_id = oi.id AND a.status IN ('reserved', 'picked')), 0) AS missing
                     FROM order_items oi WHERE oi.id = ? FOR UPDATE`,
                    [candidate.order_item_id]
                );
                const missing = Number(missingRow?.missing || 0);
                if (missing <= 0) {
                    await connection.rollback();
                    continue;
                }
                const { shortage } = await this._decreaseInventoryForOrder(connection, {
                    orderId: candidate.order_id,
                    orderItemId: candidate.order_item_id,
                    productId: candidate.product_id,
                    productName: candidate.product_name,
                    quantity: missing,
                    allowShortage: true
                });
                const got = missing - shortage;
                if (got > 0) {
                    await auditService.log({
                        action: 'CHANNEL_ORDER_SHORTAGE_RESERVED',
                        entity_type: 'order',
                        entity_id: candidate.order_id,
                        new_values: { product_id: candidate.product_id, reserved: got, still_missing: shortage },
                    }, connection);
                    reserved.push({ order_id: candidate.order_id, product_id: candidate.product_id, reserved: got, still_missing: shortage });
                }
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                console.error('[Faltantes de pedidos online] No se pudo reservar:', error.message);
            } finally {
                connection.release();
            }
        }
        return reserved;
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
        const channelShortages = [];
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
            // The customer is locked before the stock (lock order of ADR-027, L2): the sale updates
            // the row below (points). Locked after the stock, it deadlocked against a credit sale
            // for the same customer that already held it.
            const [clients] = orderData.client_id
                ? await connection.query(
                    'SELECT id, name FROM clients WHERE id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                    [orderData.client_id]
                )
                : [[]];
            if (creditAccountAmount > 0) {
                if (!orderData.client_id) {
                    const err = new Error('La venta a cuenta corriente requiere seleccionar un cliente registrado. Consumidor final no puede tener cuenta corriente.');
                    err.statusCode = 400;
                    err.status = 'fail';
                    err.errorCode = 'CREDIT_ACCOUNT_REQUIRES_CLIENT';
                    throw err;
                }
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
                    external_source, external_id, allocation_tracked
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    orderData.external_id || null,
                    // Reserved through allocations (AUD-007): never the legacy release path.
                    counterSale ? 0 : 1
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
            // The cost is read under lock after the stock (L4 after L3, ADR-027): it is the last one
            // committed, and a cost change waits for this sale or this sale for it.
            const costs = counterSale
                ? await this.valuation.lockCosts(connection, productIds)
                : new Map();
            const exitLines = [];
            const itemsInLockOrder = [...orderData.items].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));

            for (const item of itemsInLockOrder) {
                const itemId = crypto.randomUUID();
                const unitPrice = resolveUnitPrice(item, priceByProduct);

                if (counterSale) {
                    await connection.query(
                        'INSERT INTO order_items (id, order_id, product_id, quantity, picked_quantity, unit_price, vat_rate) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [itemId, orderId, item.product_id, item.quantity, item.quantity, unitPrice, vatByProduct.get(item.product_id)]
                    );
                    const unitCost = costs.get(item.product_id)?.cost || 0;
                    const { consumed, shortage, movementIds } = await this.stockLedger.consumeAvailable(connection, lockedRows.get(item.product_id) || [], {
                        productId: item.product_id,
                        productName: nameByProduct.get(item.product_id),
                        quantity: item.quantity,
                        orderId,
                        userId,
                        reason: 'Venta mostrador POS',
                        // Cost at the moment of sale: a later return reverses CMV at this cost.
                        unitCost,
                        // An offline sale already happened: record it even without stock (ADR-010).
                        allowShortage: offlineReplay
                    });
                    exitLines.push({ quantity: consumed, shortage, unitCost, movementIds });
                    if (shortage > 0) {
                        stockShortages.push({ product_id: item.product_id, requested: Number(item.quantity), shortage });
                    }
                    continue;
                }

                await connection.query(
                    'INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, vat_rate) VALUES (?, ?, ?, ?, ?, ?)',
                    [itemId, orderId, item.product_id, item.quantity, unitPrice, vatByProduct.get(item.product_id)]
                );

                // ADR-019: an order from the online store was already sold and paid there: it is
                // always recorded. Units that cannot be reserved go to the exceptions list.
                const channelSale = Boolean(orderData.external_source) && orderData.external_source !== 'pos';
                const { shortage } = await this._decreaseInventoryForOrder(connection, {
                    orderId,
                    orderItemId: itemId,
                    productId: item.product_id,
                    productName: nameByProduct.get(item.product_id),
                    quantity: item.quantity,
                    allowShortage: channelSale
                });
                if (shortage > 0) {
                    channelShortages.push({ product_id: item.product_id, product_name: nameByProduct.get(item.product_id), requested: Number(item.quantity), shortage });
                }
            }

            if (counterSale) {
                // ADR-027 (D8): the goods left now, so their cost is posted now, invoiced or not.
                await this.valuation.postExit(connection, {
                    referenceType: 'order',
                    referenceId: orderId,
                    description: `Costo de mercadería vendida - venta de mostrador ${orderId.slice(0, 8)}`,
                    lines: exitLines,
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

            if (channelShortages.length > 0) {
                // ADR-019: an online sale without enough stock is recorded and reviewed by a manager
                // (buy, transfer, or agree with the customer), like an offline counter sale.
                await auditService.log({
                    user_id: userId,
                    action: 'CHANNEL_ORDER_STOCK_SHORTAGE',
                    entity_type: 'order',
                    entity_id: orderId,
                    new_values: { source: orderData.external_source, external_id: orderData.external_id || null, lines: channelShortages }
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
            // A sale takes stock and an order reserves it: both change what the store can sell.
            const syncStock = () => {
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
            // ADR-027: a sale also reads the cost under lock; a deadlock is answered, not a 500.
            if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando estos productos. Reintentá en unos segundos.' });
            }
            throw err;
        } finally {
            if (!isExternalTx) connection.release();
        }
    }
}

export default new CreateOrderUseCase();
