import crypto from 'crypto';

// Locations whose stock is never sellable.
export const NON_SELLABLE_LOCATIONS = Object.freeze(['Cuarentena', 'Devoluciones a Proveedores', 'Mermas']);

export function buildInsufficientStockError(productName, requestedQty, availableQty) {
    const err = new Error(`Stock insuficiente para ${productName}. Disponible: ${availableQty}, solicitado: ${requestedQty}`);
    err.statusCode = 409;
    err.status = 'fail';
    err.errorCode = 'INSUFFICIENT_STOCK';
    return err;
}

function parsePositiveQuantity(quantity, productName) {
    const parsed = Number.parseInt(String(quantity), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        const err = new Error(`Cantidad invalida para producto ${productName}`);
        err.statusCode = 400;
        err.status = 'fail';
        err.errorCode = 'INVALID_QUANTITY';
        throw err;
    }
    return parsed;
}

/**
 * Stock mutations that preserve the WMS invariants: every change runs inside the
 * caller's transaction, never drives quantity below what is reserved, and writes
 * its inventory movement in the same transaction.
 */
export class StockLedger {
    /**
     * Location codes flagged as sales floor (ADR-015). Read without locking: it only orders
     * rows that are locked separately.
     */
    async salesFloorCodes(connection) {
        const result = await connection.query('SELECT code FROM warehouse_locations WHERE is_sales_floor = 1 AND active = 1');
        const rows = Array.isArray(result?.[0]) ? result[0] : [];
        return new Set(rows.map((row) => row.code));
    }

    /**
     * Orders a product's rows for consumption (ADR-015): the counter sells from the sales
     * floor first; orders are picked in the back, from the warehouse first. Within the same
     * kind of location, the row with more available stock goes first.
     */
    orderByChannel(rows, salesFloor, channel) {
        const floorFirst = channel === 'counter';
        return [...rows].sort((a, b) => {
            const aFloor = salesFloor.has(a.location) ? 1 : 0;
            const bFloor = salesFloor.has(b.location) ? 1 : 0;
            if (aFloor !== bFloor) return floorFirst ? bFloor - aFloor : aFloor - bFloor;
            return available(b) - available(a);
        });
    }

    /**
     * Locks every sellable inventory row of the given products in one statement with a
     * stable order, so two carts with the same products in different order cannot deadlock.
     * @returns {Promise<Map<string, Array<object>>>} rows per product, in consumption order
     * for the channel ('counter': sales floor first; otherwise most available first)
     */
    async lockSellableRows(connection, productIds, { channel = null } = {}) {
        const uniqueIds = [...new Set(productIds)].sort();
        const rowsByProduct = new Map(uniqueIds.map((id) => [id, []]));
        if (uniqueIds.length === 0) return rowsByProduct;

        const [rows] = await connection.query(
            `SELECT id, product_id, location, quantity, reserved_quantity
             FROM inventory
             WHERE product_id IN (?) AND location NOT IN (?)
             ORDER BY product_id, id
             FOR UPDATE`,
            [uniqueIds, NON_SELLABLE_LOCATIONS]
        );
        for (const row of rows) {
            rowsByProduct.get(row.product_id)?.push(row);
        }
        const salesFloor = channel ? await this.salesFloorCodes(connection) : new Set();
        for (const [productId, productRows] of rowsByProduct) {
            rowsByProduct.set(productId, this.orderByChannel(productRows, salesFloor, channel));
        }
        return rowsByProduct;
    }

    /**
     * Deducts physical stock that is not reserved by other orders (a counter sale the
     * customer takes away) and records one 'sale' movement per inventory row touched.
     * `lockedRows` must come from lockSellableRows in the same transaction; they are
     * updated in place so several lines of the same product see the remaining stock.
     */
    async consumeAvailable(connection, lockedRows, {
        productId, productName, quantity, orderId, userId, reason, allowShortage = false,
        movementType = 'sale', referenceType = 'order', unitCost = 0,
    }) {
        const name = productName || productId;
        const requestedQty = parsePositiveQuantity(quantity, name);
        const availableQty = lockedRows.reduce((sum, row) => sum + Math.max(available(row), 0), 0);
        if (availableQty < requestedQty && !allowShortage) {
            throw buildInsufficientStockError(name, requestedQty, availableQty);
        }
        // allowShortage: the goods already left (an offline sale being synced). Take what
        // exists, never below zero, and report the rest so the caller can record it.
        const shortage = Math.max(requestedQty - availableQty, 0);

        let remaining = requestedQty - shortage;
        for (const row of lockedRows) {
            if (remaining <= 0) break;
            const consume = Math.min(Math.max(available(row), 0), remaining);
            if (consume <= 0) continue;

            const [result] = await connection.query(
                `UPDATE inventory
                 SET quantity = quantity - ?
                 WHERE id = ? AND quantity - reserved_quantity >= ?`,
                [consume, row.id, consume]
            );
            if (Number(result?.affectedRows) !== 1) {
                // The row changed under us despite the lock: never clamp, abort the sale.
                throw buildInsufficientStockError(name, requestedQty, availableQty - (requestedQty - remaining));
            }
            row.quantity = Number(row.quantity) - consume;

            await connection.query(
                `INSERT INTO inventory_movements (
                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), movementType, productId, row.location || 'General', consume, unitCost, reason, referenceType, orderId, userId || null]
            );
            remaining -= consume;
        }
        return { consumed: requestedQty - shortage, shortage };
    }
}

function available(row) {
    return Number(row.quantity || 0) - Number(row.reserved_quantity || 0);
}

export default new StockLedger();
