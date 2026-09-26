import crypto from 'node:crypto';

// Diagnosis and repair of defect C1: until 2026-09-25 a POS counter sale only
// reserved stock. Physical quantity was never deducted, reserved_quantity kept
// growing and no 'sale' movement was written. Orders created before migration 044
// have no allocation rows: their reservation lives only in inventory.reserved_quantity.

export const REPAIR_AUDIT_ACTION = 'REPAIR_POS_STOCK_C1';
export const REPAIR_REASON = 'REPAIR-C1 venta POS historica';
const COUNT_MOVEMENT_TYPES = ['stock_audit', 'stock_adjustment', 'adjustment'];
const NON_SELLABLE_LOCATIONS = ['Cuarentena', 'Devoluciones a Proveedores', 'Mermas'];

export const DRIFT_CLASSES = Object.freeze({
    A: 'A_sold',            // invoiced or paid: deduct stock and release the reservation
    B: 'B_counted_after',   // like A, but a later count already corrected physical stock: release only
    C: 'C_unpaid',          // no invoice and no shift payment: list only (optionally cancel)
});

/**
 * POS counter orders affected by C1 and not repaired yet, with their items.
 * Read-only: safe inside a READ ONLY transaction.
 */
export async function findAffectedOrders(connection) {
    const [orders] = await connection.query(
        `SELECT o.id, o.status, o.invoice_id, o.created_at,
                EXISTS (SELECT 1 FROM shift_payments sp WHERE sp.order_id = o.id) AS has_shift_payment
         FROM orders o
         WHERE o.external_source = 'pos'
           AND (o.shipping_method IS NULL OR o.shipping_method = '')
           AND o.status IN ('pending', 'completed')
           AND NOT EXISTS (
               SELECT 1 FROM inventory_movements m
               WHERE m.reference_type = 'order' AND m.reference_id = o.id AND m.type = 'sale'
           )
           AND NOT EXISTS (
               SELECT 1 FROM audit_logs a
               WHERE a.action = ? AND a.entity_type = 'order' AND a.entity_id = o.id
           )
         ORDER BY o.created_at, o.id`,
        [REPAIR_AUDIT_ACTION]
    );
    if (orders.length === 0) return [];

    const orderIds = orders.map((order) => order.id);
    const [items] = await connection.query(
        `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, p.name AS product_name
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id IN (?)
         ORDER BY oi.order_id, oi.product_id, oi.id`,
        [orderIds]
    );
    const [allocations] = await connection.query(
        `SELECT id, order_id, order_item_id, inventory_id, reserved_quantity
         FROM order_item_allocations
         WHERE order_id IN (?) AND status = 'reserved'
         ORDER BY order_id, inventory_id`,
        [orderIds]
    );
    const [counts] = await connection.query(
        `SELECT oi.order_id, oi.product_id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.order_id IN (?)
           AND EXISTS (
               SELECT 1 FROM inventory_movements m
               WHERE m.product_id = oi.product_id AND m.type IN (?) AND m.created_at > o.created_at
           )`,
        [orderIds, COUNT_MOVEMENT_TYPES]
    );
    const countedAfter = new Set(counts.map((row) => `${row.order_id}|${row.product_id}`));

    return orders.map((order) => {
        const orderItems = items.filter((item) => item.order_id === order.id).map((item) => ({
            ...item,
            quantity: Number(item.quantity),
            counted_after: countedAfter.has(`${order.id}|${item.product_id}`),
            allocations: allocations.filter((alloc) => alloc.order_item_id === item.id)
                .map((alloc) => ({ ...alloc, reserved_quantity: Number(alloc.reserved_quantity) })),
        }));
        const paid = Boolean(order.invoice_id) || Boolean(Number(order.has_shift_payment));
        let driftClass = DRIFT_CLASSES.C;
        if (paid) {
            driftClass = orderItems.some((item) => item.counted_after) ? DRIFT_CLASSES.B : DRIFT_CLASSES.A;
        }
        return {
            id: order.id,
            status: order.status,
            created_at: order.created_at,
            invoice_id: order.invoice_id,
            has_shift_payment: Boolean(Number(order.has_shift_payment)),
            drift_class: driftClass,
            legacy_without_allocations: orderItems.every((item) => item.allocations.length === 0),
            items: orderItems,
        };
    });
}

/** Inventory rows breaking quantity >= reserved_quantity >= 0. */
export async function findInvariantViolations(connection) {
    const [rows] = await connection.query(
        `SELECT i.id, i.product_id, p.name AS product_name, i.location, i.quantity, i.reserved_quantity
         FROM inventory i LEFT JOIN products p ON p.id = i.product_id
         WHERE i.quantity IS NULL OR i.quantity < 0 OR i.reserved_quantity < 0 OR i.reserved_quantity > i.quantity
         ORDER BY i.product_id, i.id`
    );
    return rows;
}

