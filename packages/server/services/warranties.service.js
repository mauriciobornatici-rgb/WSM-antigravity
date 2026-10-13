import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';
import { businessError } from '../utils/businessError.js';
import { ACCOUNTS, LOCATIONS } from '../utils/paymentAccounts.js';
import stockLedger from '../domains/inventory/StockLedger.js';
import { allocateCents, grossLineAmounts, lineAmounts } from '../utils/vatMath.js';
import { outputVatLines, splitByRate } from '../utils/vatAccounts.js';
import auditService from './audit.service.js';
import afipService from './afip.service.js';
import accountingService from './accounting.service.js';

class WarrantiesService extends BaseService {
    constructor() {
        super('warranty_claims');
    }

    // The status form sends `notes`; warranty_claims keeps them as resolution_notes
    // (passing `notes` through to the generic update failed every status change).
    // A claim resolved by replacement hands the client a new unit: it leaves stock (at cost)
    // exactly once, in the same transaction as the status change.
    async updateWarrantyStatus(id, body, userId = null, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT * FROM warranty_claims WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]);
            if (rows.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Garantía no encontrada' });
            }
            const previous = rows[0];
            const note = String(body.resolution_notes ?? body.notes ?? '').trim();
            const changes = { status: body.status };
            if ('resolution_type' in body) changes.resolution_type = body.resolution_type;
            if (note) changes.resolution_notes = note;

            const resolutionType = 'resolution_type' in changes ? changes.resolution_type : previous.resolution_type;
            const replacesNow = changes.status === 'resolved' && resolutionType === 'replaced';
            // Every stock effect is decided by what already happened (the claim's movements),
            // not by the previous status: moving a claim back and forth never repeats one.
            const [movementRows] = await connection.query(
                "SELECT type FROM inventory_movements WHERE reference_type = 'warranty_claim' AND reference_id = ?",
                [id]
            );
            const done = new Set(movementRows.map((row) => row.type));
            const alreadyReplaced = done.has('warranty_replacement');
            const productId = previous.product_id;
            const unitCost = productId
                ? (await accountingService.productUnitCosts(connection, [productId])).get(productId) || 0
                : 0;
            const effects = [];

            // The defective unit the client hands in waits in quarantine: it is worth its cost
            // while the supplier may still take it back (ADR-014).
            if (changes.status === 'received' && productId && !done.has('warranty_intake')) {
                await this._moveDefectiveUnit(connection, { claimId: id, productId, to: LOCATIONS.QUARANTINE, type: 'warranty_intake', unitCost, userId, reason: 'Garantía: unidad defectuosa recibida del cliente' });
                await this._postWarranty(connection, id, 'Ingreso de unidad defectuosa en garantía', ACCOUNTS.INVENTORY, ACCOUNTS.WARRANTY_COSTS, unitCost);
                done.add('warranty_intake');
                effects.push('intake');
            }
            const unitIn = done.has('warranty_intake') && !done.has('warranty_writeoff');
            if (changes.status === 'sent_to_supplier' && unitIn && !done.has('warranty_to_supplier')) {
                await this._moveDefectiveUnit(connection, { claimId: id, productId, from: LOCATIONS.QUARANTINE, to: LOCATIONS.SUPPLIER_RETURNS, type: 'warranty_to_supplier', unitCost, userId, reason: 'Garantía: enviada al proveedor' });
                done.add('warranty_to_supplier');
                effects.push('to_supplier');
            }
            // The unit leaves our stock when it is no longer ours to recover: the supplier refused
            // it, the claim was rejected (unit handed back), or it was repaired and handed back.
            // A refunded or replaced claim keeps the defective unit (ours now) for the supplier.
            const handedBack = changes.status === 'rejected'
                || (changes.status === 'resolved' && resolutionType === 'repaired');
            if ((changes.status === 'supplier_rejected' || handedBack) && unitIn) {
                const from = done.has('warranty_to_supplier') ? LOCATIONS.SUPPLIER_RETURNS : LOCATIONS.QUARANTINE;
                const reason = changes.status === 'supplier_rejected'
                    ? 'Garantía rechazada por el proveedor: baja'
                    : (changes.status === 'rejected' ? 'Garantía rechazada: unidad devuelta al cliente' : 'Garantía reparada: unidad devuelta al cliente');
                // At the cost it came in with, so intake and write-off cancel exactly.
                const [intake] = await connection.query(
                    "SELECT unit_cost FROM inventory_movements WHERE reference_type = 'warranty_claim' AND reference_id = ? AND type = 'warranty_intake' LIMIT 1",
                    [id]
                );
                const intakeCost = Number(intake[0]?.unit_cost ?? unitCost);
                await this._moveDefectiveUnit(connection, { claimId: id, productId, from, type: 'warranty_writeoff', unitCost: intakeCost, userId, reason });
                await this._postWarranty(connection, id, reason, ACCOUNTS.WARRANTY_COSTS, ACCOUNTS.INVENTORY, intakeCost);
                effects.push('writeoff');
            }

            let replacement = null;
            if (replacesNow && !alreadyReplaced) {
                if (!previous.product_id) {
                    throw businessError(409, { error: 'warranty_without_product', message: 'La garantía no tiene producto para reemplazar.' });
                }
                const locked = await stockLedger.lockSellableRows(connection, [previous.product_id]);
                await stockLedger.consumeAvailable(connection, locked.get(previous.product_id) || [], {
                    productId: previous.product_id,
                    quantity: 1,
                    orderId: id,
                    userId,
                    reason: 'Reemplazo por garantía',
                    movementType: 'warranty_replacement',
                    referenceType: 'warranty_claim',
                    unitCost,
                });
                await this._postWarranty(connection, id, 'Reemplazo de producto por garantía', ACCOUNTS.WARRANTY_COSTS, ACCOUNTS.INVENTORY, unitCost);
                replacement = { quantity: 1, unit_cost: unitCost };
            }

            const sets = Object.keys(changes).map((key) => `${key} = ?`).join(', ');
            await connection.query(`UPDATE warranty_claims SET ${sets} WHERE id = ?`, [...Object.values(changes), id]);
            await auditService.log({
                user_id: userId,
                action: 'UPDATE_WARRANTY_STATUS',
                entity_type: 'warranty_claim',
                entity_id: id,
                old_values: { status: previous.status, resolution_type: previous.resolution_type ?? null },
                new_values: { ...changes, ...(replacement ? { replacement } : {}), ...(effects.length ? { stock_effects: effects } : {}) },
                ip_address: ipAddress
            }, connection);
            const [updated] = await connection.query('SELECT * FROM warranty_claims WHERE id = ?', [id]);
            await connection.commit();
            return updated[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async _postWarranty(connection, claimId, description, debitAccount, creditAccount, amount) {
        await accountingService.createJournalEntryIfAny(connection, {
            date: new Date(),
            description,
            reference_type: 'warranty_claim',
            reference_id: claimId,
            lines: [
                { account_code: debitAccount, debit: amount, credit: 0, notes: description },
                { account_code: creditAccount, debit: 0, credit: amount, notes: description },
            ],
        });
    }

    // Moves the claim's single defective unit between non-sellable locations (or in/out of
    // stock), never below what is reserved, with a movement that records where it went.
    async _moveDefectiveUnit(connection, { claimId, productId, from = null, to = null, type, unitCost, userId, reason }) {
        if (from) {
            const [taken] = await connection.query(
                `UPDATE inventory SET quantity = quantity - 1
                 WHERE product_id = ? AND location = ? AND quantity - reserved_quantity >= 1`,
                [productId, from]
            );
            if (Number(taken?.affectedRows) !== 1) {
                throw businessError(409, {
                    error: 'warranty_unit_not_found',
                    message: `La unidad de la garantía ya no está en ${from}: revisá el stock antes de continuar.`
                });
            }
        }
        if (to) {
            await connection.query(
                `INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE quantity = quantity + 1`,
                [crypto.randomUUID(), productId, to]
            );
        }
        await connection.query(
            `INSERT INTO inventory_movements (
                id, type, product_id, from_location, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'warranty_claim', ?, ?)`,
            [crypto.randomUUID(), type, productId, from, to, unitCost, reason, claimId, userId || null]
        );
    }

    async getWarranties(filters = {}) {
        let query = `
            SELECT w.*, c.name AS client_name, p.name AS product_name, p.sku
            FROM warranty_claims w
            LEFT JOIN clients c ON w.client_id = c.id
            LEFT JOIN products p ON w.product_id = p.id
            WHERE (w.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND w.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND w.status = ?';
            params.push(filters.status);
        }

        query += ' ORDER BY w.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createWarranty(data) {
        const payload = { id: data.id || crypto.randomUUID(), ...data };
        return super.create(payload);
    }
}

class ReturnsService extends BaseService {
    constructor() {
        super('client_returns');
    }

    _buildDomainError(message, errorCode, statusCode = 400) {
        const err = new Error(message);
        err.errorCode = errorCode;
        err.statusCode = statusCode;
        err.status = 'fail';
        return err;
    }

    async _nextCreditNoteNumber(connection) {
        const year = new Date().getFullYear();
        const prefix = `NC-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM credit_notes
             WHERE number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `credit_note:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    // Location a returned sellable unit goes back to: where the sale took it from.
    async _returnLocationFor(connection, orderId, productId) {
        if (!orderId) return 'General';
        const [rows] = await connection.query(
            `SELECT from_location FROM inventory_movements
             WHERE reference_id = ? AND product_id = ? AND type = 'sale' AND from_location IS NOT NULL
             ORDER BY quantity DESC LIMIT 1`,
            [orderId, productId]
        );
        return rows[0]?.from_location || 'General';
    }

    async _increaseInventoryForReturn(connection, { returnId, item, actorUserId, orderId = null, unitCost = 0 }) {
        const quantity = Number(item.quantity || 0);
        if (quantity <= 0) return { restocked: 0, discarded: 0, reentered: 0, lost: 0 };

        const condition = String(item.condition_status || 'sellable').toLowerCase();

        let targetLocation = null;
        let movementType = 'damage';
        let movementReason = '';

        if (condition === 'sellable') {
            targetLocation = await this._returnLocationFor(connection, orderId, item.product_id);
            movementType = 'return';
            movementReason = 'Devolución de cliente - Reingreso a stock';
        } else if (condition === 'supplier_rma') {
            targetLocation = 'Devoluciones a Proveedores';
            movementType = 'return';
            movementReason = 'Devolución de cliente - A enviar a proveedor';
        } else if (condition === 'loss') {
            targetLocation = null;
            movementType = 'damage';
            movementReason = 'Devolución de cliente - Pérdida asumida';
        } else if (condition === 'rejected') {
            targetLocation = null;
            movementType = 'rejected';
            movementReason = 'Devolución de cliente - Rechazada sin garantía';
        }

        if (targetLocation) {
            const [existingInventory] = await connection.query(
                'SELECT id FROM inventory WHERE product_id = ? AND location = ? LIMIT 1 FOR UPDATE',
                [item.product_id, targetLocation]
            );

            if (existingInventory.length > 0) {
                await connection.query(
                    'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                    [quantity, existingInventory[0].id]
                );
            } else {
                await connection.query(
                    'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                    [crypto.randomUUID(), item.product_id, targetLocation, quantity]
                );
            }
        }

        await connection.query(
            `INSERT INTO inventory_movements (
                id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'client_return', ?, ?)`,
            [
                crypto.randomUUID(),
                movementType,
                item.product_id,
                targetLocation,
                quantity,
                Number(unitCost || 0),
                movementReason,
                returnId,
                actorUserId || null
            ]
        );

        const sellable = condition === 'sellable';
        return {
            restocked: sellable ? quantity : 0,
            discarded: sellable ? 0 : quantity,
            // For the cost entry: units back in stock vs. units lost (a rejected line is not taken back).
            reentered: targetLocation ? quantity : 0,
            lost: !targetLocation && condition !== 'rejected' ? quantity : 0
        };
    }

    async getReturns(filters = {}) {
        let query = `
            SELECT r.*, c.name AS client_name, o.id AS order_number
            FROM client_returns r
            LEFT JOIN clients c ON r.client_id = c.id
            LEFT JOIN orders o ON r.order_id = o.id
            WHERE (r.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND r.client_id = ?';
            params.push(filters.client_id);
        }
        if (filters.status) {
            query += ' AND r.status = ?';
            params.push(filters.status);
        }

        query += ' ORDER BY r.created_at DESC';
        const [rows] = await pool.query(query, params);

        if (rows.length === 0) return rows;

        const returnIds = rows.map((r) => r.id);
        const [items] = await pool.query(`
            SELECT i.*, p.name AS product_name, p.sku
            FROM client_return_items i
            LEFT JOIN products p ON i.product_id = p.id
            WHERE i.return_id IN (?)
        `, [returnIds]);

        return rows.map((r) => ({
            ...r,
            items: items.filter((i) => i.return_id === r.id)
        }));
    }

    async getReturnsAnalytics() {
        const conn = await pool.getConnection();
        try {
            // Rate of returns (loss and rejected) by product
            const [productStats] = await conn.query(`
                SELECT p.name as product_name, p.sku,
                       SUM(CASE WHEN i.condition_status IN ('loss', 'rejected') THEN i.quantity ELSE 0 END) as defective_quantity,
                       SUM(i.quantity) as total_returned_quantity
                FROM client_return_items i
                JOIN products p ON i.product_id = p.id
                JOIN client_returns r ON i.return_id = r.id
                WHERE r.status = 'approved'
                GROUP BY i.product_id
                ORDER BY defective_quantity DESC
                LIMIT 5
            `);

            // Returns by reason
            const [reasonStats] = await conn.query(`
                SELECT r.reason, COUNT(*) as count
                FROM client_returns r
                WHERE r.status = 'approved' AND r.reason IS NOT NULL AND r.reason != ''
                GROUP BY r.reason
                ORDER BY count DESC
                LIMIT 5
            `);

            // Total financial loss
            const [lossStats] = await conn.query(`
                SELECT COALESCE(SUM(i.quantity * i.unit_price), 0) as total_loss_amount
                FROM client_return_items i
                JOIN client_returns r ON i.return_id = r.id
                WHERE r.status = 'approved' AND i.condition_status IN ('loss', 'rejected')
            `);

            return {
                topDefectiveProducts: productStats,
                topReasons: reasonStats,
                totalLossAmount: Number(lossStats[0]?.total_loss_amount || 0)
            };
        } finally {
            conn.release();
        }
    }

    /**
     * Net unit price of each returned product, never taken from the client (H4):
     * the price it was sold at when the return references an order (and the returned
     * quantity cannot exceed what was sold minus earlier returns), else the catalog price.
     */
    async _resolveReturnPrices(conn, data) {
        const requestedByProduct = new Map();
        for (const item of data.items) {
            const quantity = Number(item.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                throw this._buildDomainError('Cantidad inválida en la devolución', 'INVALID_QUANTITY', 400);
            }
            requestedByProduct.set(item.product_id, (requestedByProduct.get(item.product_id) || 0) + quantity);
        }
        const productIds = [...requestedByProduct.keys()];

        if (!data.order_id) {
            const [products] = await conn.query('SELECT id, sale_price FROM products WHERE id IN (?)', [productIds]);
            const prices = new Map(products.map((product) => [product.id, Number(product.sale_price || 0)]));
            for (const productId of productIds) {
                if (!prices.has(productId)) {
                    throw this._buildDomainError(`Producto no encontrado: ${productId}`, 'PRODUCT_NOT_FOUND', 404);
                }
            }
            return prices;
        }

        // Serializes returns of the same order so two of them cannot both pass the check.
        const [orders] = await conn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [data.order_id]);
        if (orders.length === 0) {
            throw this._buildDomainError('Pedido no encontrado', 'ORDER_NOT_FOUND', 404);
        }
        const [sold] = await conn.query(
            // Weighted average: the same product may appear on several lines at different prices.
            `SELECT product_id, SUM(quantity) AS quantity,
                    -- 4 decimals like the stored net price (ADR-015): 2 would refund a cent short.
                    ROUND(SUM(quantity * unit_price) / NULLIF(SUM(quantity), 0), 4) AS unit_price
             FROM order_items WHERE order_id = ? AND product_id IN (?)
             GROUP BY product_id`,
            [data.order_id, productIds]
        );
        const [returned] = await conn.query(
            `SELECT ri.product_id, SUM(ri.quantity) AS quantity
             FROM client_return_items ri
             JOIN client_returns r ON r.id = ri.return_id
             WHERE r.order_id = ? AND r.status NOT IN ('rejected', 'cancelled') AND ri.product_id IN (?)
               -- a rejected unit was not refunded: it does not use up the returnable quantity
               AND LOWER(COALESCE(ri.condition_status, '')) <> 'rejected'
             GROUP BY ri.product_id`,
            [data.order_id, productIds]
        );
        const soldByProduct = new Map(sold.map((row) => [row.product_id, row]));
        const returnedByProduct = new Map(returned.map((row) => [row.product_id, Number(row.quantity || 0)]));
        // Once invoiced, what can come back is what was invoiced (a partially picked order
        // delivered and charged fewer units than it ordered).
        const [invoicedRows] = await conn.query(
            `SELECT ii.product_id, SUM(ii.quantity) AS quantity
             FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
             WHERE i.order_id = ? AND i.deleted_at IS NULL AND ii.product_id IN (?)
             GROUP BY ii.product_id`,
            [data.order_id, productIds]
        );
        const invoicedByProduct = invoicedRows.length > 0
            ? new Map(invoicedRows.map((row) => [row.product_id, Number(row.quantity || 0)]))
            : null;

        const prices = new Map();
        for (const [productId, requested] of requestedByProduct) {
            const soldRow = soldByProduct.get(productId);
            const delivered = invoicedByProduct ? (invoicedByProduct.get(productId) || 0) : Number(soldRow?.quantity || 0);
            const returnable = delivered - (returnedByProduct.get(productId) || 0);
            if (requested > returnable) {
                throw this._buildDomainError(
                    `No se puede devolver ${requested} unidad(es) del producto ${productId}: quedan ${Math.max(returnable, 0)} por devolver de ese pedido.`,
                    'RETURN_EXCEEDS_SOLD',
                    409
                );
            }
            prices.set(productId, Number(soldRow.unit_price || 0));
        }
        return prices;
    }

    async createReturn(data) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const returnId = crypto.randomUUID();
            await conn.query(
                `INSERT INTO client_returns (id, client_id, customer_name, order_id, reason, status, refund_shipping, created_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW())`,
                [returnId, data.client_id || null, data.customer_name || null, data.order_id || null, data.reason || null,
                    data.refund_shipping && data.order_id ? 1 : 0]
            );

            if (data.items && data.items.length > 0) {
                const unitPrices = await this._resolveReturnPrices(conn, data);
                const values = data.items.map((item) => [
                    crypto.randomUUID(),
                    returnId,
                    item.product_id,
                    item.quantity,
                    item.condition_status || 'sellable',
                    unitPrices.get(item.product_id)
                ]);
                await conn.query(
                    `INSERT INTO client_return_items (id, return_id, product_id, quantity, condition_status, unit_price) VALUES ?`,
                    [values]
                );

                const [totals] = await conn.query(
                    `SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM client_return_items WHERE return_id = ?`,
                    [returnId]
                );
                await conn.query('UPDATE client_returns SET total_amount = ? WHERE id = ?', [totals[0].total, returnId]);
            }

            await conn.commit();
            return { id: returnId };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    /**
     * What each returned line refunds (ADR-016). A product refunds its share of what was charged
     * for it (the invoice lines, or the order lines before invoicing), after the discounts of its
     * VAT rate. Shares are cumulative over the order's approved returns: unit k of Q refunds
     * round(G·k/Q) − round(G·(k−1)/Q), so returning every unit, one by one or all at once, adds
     * up to exactly G and never more. Returns [{ item, gross, vat, vat_rate }] for non-rejected lines.
     */
    async _returnRefunds(conn, returnRow, items) {
        const active = items.filter((item) => String(item.condition_status).toLowerCase() !== 'rejected');
        if (active.length === 0) return [];
        const productIds = [...new Set(active.map((item) => item.product_id))];
        const [vatRows] = await conn.query('SELECT id, vat_rate FROM products WHERE id IN (?)', [productIds]);
        const vatByProduct = new Map(vatRows.map((row) => [row.id, row.vat_rate == null ? 21 : Number(row.vat_rate)]));
        const perUnit = (item) => {
            const rate = vatByProduct.get(item.product_id) ?? 21;
            const line = lineAmounts(item.quantity, item.unit_price, rate);
            return { item, gross: line.gross, vat: line.vat, vat_rate: rate };
        };
        if (!returnRow.order_id) return active.map(perUnit);

        // Serializes approvals of the same order: the cumulative shares need the previous ones.
        await conn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [returnRow.order_id]);
        const [invoices] = await conn.query(
            'SELECT id FROM invoices WHERE order_id = ? AND deleted_at IS NULL LIMIT 1',
            [returnRow.order_id]
        );
        let charged;
        let discounts;
        if (invoices[0]) {
            [charged] = await conn.query(
                `SELECT product_id, vat_rate, SUM(quantity) AS quantity, SUM(total_line) AS gross, SUM(vat_amount) AS vat
                 FROM invoice_items WHERE invoice_id = ? AND product_id IS NOT NULL GROUP BY product_id, vat_rate`,
                [invoices[0].id]
            );
            [discounts] = await conn.query(
                `SELECT vat_rate, SUM(total_line) AS gross, SUM(vat_amount) AS vat
                 FROM invoice_items WHERE invoice_id = ? AND product_id IS NULL AND total_line < 0
                   AND COALESCE(adjustment_kind, 'discount') = 'discount' GROUP BY vat_rate`,
                [invoices[0].id]
            );
        } else {
            const [orderLines] = await conn.query(
                `SELECT oi.product_id, COALESCE(oi.vat_rate, p.vat_rate, 21) AS vat_rate, oi.quantity, oi.unit_price
                 FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
                [returnRow.order_id]
            );
            const byProduct = new Map();
            for (const line of orderLines) {
                const amounts = lineAmounts(line.quantity, line.unit_price, line.vat_rate);
                const row = byProduct.get(line.product_id) || { product_id: line.product_id, vat_rate: Number(line.vat_rate), quantity: 0, gross: 0, vat: 0 };
                row.quantity += Number(line.quantity);
                row.gross += amounts.gross;
                row.vat += amounts.vat;
                byProduct.set(line.product_id, row);
            }
            charged = [...byProduct.values()];
            // Same split of each discount as the invoice will make (grossLineAmounts).
            const [adjustments] = await conn.query(
                "SELECT amount, vat_rate FROM order_adjustments WHERE order_id = ? AND amount < 0 AND billable = 1 AND kind = 'discount'",
                [returnRow.order_id]
            );
            const byRate = new Map();
            for (const adjustment of adjustments) {
                const amounts = grossLineAmounts(adjustment.amount, adjustment.vat_rate);
                const rate = Number(adjustment.vat_rate);
                const row = byRate.get(rate) || { vat_rate: rate, gross: 0, vat: 0 };
                row.gross += amounts.gross;
                row.vat += amounts.vat;
                byRate.set(rate, row);
            }
            discounts = [...byRate.values()];
        }

        // What each product was really charged: the discounts of a rate are split over the
        // products of that rate by the largest remainder, so the products add up exactly to
        // what the invoice charged for that rate (a rounded factor could add a cent).
        const discountByRate = new Map(discounts.map((row) => [Number(row.vat_rate), row]));
        const chargedByProduct = new Map();
        const rates = [...new Set(charged.map((row) => Number(row.vat_rate)))];
        for (const rate of rates) {
            const rows = charged.filter((row) => Number(row.vat_rate) === rate);
            const discount = discountByRate.get(rate);
            const grossCents = rows.map((row) => Math.round(Number(row.gross) * 100));
            const vatCents = rows.map((row) => Math.round(Number(row.vat) * 100));
            const grossOff = allocateCents(Math.max(Math.round(Number(discount?.gross || 0) * 100), -grossCents.reduce((a, b) => a + b, 0)), grossCents);
            const vatOff = allocateCents(Math.max(Math.round(Number(discount?.vat || 0) * 100), -vatCents.reduce((a, b) => a + b, 0)), grossCents);
            rows.forEach((row, index) => {
                const previous = chargedByProduct.get(row.product_id);
                chargedByProduct.set(row.product_id, {
                    vat_rate: rate,
                    quantity: (previous?.quantity || 0) + Number(row.quantity),
                    grossCents: (previous?.grossCents || 0) + grossCents[index] + grossOff[index],
                    vatCents: (previous?.vatCents || 0) + vatCents[index] + vatOff[index],
                });
            });
        }

        const [previousRows] = await conn.query(
            `SELECT ri.product_id, SUM(ri.quantity) AS quantity,
                    SUM(ri.refund_amount) AS refunded, SUM(ri.refund_vat) AS refunded_vat,
                    SUM(ri.refund_amount IS NULL) AS legacy_lines
             FROM client_return_items ri JOIN client_returns r ON r.id = ri.return_id
             WHERE r.order_id = ? AND r.id <> ? AND r.status = 'approved'
               AND LOWER(COALESCE(ri.condition_status, '')) <> 'rejected'
             GROUP BY ri.product_id`,
            [returnRow.order_id, returnRow.id]
        );
        const refundedBefore = new Map(previousRows.map((row) => [row.product_id, row]));

        const refunds = [];
        for (const productId of productIds) {
            const lines = active.filter((item) => item.product_id === productId);
            const quantity = lines.reduce((sum, item) => sum + Number(item.quantity), 0);
            const sold = chargedByProduct.get(productId);
            const previous = refundedBefore.get(productId);
            const before = Number(previous?.quantity || 0);
            // (An invoice with no product lines, as old ones may be, falls back to the order.)
            if (invoices[0] && charged.length > 0 && (!sold || before + quantity > sold.quantity)) {
                // Once invoiced, only what was invoiced comes back (a partial picking delivered less).
                throw businessError(409, {
                    error: 'return_exceeds_invoiced',
                    message: 'La devolución supera las unidades facturadas de ese producto.'
                });
            }
            if (!sold || !(sold.quantity > 0) || before + quantity > sold.quantity) {
                refunds.push(...lines.map(perUnit));
                continue;
            }
            const share = (cents, units) => Math.round(cents * units / sold.quantity);
            let grossCents = share(sold.grossCents, before + quantity) - share(sold.grossCents, before);
            let vatCents = share(sold.vatCents, before + quantity) - share(sold.vatCents, before);
            if (before + quantity === sold.quantity && previous && Number(previous.legacy_lines || 0) === 0) {
                // The last units return exactly what is left of the charge: earlier refunds,
                // whatever their rounding, plus this one add up to what was charged.
                grossCents = Math.max(0, sold.grossCents - Math.round(Number(previous.refunded || 0) * 100));
                vatCents = Math.max(0, sold.vatCents - Math.round(Number(previous.refunded_vat || 0) * 100));
            }
            // Several lines of the same product (sellable / damaged): split by quantity.
            let grossLeft = grossCents;
            let vatLeft = vatCents;
            let unitsLeft = quantity;
            for (const item of lines) {
                const units = Number(item.quantity);
                const lineGross = units === unitsLeft ? grossLeft : Math.round(grossLeft * units / unitsLeft);
                const lineVat = units === unitsLeft ? vatLeft : Math.round(vatLeft * units / unitsLeft);
                grossLeft -= lineGross;
                vatLeft -= lineVat;
                unitsLeft -= units;
                refunds.push({ item, gross: lineGross / 100, vat: lineVat / 100, vat_rate: sold.vat_rate });
            }
        }
        return refunds;
    }

    /**
     * The shipping a return gives back (ADR-017): what the customer was charged for it (the
     * invoice's shipping lines net of shipping discounts, or the order's before invoicing) minus
     * what earlier approved returns of the order already gave back. Null when nothing is left.
     */
    async _shippingRefund(conn, returnRow) {
        if (!returnRow.order_id) return null;
        // Serializes with other approvals of the order: the shipping is given back once.
        await conn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [returnRow.order_id]);
        const [invoices] = await conn.query(
            'SELECT id FROM invoices WHERE order_id = ? AND deleted_at IS NULL LIMIT 1',
            [returnRow.order_id]
        );
        let lines;
        if (invoices[0]) {
            [lines] = await conn.query(
                `SELECT vat_rate, total_line AS gross, vat_amount AS vat FROM invoice_items
                 WHERE invoice_id = ? AND product_id IS NULL
                   AND (adjustment_kind IN ('shipping', 'shipping_discount')
                        OR (adjustment_kind IS NULL AND (description = 'Envío' OR description LIKE 'Envío (%')))`,
                [invoices[0].id]
            );
        } else {
            const [rows] = await conn.query(
                `SELECT amount, vat_rate FROM order_adjustments
                 WHERE order_id = ? AND billable = 1 AND kind IN ('shipping', 'shipping_discount')`,
                [returnRow.order_id]
            );
            lines = rows.map((row) => ({ vat_rate: row.vat_rate, ...grossLineAmounts(row.amount, row.vat_rate) }));
        }
        const grossCents = lines.reduce((sum, line) => sum + Math.round(Number(line.gross) * 100), 0);
        const vatCents = lines.reduce((sum, line) => sum + Math.round(Number(line.vat) * 100), 0);
        if (grossCents <= 0) return null;
        const [[refunded]] = await conn.query(
            `SELECT COALESCE(SUM(shipping_refund_amount), 0) AS gross, COALESCE(SUM(shipping_refund_vat), 0) AS vat
             FROM client_returns WHERE order_id = ? AND id <> ? AND status = 'approved'`,
            [returnRow.order_id, returnRow.id]
        );
        const leftGross = grossCents - Math.round(Number(refunded?.gross || 0) * 100);
        if (leftGross <= 0) return null;
        const leftVat = Math.max(0, vatCents - Math.round(Number(refunded?.vat || 0) * 100));
        const mainLine = [...lines].sort((a, b) => Number(b.gross) - Number(a.gross))[0];
        return { gross: leftGross / 100, vat: leftVat / 100, vat_rate: Number(mainLine?.vat_rate ?? 21) };
    }

    async approveReturn(returnId, actorUserId, ipAddress = null) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [returns] = await conn.query(
                'SELECT * FROM client_returns WHERE id = ? FOR UPDATE',
                [returnId]
            );
            if (returns.length === 0) {
                throw this._buildDomainError('Devolucion no encontrada', 'RETURN_NOT_FOUND', 404);
            }

            const returnRow = returns[0];
            if (returnRow.status === 'approved') {
                throw this._buildDomainError('La devolucion ya fue aprobada', 'RETURN_ALREADY_APPROVED', 409);
            }
            if (returnRow.status === 'rejected' || returnRow.status === 'cancelled') {
                throw this._buildDomainError('La devolucion no puede aprobarse en su estado actual', 'RETURN_INVALID_STATE', 400);
            }

            const [items] = await conn.query(
                'SELECT * FROM client_return_items WHERE return_id = ? FOR UPDATE',
                [returnId]
            );
            if (items.length === 0) {
                throw this._buildDomainError('La devolucion no tiene items', 'RETURN_WITHOUT_ITEMS', 400);
            }
            // The order is locked before any plain read (AUD-006): under REPEATABLE READ the first
            // plain read fixes the snapshot, so a lock taken after it would still sum the refunds
            // and credit notes of an approval that committed meanwhile with stale data.
            if (returnRow.order_id) {
                await conn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [returnRow.order_id]);
            }

            // The refund reverses what the customer paid for those units (ADR-016): exact to the
            // cent across partial returns, discounts included. Stored per line for the note.
            const refunds = await this._returnRefunds(conn, returnRow, items);
            let refundCents = 0;
            for (const refund of refunds) {
                refundCents += Math.round(refund.gross * 100);
                await conn.query(
                    'UPDATE client_return_items SET refund_amount = ?, refund_vat = ? WHERE id = ?',
                    [refund.gross, refund.vat, refund.item.id]
                );
            }
            // ADR-017: the shipping is given back only when the return says so, and only what is
            // left of it (an earlier return may have refunded it already).
            const shipping = returnRow.refund_shipping ? await this._shippingRefund(conn, returnRow) : null;
            if (shipping) {
                refundCents += Math.round(shipping.gross * 100);
                await conn.query(
                    'UPDATE client_returns SET shipping_refund_amount = ?, shipping_refund_vat = ?, shipping_refund_rate = ? WHERE id = ?',
                    [shipping.gross, shipping.vat, shipping.vat_rate, returnId]
                );
            }
            const totalAmount = refundCents / 100;
            
            // It's possible that a return ONLY has rejected items, then totalAmount = 0
            // If totalAmount is 0, we just approve it without creating a Credit Note.
            
            let restockedTotal = 0;
            let discardedTotal = 0;
            let reenteredCost = 0;
            let lostCost = 0;
            const unitCosts = await accountingService.productUnitCosts(conn, items.map((item) => item.product_id));
            for (const item of items) {
                // The cost recorded when it was sold (the CMV was posted at that cost);
                // today's cost only for sales recorded before movements carried it.
                let unitCost = unitCosts.get(item.product_id) || 0;
                if (returnRow.order_id) {
                    const [sold] = await conn.query(
                        `SELECT SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0) AS cost
                         FROM inventory_movements
                         WHERE reference_id = ? AND product_id = ? AND type = 'sale' AND unit_cost > 0`,
                        [returnRow.order_id, item.product_id]
                    );
                    const soldCost = Number(sold?.[0]?.cost || 0);
                    if (soldCost > 0) unitCost = Math.round(soldCost * 100) / 100;
                }
                const impact = await this._increaseInventoryForReturn(conn, {
                    returnId,
                    item,
                    actorUserId,
                    orderId: returnRow.order_id || null,
                    unitCost
                });
                restockedTotal += impact.restocked;
                discardedTotal += impact.discarded;
                reenteredCost += unitCost * (impact.reentered || 0);
                lostCost += unitCost * (impact.lost || 0);
            }

            // The sale moved the cost to CMV; undo it for what came back. Units back in stock
            // return to Inventory; units lost are reclassified as inventory losses. Only when
            // the original sale posted its CMV, otherwise there is nothing to reverse.
            if (returnRow.order_id && (reenteredCost > 0 || lostCost > 0)) {
                const [cmvPosted] = await conn.query(
                    `SELECT je.id FROM journal_entries je
                     JOIN invoices i ON i.id = je.reference_id AND je.reference_type = 'invoice' AND i.deleted_at IS NULL
                     JOIN journal_entry_lines jl ON jl.journal_entry_id = je.id AND jl.account_code = ?
                     WHERE i.order_id = ? LIMIT 1`,
                    [ACCOUNTS.COGS, returnRow.order_id]
                );
                if (cmvPosted.length > 0) {
                    await accountingService.createJournalEntryIfAny(conn, {
                        date: new Date(),
                        description: 'Reversión de costo por devolución de cliente',
                        reference_type: 'client_return',
                        reference_id: returnId,
                        lines: [
                            { account_code: ACCOUNTS.INVENTORY, debit: reenteredCost, credit: 0, notes: 'Mercadería reingresada al costo' },
                            { account_code: ACCOUNTS.INVENTORY_LOSSES, debit: lostCost, credit: 0, notes: 'Mercadería devuelta no recuperable' },
                            { account_code: ACCOUNTS.COGS, debit: 0, credit: reenteredCost + lostCost, notes: 'Reversión de CMV' }
                        ]
                    });
                }
            }

            let creditNoteId = null;
            let creditNoteNumber = null;

            if (totalAmount > 0) {
                creditNoteId = crypto.randomUUID();
                creditNoteNumber = await this._nextCreditNoteNumber(conn);

                let pointOfSale = 1;
                const [compRows] = await conn.query('SELECT billing_pos FROM company_settings LIMIT 1');
                if (compRows.length > 0 && compRows[0].billing_pos) {
                    pointOfSale = Number(compRows[0].billing_pos) || 1;
                }

                // A credit note carries the same letter as the invoice it corrects (A→A, C→C).
                // clients has no tax-condition column: reading one made every approval fail.
                let creditNoteType = 'B';
                let invoiceId = null;
                if (returnRow.order_id) {
                    const [invoices] = await conn.query(
                        'SELECT id, invoice_type, total_amount FROM invoices WHERE order_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                        [returnRow.order_id]
                    );
                    invoiceId = invoices[0]?.id || null;
                    const invoiceType = String(invoices[0]?.invoice_type || '').toUpperCase();
                    if (invoiceType === 'A' || invoiceType === 'C') creditNoteType = invoiceType;
                    if (invoiceId) {
                        // Same cap as a manual note (ADR-014): the notes on an invoice never exceed it.
                        const [creditedRows] = await conn.query(
                            `SELECT COALESCE(SUM(amount), 0) AS credited FROM credit_notes
                             WHERE invoice_id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'cancelled')`,
                            [invoiceId]
                        );
                        const creditable = Math.round((Number(invoices[0].total_amount || 0) - Number(creditedRows[0]?.credited || 0)) * 100) / 100;
                        if (totalAmount > creditable + 0.001) {
                            throw businessError(409, {
                                error: 'exceeds_invoice_balance',
                                message: `La devolución supera lo que queda acreditable de la factura (${creditable.toFixed(2)}): ya tiene notas de crédito.`,
                                creditable
                            });
                        }
                    }
                }

                await conn.query(
                    `INSERT INTO credit_notes (
                        id, number, client_id, point_of_sale, credit_note_type, customer_name, reference_type, reference_id, amount, status, notes, invoice_id
                    ) VALUES (?, ?, ?, ?, ?, ?, 'return', ?, ?, 'issued', ?, ?)`,
                    [
                        creditNoteId,
                        creditNoteNumber,
                        returnRow.client_id || null,
                        pointOfSale,
                        creditNoteType,
                        returnRow.customer_name || null,
                        returnId,
                        totalAmount,
                        `Generada automaticamente por aprobacion de devolucion ${returnId}`,
                        invoiceId
                    ]
                );

                await conn.query(
                    `INSERT INTO transactions (id, type, amount, description, reference_id, client_id, date)
                     VALUES (?, 'adjustment', ?, ?, ?, ?, NOW())`,
                    [
                        crypto.randomUUID(),
                        totalAmount,
                        `Nota de credito ${creditNoteNumber} por devolucion de cliente`,
                        creditNoteId,
                        returnRow.client_id || null
                    ]
                );

                if (returnRow.client_id) {
                    await conn.query(
                        `UPDATE clients
                         SET current_account_balance = COALESCE(current_account_balance, 0) - ?
                         WHERE id = ?`,
                        [totalAmount, returnRow.client_id]
                    );
                }

                await accountingService.createJournalEntry(conn, {
                    date: new Date(),
                    description: `Nota de crédito ${creditNoteNumber} - Devolución de cliente`,
                    reference_type: 'client_return',
                    reference_id: returnId,
                    // Mirror of the sale entry (accounting.service): Clientes / Ventas + IVA Débito
                    // Fiscal per rate (none on a type C note).
                    lines: (() => {
                        const vatLines = outputVatLines(
                            [...refunds, ...(shipping ? [shipping] : [])].map((refund) => ({ vat_rate: refund.vat_rate, vat: refund.vat })),
                            { side: 'debit', voucherType: creditNoteType, notes: 'Reversión de IVA Débito Fiscal' }
                        );
                        const reversedVat = vatLines.reduce((sum, line) => sum + line.debit, 0);
                        return [
                            { account_code: '4.1.01.01', debit: Math.round((totalAmount - reversedVat) * 100) / 100, credit: 0, notes: 'Reversión de venta por devolución' },
                            ...vatLines,
                            { account_code: '1.1.03.01', debit: 0, credit: totalAmount, notes: 'Crédito a favor del cliente' }
                        ];
                    })()
                });
            }

            await conn.query(
                'UPDATE client_returns SET status = "approved", total_amount = ? WHERE id = ?',
                [totalAmount, returnId]
            );

            const result = {
                success: true,
                return_id: returnId,
                credit_note_id: creditNoteId,
                credit_note_number: creditNoteNumber,
                total_amount: totalAmount,
                shipping_refund_amount: shipping?.gross || 0,
                restocked_quantity: restockedTotal,
                discarded_quantity: discardedTotal
            };
            await auditService.log({
                user_id: actorUserId,
                action: 'APPROVE_CLIENT_RETURN',
                entity_type: 'client_return',
                entity_id: returnId,
                old_values: { status: returnRow.status },
                new_values: result,
                ip_address: ipAddress
            }, conn);
            await conn.commit();
            return result;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

class CreditNotesService extends BaseService {
    constructor() {
        super('credit_notes');
    }

    async getCreditNotes(filters = {}) {
        let query = `
            SELECT cn.*, c.name AS client_name
            FROM credit_notes cn
            LEFT JOIN clients c ON cn.client_id = c.id
            WHERE (cn.deleted_at IS NULL)
        `;
        const params = [];

        if (filters.client_id) {
            query += ' AND cn.client_id = ?';
            params.push(filters.client_id);
        }

        query += ' ORDER BY cn.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    // The invoice a note corrects: linked directly (ADR-014) or, for return notes issued
    // before the link existed, through the return's order.
    async _invoiceCorrectedBy(cn) {
        if (cn.invoice_id) {
            const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL', [cn.invoice_id]);
            return rows[0] || null;
        }
        if (cn.reference_type === 'return' && cn.reference_id) {
            const [rows] = await pool.query(
                `SELECT i.* FROM client_returns r JOIN invoices i ON i.order_id = r.order_id AND i.deleted_at IS NULL
                 WHERE r.id = ? LIMIT 1`,
                [cn.reference_id]
            );
            return rows[0] || null;
        }
        return null;
    }

    // Voucher lines: the returned items for a return note; otherwise the note's amount split
    // across the invoice's VAT rates in the same proportion as the invoice.
    async _creditNoteVoucherItems(cn, invoice) {
        if (cn.reference_type === 'return' && cn.reference_id) {
            const [itemsRows] = await pool.query(`
                SELECT ri.quantity, ri.unit_price, ri.refund_amount, ri.refund_vat,
                       -- The rate it was invoiced at (the refund was computed with it), not
                       -- the product's rate today.
                       COALESCE(
                           (SELECT ii.vat_rate FROM invoice_items ii
                            WHERE ii.invoice_id = ? AND ii.product_id = ri.product_id LIMIT 1),
                           p.vat_rate, 21
                       ) AS vat_rate
                FROM client_return_items ri
                JOIN products p ON ri.product_id = p.id
                WHERE ri.return_id = ?
                  AND LOWER(COALESCE(ri.condition_status, '')) <> 'rejected'
            `, [invoice?.id || '', cn.reference_id]);
            // Same line amounts as the note: ARCA must receive exactly the stored amount, or the
            // lost-response recovery would never match and issue it twice. Returns approved since
            // ADR-016 store what each line refunded; older ones used the sale formula (ADR-015).
            const voucherLines = itemsRows.map((row) => {
                if (row.refund_amount != null) {
                    return { vat_rate: Number(row.vat_rate), total_line: Number(row.refund_amount), vat_amount: Number(row.refund_vat || 0) };
                }
                const line = lineAmounts(row.quantity, row.unit_price, row.vat_rate);
                return { vat_rate: Number(row.vat_rate), total_line: line.gross, vat_amount: line.vat };
            });
            // ADR-017: the shipping given back with the return.
            const [shippingRows] = await pool.query(
                'SELECT shipping_refund_amount, shipping_refund_vat, shipping_refund_rate FROM client_returns WHERE id = ?',
                [cn.reference_id]
            );
            const shipping = shippingRows[0];
            if (shipping && Number(shipping.shipping_refund_amount || 0) > 0) {
                voucherLines.push({
                    vat_rate: Number(shipping.shipping_refund_rate ?? 21),
                    total_line: Number(shipping.shipping_refund_amount),
                    vat_amount: Number(shipping.shipping_refund_vat || 0),
                });
            }
            if (voucherLines.length > 0) return voucherLines;
        }
        const [byRate] = await pool.query(
            `SELECT vat_rate, SUM(total_line) AS gross, SUM(vat_amount) AS vat
             FROM invoice_items WHERE invoice_id = ? GROUP BY vat_rate
             ORDER BY gross ASC`,
            [invoice.id]
        );
        const invoiceGross = byRate.reduce((sum, row) => sum + Number(row.gross || 0), 0);
        const noteCents = Math.round(Number(cn.amount || 0) * 100);
        if (byRate.length === 0 || invoiceGross <= 0) {
            return [{ total_line: noteCents / 100, vat_rate: 21 }];
        }
        // In cents so the lines add up to the note exactly; the rounding remainder goes to the
        // largest rate line (last, ordered by gross) so no line can turn negative.
        let assigned = 0;
        return byRate.map((row, index) => {
            const share = Number(row.gross || 0) / invoiceGross;
            const lineCents = index === byRate.length - 1 ? noteCents - assigned : Math.round(noteCents * share);
            assigned += lineCents;
            const vatShare = Number(row.gross) > 0 ? Number(row.vat || 0) / Number(row.gross) : 0;
            return {
                total_line: lineCents / 100,
                vat_amount: Math.round(lineCents * vatShare) / 100,
                vat_rate: Number(row.vat_rate),
            };
        });
    }

    async authorizeCreditNote(creditNoteId, userId) {
        const [rows] = await pool.query('SELECT * FROM credit_notes WHERE id = ? AND deleted_at IS NULL', [creditNoteId]);
        if (rows.length === 0) {
            const err = new Error('Credit Note not found');
            err.statusCode = 404;
            err.status = 'fail';
            err.errorCode = 'CREDIT_NOTE_NOT_FOUND';
            throw err;
        }

        const cn = rows[0];
        if (cn.status === 'authorized') return cn;

        const previousStatus = cn.status;

        // Atomic claim: only the caller that flips status -> 'authorizing' proceeds.
        // This prevents two concurrent requests from both calling AFIP for the same
        // credit note (AFIP would otherwise authorize the same voucher twice).
        const [claimResult] = await pool.query(
            `UPDATE credit_notes SET status = 'authorizing' WHERE id = ? AND status NOT IN ('authorized', 'authorizing')`,
            [creditNoteId]
        );
        if (!claimResult || claimResult.affectedRows !== 1) {
            const err = new Error('La Nota de Crédito ya está siendo autorizada por otra solicitud');
            err.statusCode = 409;
            err.status = 'fail';
            err.errorCode = 'CREDIT_NOTE_ALREADY_AUTHORIZING';
            throw err;
        }

        let afipRes = null;

        try {
            // ADR-014: a credit note is authorized against the invoice it corrects
            // (AFIP call happens outside any DB transaction).
            const originalInvoice = await this._invoiceCorrectedBy(cn);
            if (!originalInvoice) {
                throw businessError(409, {
                    error: 'credit_note_without_invoice',
                    message: 'La nota de crédito no está asociada a una factura: no puede autorizarse en ARCA.'
                });
            }
            // A ticket is not an electronic voucher: its note is internal, nothing to send.
            const invoiceLetter = String(originalInvoice.invoice_type || '').toUpperCase();
            if (invoiceLetter !== 'TK') {
                if (!originalInvoice.cae) {
                    throw businessError(409, {
                        error: 'invoice_not_authorized',
                        message: 'Autorizá primero en ARCA la factura que corrige esta nota de crédito.'
                    });
                }
                const [settingsRows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
                const companySettings = settingsRows[0] || {};
                // The note carries the letter of the invoice it corrects (ARCA rejects a mismatch),
                // even if an older note was stored with another letter.
                const noteLetter = ['A', 'B', 'C'].includes(invoiceLetter)
                    ? invoiceLetter
                    : (['A', 'B', 'C'].includes(cn.credit_note_type) ? cn.credit_note_type : 'B');
                const invoiceData = {
                    invoice_type: `NC_${noteLetter}`,
                    client_tax_id: originalInvoice.client_tax_id || null,
                    total_amount: cn.amount,
                    invoice_number: cn.number,
                    associated_voucher: {
                        invoice_type: invoiceLetter,
                        point_of_sale: originalInvoice.point_of_sale,
                        invoice_number: originalInvoice.invoice_number,
                        issue_date: originalInvoice.issue_date
                    }
                };
                const invoiceItems = await this._creditNoteVoucherItems(cn, originalInvoice);
                try {
                    afipRes = await afipService.authorizeVoucher(invoiceData, invoiceItems, companySettings);
                } catch (err) {
                    throw new Error(`AFIP rechazó la Nota de Crédito: ${err.message}`);
                }
            }
        } catch (err) {
            // Release the claim so the credit note can be retried later.
            await pool.query('UPDATE credit_notes SET status = ? WHERE id = ?', [previousStatus, creditNoteId]);
            throw err;
        }

        const cae = afipRes ? afipRes.cae : null;
        const expirationDate = afipRes ? afipRes.cae_expiration_date : null;

        await pool.query(
            'UPDATE credit_notes SET status = "authorized", cae = ?, cae_expiration_date = ? WHERE id = ?',
            [cae, expirationDate, creditNoteId]
        );

        await auditService.log({
            user_id: userId,
            action: 'AUTHORIZE_CREDIT_NOTE',
            entity_type: 'credit_note',
            entity_id: creditNoteId,
            new_values: { cae, cae_expiration_date: expirationDate }
        });

        const [updated] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [creditNoteId]);
        return updated[0];
    }

    async createManualCreditNote(body, userId, ipAddress) {
        // Simultaneous submissions with the same key collide on the unique index (or
        // deadlock on its gap lock): the loser rolls back and retries, and then finds the
        // winner's committed note, which it returns as a replay.
        const maxAttempts = body?.idempotency_key ? 3 : 1;
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await this._issueManualCreditNote(body, userId, ipAddress);
            } catch (err) {
                const collided = err?.code === 'ER_DUP_ENTRY' || err?.code === 'ER_LOCK_DEADLOCK';
                if (!collided || attempt >= maxAttempts) throw err;
            }
        }
    }

    async _issueManualCreditNote(body, userId, ipAddress) {
        const id = crypto.randomUUID();
        const allowedReferenceTypes = new Set(['return', 'warranty', 'discount', 'other']);
        const requestedReferenceType = body.reference_type || 'other';
        const referenceType = requestedReferenceType === 'manual'
            ? 'other'
            : (allowedReferenceTypes.has(requestedReferenceType) ? requestedReferenceType : 'other');
        const notes = body.notes || body.reason || null;
        const idempotencyKey = body.idempotency_key || null;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            if (idempotencyKey) {
                const [issued] = await connection.query(
                    'SELECT * FROM credit_notes WHERE idempotency_key = ? FOR UPDATE',
                    [idempotencyKey]
                );
                if (issued.length > 0) {
                    const previous = issued[0];
                    const samePayload = previous.client_id === body.client_id
                        && Math.round(Number(previous.amount || 0) * 100) === Math.round(Number(body.amount || 0) * 100)
                        && previous.reference_type === referenceType
                        && (previous.reference_id ?? null) === (body.reference_id || null)
                        && (previous.invoice_id ?? null) === (body.invoice_id || null);
                    if (!samePayload) {
                        // The key belongs to a different note: answering it as a replay would
                        // report a note that was never issued.
                        throw businessError(409, {
                            error: 'idempotency_key_reused',
                            message: `Este intento ya emitió la nota ${previous.number}. Revisá el listado antes de emitir otra.`,
                            credit_note_number: previous.number
                        });
                    }
                    await connection.commit();
                    return { ...creditNoteResult(previous), idempotent_replay: true };
                }
            }

            if (referenceType === 'return') {
                // A return issues its own note when approved: a manual one for it would credit it
                // twice (before or after the approval).
                throw businessError(409, {
                    error: 'return_already_credited',
                    message: 'Las devoluciones emiten su propia nota de crédito al aprobarse: no se carga una manual.'
                });
            }

            // ADR-014: a credit note corrects a specific invoice of the same client (ARCA requires
            // the associated voucher). Its letter and VAT split come from that invoice, and the
            // notes on an invoice can never add up to more than the invoice itself.
            const gross = Math.round(Number(body.amount || 0) * 100) / 100;
            if (!body.invoice_id) {
                throw businessError(400, { error: 'invoice_required', message: 'Elegí la factura que corrige la nota de crédito.' });
            }
            const [invoiceRows] = await connection.query(
                'SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [body.invoice_id]
            );
            const invoice = invoiceRows[0];
            if (!invoice || invoice.client_id !== body.client_id) {
                throw businessError(400, { error: 'invalid_invoice', message: 'La factura no existe o no es de este cliente.' });
            }
            if (String(invoice.status || '').toLowerCase() === 'cancelled') {
                throw businessError(409, { error: 'invoice_cancelled', message: 'La factura está anulada: no admite notas de crédito.' });
            }
            const [creditedRows] = await connection.query(
                `SELECT COALESCE(SUM(amount), 0) AS credited FROM credit_notes
                 WHERE invoice_id = ? AND deleted_at IS NULL AND (status IS NULL OR status <> 'cancelled')`,
                [invoice.id]
            );
            const creditable = Math.round((Number(invoice.total_amount || 0) - Number(creditedRows[0]?.credited || 0)) * 100) / 100;
            if (gross > creditable) {
                throw businessError(409, {
                    error: 'exceeds_invoice_balance',
                    message: `La nota supera lo acreditable de la factura (${creditable.toFixed(2)}).`,
                    creditable
                });
            }
            const invoiceLetter = String(invoice.invoice_type || '').toUpperCase();
            const creditNoteType = ['A', 'B', 'C'].includes(invoiceLetter) ? invoiceLetter : 'B';

            const year = new Date().getFullYear();
            const prefix = `NC-${year}-`;
            const [rows] = await connection.query(
                `SELECT MAX(CAST(SUBSTRING_INDEX(number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM credit_notes
             WHERE number LIKE ?`,
                [`${prefix}%`]
            );
            const maxExisting = Number(rows[0]?.max_seq || 0);
            const seq = await nextDocumentSequence(connection, `credit_note:${year}`, maxExisting);
            const number = `${prefix}${String(seq).padStart(4, '0')}`;

            await connection.query(
                `INSERT INTO credit_notes (
                id, number, client_id, customer_name, reference_type, reference_id, amount, status, notes, idempotency_key,
                invoice_id, credit_note_type, point_of_sale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?)`,
                [
                    id,
                    number,
                    body.client_id,
                    body.customer_name || null,
                    referenceType,
                    body.reference_id || null,
                    gross,
                    notes,
                    idempotencyKey,
                    invoice.id,
                    creditNoteType,
                    Number(invoice.point_of_sale || 1)
                ]
            );

            const result = {
                id,
                number,
                client_id: body.client_id,
                customer_name: body.customer_name || null,
                reference_type: referenceType,
                reference_id: body.reference_id || null,
                amount: gross,
                notes,
                status: 'issued',
                invoice_id: invoice.id,
                credit_note_type: creditNoteType
            };

            // A manual note lowers what the client owes like a return does: sales and output
            // VAT go down in the same proportion as on the invoice it corrects.
            // Output VAT per rate (ADR-016), split like the ARCA voucher lines of the note.
            const [byRate] = await connection.query(
                'SELECT vat_rate, SUM(total_line) AS gross, SUM(vat_amount) AS vat FROM invoice_items WHERE invoice_id = ? GROUP BY vat_rate',
                [invoice.id]
            );
            const vatLines = outputVatLines(
                splitByRate(byRate.length > 0 ? byRate : [{ vat_rate: 21, gross: invoice.total_amount, vat: invoice.vat_amount }], gross),
                { side: 'debit', voucherType: creditNoteType, notes: 'Reversión de IVA Débito Fiscal' }
            );
            const reversedVat = vatLines.reduce((sum, line) => sum + line.debit, 0);
            await accountingService.createJournalEntryIfAny(connection, {
                date: new Date(),
                description: `Nota de crédito ${number} - ${notes || 'manual'}`,
                reference_type: 'credit_note',
                reference_id: id,
                lines: [
                    { account_code: ACCOUNTS.SALES, debit: Math.round((gross - reversedVat) * 100) / 100, credit: 0, notes: 'Bonificación / ajuste a favor del cliente' },
                    ...vatLines,
                    { account_code: ACCOUNTS.RECEIVABLES, debit: 0, credit: gross, notes: 'Crédito a favor del cliente' }
                ]
            });

            // Audited inside the transaction: a credit note is never issued without its trace
            // (and a failed audit no longer leaves an issued note behind for a retry to duplicate).
            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_CREDIT_NOTE',
                entity_type: 'credit_note',
                entity_id: id,
                new_values: result,
                ip_address: ipAddress
            }, connection);

            await connection.commit();
            return result;
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

function creditNoteResult(row) {
    return {
        id: row.id,
        number: row.number,
        client_id: row.client_id,
        customer_name: row.customer_name ?? null,
        reference_type: row.reference_type,
        reference_id: row.reference_id ?? null,
        amount: Number(row.amount || 0),
        notes: row.notes ?? null,
        status: row.status,
    };
}

export const warrantiesService = new WarrantiesService();
export const returnsService = new ReturnsService();
export const creditNotesService = new CreditNotesService();