export function summarize(orders, violations) {
    const byClass = Object.fromEntries(Object.values(DRIFT_CLASSES).map((key) => [key, { orders: 0, units: 0 }]));
    for (const order of orders) {
        byClass[order.drift_class].orders += 1;
        byClass[order.drift_class].units += order.items.reduce((sum, item) => sum + item.quantity, 0);
    }
    return {
        affected_orders: orders.length,
        legacy_orders_without_allocations: orders.filter((order) => order.legacy_without_allocations).length,
        by_class: byClass,
        inventory_invariant_violations: violations.length,
    };
}

/**
 * Repairs one order inside the caller's transaction. Returns the list of stock
 * changes. Throws on any anomaly so the caller rolls back that order only.
 * mode: 'sale' deducts quantity and releases the reservation, 'release' only
 * releases it (stock already counted, or the sale is being cancelled).
 */
export async function repairOrder(connection, order, { mode, userId = null }) {
    const changes = [];
    for (const item of order.items) {
        if (item.allocations.length > 0) {
            for (const alloc of item.allocations) {
                await applyRowChange(connection, {
                    inventoryId: alloc.inventory_id, quantity: alloc.reserved_quantity, mode, order, item, userId, changes,
                });
                await connection.query(
                    "UPDATE order_item_allocations SET status = ?, picked_quantity = ? WHERE id = ? AND status = 'reserved'",
                    [mode === 'sale' ? 'picked' : 'released', mode === 'sale' ? alloc.reserved_quantity : 0, alloc.id]
                );
            }
            continue;
        }

        // Legacy order: the reservation is somewhere in the product's rows.
        const [rows] = await connection.query(
            `SELECT id, reserved_quantity FROM inventory
             WHERE product_id = ? AND reserved_quantity > 0 AND location NOT IN (?)
             ORDER BY reserved_quantity DESC, id
             FOR UPDATE`,
            [item.product_id, NON_SELLABLE_LOCATIONS]
        );
        let remaining = item.quantity;
        for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(Number(row.reserved_quantity), remaining);
            await applyRowChange(connection, { inventoryId: row.id, quantity: take, mode, order, item, userId, changes });
            remaining -= take;
        }
        if (remaining > 0) {
            throw anomaly(`producto ${item.product_id}: reserva insuficiente para liberar ${item.quantity} (faltan ${remaining})`);
        }
    }

    if (mode === 'sale') {
        await connection.query(
            "UPDATE order_items SET picked_quantity = quantity WHERE order_id = ? AND COALESCE(picked_quantity, 0) = 0",
            [order.id]
        );
        await connection.query("UPDATE orders SET status = 'completed' WHERE id = ? AND status = 'pending'", [order.id]);
    }
    return changes;
}

async function applyRowChange(connection, { inventoryId, quantity, mode, order, item, userId, changes }) {
    const [[row]] = await connection.query(
        'SELECT id, location, quantity, reserved_quantity FROM inventory WHERE id = ? FOR UPDATE',
        [inventoryId]
    );
    if (!row) throw anomaly(`fila de inventario ${inventoryId} inexistente`);

    const quantityDelta = mode === 'sale' ? quantity : 0;
    const [result] = await connection.query(
        `UPDATE inventory
         SET reserved_quantity = reserved_quantity - ?, quantity = quantity - ?
         WHERE id = ? AND reserved_quantity >= ? AND quantity - ? >= reserved_quantity - ?`,
        [quantity, quantityDelta, inventoryId, quantity, quantityDelta, quantity]
    );
    if (Number(result?.affectedRows) !== 1) {
        throw anomaly(
            `fila ${inventoryId} (${row.location}): cantidad ${row.quantity}, reservado ${row.reserved_quantity}; ` +
            `no se puede ${mode === 'sale' ? 'descontar' : 'liberar'} ${quantity}`
        );
    }
    if (mode === 'sale') {
        await connection.query(
            `INSERT INTO inventory_movements (
                id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by, created_at
            ) VALUES (?, 'sale', ?, ?, ?, 0, ?, 'order', ?, ?, ?)`,
            [crypto.randomUUID(), item.product_id, row.location || 'General', quantity, REPAIR_REASON, order.id, userId, order.created_at]
        );
    }
    changes.push({ inventory_id: inventoryId, product_id: item.product_id, quantity_delta: -quantityDelta, reserved_delta: -quantity });
}

function anomaly(message) {
    const err = new Error(message);
    err.code = 'STOCK_DRIFT_ANOMALY';
    return err;
}
