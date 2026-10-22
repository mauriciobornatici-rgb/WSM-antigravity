import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';
import { businessYear } from '../../utils/businessDate.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { allocateCents } from '../../utils/vatMath.js';
import { businessError } from '../../utils/businessError.js';
import defaultValuation, { effectiveCost, isValuedLocation, roundCost, valueCents } from '../inventory/InventoryValuation.js';
import { invoicedByOrderSql } from './receptionInvoicing.js';

export class SupplierReturnService {
    constructor({ valuation = defaultValuation } = {}) {
        this.valuation = valuation;
    }

    /**
     * Takes the returned goods out of stock that no order has reserved, preferring the
     * locations where goods waiting for the supplier usually sit. Every row touched gets
     * its own movement with its real location. Never drives stock below reservations.
     */
    async decreaseInventory(connection, item, returnId, { unitCost = null } = {}) {
        const qty = Number(item.quantity || 0);
        const result = { valuedQuantity: 0, unvaluedQuantity: 0, movementIds: [] };
        if (qty <= 0) return result;

        const [stockRows] = await connection.query(
            `SELECT id, location, quantity, reserved_quantity
             FROM inventory
             WHERE product_id = ? AND quantity - reserved_quantity > 0
             -- FIELD() ranks by position and unknown locations get 0: listed in reverse so that
             -- DESC tries 'Devoluciones a Proveedores' first, then Cuarentena, then Mermas.
             ORDER BY FIELD(location, 'Mermas', 'Cuarentena', 'Devoluciones a Proveedores') DESC,
                      quantity - reserved_quantity DESC, id
             FOR UPDATE`,
            [item.product_id]
        );

        let remaining = qty;
        for (const row of stockRows) {
            if (remaining <= 0) break;
            const available = Number(row.quantity || 0) - Number(row.reserved_quantity || 0);
            const consume = Math.min(available, remaining);
            if (consume <= 0) continue;
            const [updated] = await connection.query(
                'UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity - reserved_quantity >= ?',
                [consume, row.id, consume]
            );
            if (Number(updated?.affectedRows) !== 1) break;
            // ADR-027: the movement carries the value the goods leave the ledger at (Mermas: none).
            const valued = isValuedLocation(row.location);
            if (valued) result.valuedQuantity += consume;
            else result.unvaluedQuantity += consume;
            const movementId = crypto.randomUUID();
            result.movementIds.push(movementId);
            await connection.query(`
                INSERT INTO inventory_movements (
                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                ) VALUES (?, 'return', ?, ?, ?, ?, ?, 'supplier_return', ?)
            `, [
                movementId,
                item.product_id,
                row.location || 'General',
                consume,
                unitCost == null ? item.unit_cost || 0 : (valued ? unitCost : 0),
                item.reason || 'Return to supplier',
                returnId
            ]);
            remaining -= consume;
        }

        if (remaining > 0) {
            throw Object.assign(new Error('Stock no reservado insuficiente para procesar la devolución al proveedor'), { errorCode: 'INSUFFICIENT_STOCK', statusCode: 409 });
        }
        return result;
    }

    async _resolveReturnAccounting(connection, supplierId, netTotal) {
        const [invoices] = await connection.query(
            `SELECT si.id, si.net_amount, si.vat_amount, si.invoice_type
             FROM supplier_invoices si
             WHERE si.supplier_id = ?
               -- ADR-017: a freight or expense invoice never brought goods.
               AND COALESCE(si.purchase_kind, 'goods') = 'goods'
               AND EXISTS (
                   SELECT 1 FROM journal_entries je
                   WHERE je.reference_type = 'supplier_invoice' AND je.reference_id = si.id
               )
             ORDER BY si.issue_date DESC, si.created_at DESC
             LIMIT 1`,
            [supplierId]
        );
        if (invoices.length === 0) return null;
        const invoiceNet = Number(invoices[0].net_amount || 0);
        const vatRatio = invoiceNet > 0 ? Number(invoices[0].vat_amount || 0) / invoiceNet : 0;
        const netCents = Math.round(netTotal * 100);
        const vatCents = Math.round(netCents * vatRatio);
        // ADR-016: the reversal follows how that purchase was actually posted. If its entry
        // booked fiscal credit, the credit is reversed in that same account. If not (a B or C
        // invoice since ADR-016), the VAT went into the goods' cost and leaves inventory with them.
        const [creditLines] = await connection.query(
            `SELECT jl.account_code, SUM(jl.debit) AS amount
             FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
             WHERE je.reference_type = 'supplier_invoice' AND je.reference_id = ?
               AND jl.account_code LIKE '1.1.05.%' AND jl.account_code <> ?
             GROUP BY jl.account_code ORDER BY amount DESC`,
            [invoices[0].id, ACCOUNTS.WITHHOLDINGS]
        );
        if (vatCents > 0 && creditLines.length === 0) {
            return { netAmount: (netCents + vatCents) / 100, vatAmount: 0, grossAmount: (netCents + vatCents) / 100, vatLines: [] };
        }
        // ADR-017: an invoice with several rates booked several credit accounts: the reversal
        // is split over them in the same proportion, to the cent.
        const parts = allocateCents(vatCents, creditLines.map((line) => Math.round(Number(line.amount) * 100)));
        const vatLines = creditLines
            .map((line, index) => ({ account_code: line.account_code, amount: parts[index] / 100 }))
            .filter((line) => line.amount > 0);
        return { netAmount: netCents / 100, vatAmount: vatCents / 100, grossAmount: (netCents + vatCents) / 100, vatLines };
    }

    async nextSupplierReturnNumber(connection) {
        const year = businessYear();
        const prefix = `SR-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(return_number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM supplier_returns
             WHERE return_number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `supplier_return:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    async getReturns(filters = {}) {
        const { supplier_id, status } = filters;
        let query = `
            SELECT sr.*, s.name AS supplier_name
            FROM supplier_returns sr
            LEFT JOIN suppliers s ON sr.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];
        if (supplier_id) {
            query += ' AND sr.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND sr.status = ?';
            params.push(status);
        }
        query += ' ORDER BY sr.created_at DESC';

        try {
            const [rows] = await pool.query(query, params);
            if (rows.length === 0) return rows;

            const ids = rows.map((r) => r.id);
            const [items] = await pool.query(`
                SELECT sri.*, p.name AS product_name, p.sku, p.vat_rate
                FROM supplier_return_items sri
                LEFT JOIN products p ON sri.product_id = p.id
                WHERE sri.return_id IN (?)
            `, [ids]);

            const itemsByReturn = {};
            for (const item of items) {
                if (!itemsByReturn[item.return_id]) itemsByReturn[item.return_id] = [];
                itemsByReturn[item.return_id].push(item);
            }

            return rows.map((r) => ({
                ...r,
                items: itemsByReturn[r.id] || []
            }));
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                return [];
            }
            throw err;
        }
    }

    /**
     * ADR-028: what the supplier takes each product back at, when it was already invoiced: the net
     * cost of its last invoice. Against a delivery note, what was invoiced for that line, or else its
     * cost. Without one, the supplier's last invoice for the product, then its last delivery note,
     * then the product's cost. Returns [{ product_id, unit_cost, source }].
     */
    async suggestedCosts({ supplierId, receptionId = null, productIds }, executor = pool) {
        const ids = [...new Set((productIds || []).filter(Boolean))];
        const found = new Map();
        if (ids.length === 0) return [];
        if (receptionId) {
            const [rows] = await executor.query(
                `SELECT ri.product_id, ri.unit_cost,
                        (SELECT sii.unit_cost FROM supplier_invoice_items sii
                         JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
                         WHERE sii.reception_item_id = ri.id AND COALESCE(si.status, '') <> 'cancelled'
                         ORDER BY si.issue_date DESC, si.created_at DESC LIMIT 1) AS invoiced_cost
                 FROM reception_items ri JOIN receptions r ON r.id = ri.reception_id
                 WHERE ri.reception_id = ? AND r.supplier_id = ? AND ri.product_id IN (?)
                 ORDER BY ri.id`,
                [receptionId, supplierId, ids]
            );
            for (const row of rows) {
                if (found.has(row.product_id)) continue;
                const invoiced = roundCost(row.invoiced_cost);
                found.set(row.product_id, invoiced > 0 ? { cost: invoiced, source: 'invoice' } : { cost: roundCost(row.unit_cost), source: 'reception' });
            }
        }
        const missing = () => ids.filter((productId) => !found.has(productId));
        // One row per product (the latest), not the whole history (AUD-017).
        if (missing().length > 0) {
            const [rows] = await executor.query(
                `SELECT product_id, unit_cost FROM (
                     SELECT sii.product_id, sii.unit_cost,
                            ROW_NUMBER() OVER (PARTITION BY sii.product_id
                                               ORDER BY si.issue_date DESC, si.created_at DESC, sii.created_at DESC) AS position
                     FROM supplier_invoice_items sii JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
                     WHERE si.supplier_id = ? AND sii.product_id IN (?) AND COALESCE(si.status, '') <> 'cancelled'
                 ) latest WHERE position = 1`,
                [supplierId, missing()]
            );
            for (const row of rows) if (!found.has(row.product_id)) found.set(row.product_id, { cost: roundCost(row.unit_cost), source: 'invoice' });
        }
        if (missing().length > 0) {
            const [rows] = await executor.query(
                `SELECT product_id, unit_cost FROM (
                     SELECT ri.product_id, ri.unit_cost,
                            ROW_NUMBER() OVER (PARTITION BY ri.product_id ORDER BY r.created_at DESC, ri.id) AS position
                     FROM reception_items ri JOIN receptions r ON r.id = ri.reception_id
                     WHERE r.supplier_id = ? AND r.status = 'approved' AND ri.product_id IN (?) AND ri.unit_cost > 0
                 ) latest WHERE position = 1`,
                [supplierId, missing()]
            );
            for (const row of rows) if (!found.has(row.product_id)) found.set(row.product_id, { cost: roundCost(row.unit_cost), source: 'reception' });
        }
        if (missing().length > 0) {
            const [rows] = await executor.query('SELECT id, purchase_price, cost_price FROM products WHERE id IN (?)', [missing()]);
            for (const row of rows) found.set(row.id, { cost: effectiveCost(row), source: 'product' });
        }
        return ids.map((productId) => ({
            product_id: productId,
            unit_cost: found.get(productId)?.cost ?? 0,
            source: found.get(productId)?.source ?? 'product',
        }));
    }

    /**
     * @param {object} options
     * @param {boolean} options.canSetCost whether the user may change what the supplier takes the goods
     *   back at (ADR-028: purchasing, a manager or an administrator). Without it, the last invoiced
     *   cost (`suggestedCosts`); a different one is refused.
     */
    async createReturn(data, userId, ipAddress = null, { canSetCost = false } = {}) {
        const { supplier_id, items, notes } = data;
        const receptionId = data.reception_id || null;
        const id = crypto.randomUUID();

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            if (receptionId) {
                // D7: the delivery note is this supplier's, approved, and brought these products.
                const [receptions] = await connection.query(
                    'SELECT id, supplier_id, status FROM receptions WHERE id = ? FOR SHARE',
                    [receptionId]
                );
                if (receptions.length === 0 || receptions[0].supplier_id !== supplier_id || receptions[0].status !== 'approved') {
                    throw businessError(400, { error: 'invalid_reception', message: 'El remito no existe, es de otro proveedor o no está aprobado.' });
                }
                const [lines] = await connection.query('SELECT product_id FROM reception_items WHERE reception_id = ?', [receptionId]);
                const received = new Set(lines.map((line) => line.product_id));
                if ((items || []).some((item) => !received.has(item.product_id))) {
                    throw businessError(400, { error: 'product_not_in_reception', message: 'Algún producto no vino en ese remito.' });
                }
            }
            const suggested = new Map((await this.suggestedCosts({
                supplierId: supplier_id, receptionId, productIds: (items || []).map((item) => item.product_id),
            }, connection)).map((row) => [row.product_id, row.unit_cost]));
            const costs = (items || []).map((item) => {
                const lastInvoiced = suggested.get(item.product_id) ?? 0;
                if (item.unit_cost == null || item.unit_cost === '') return lastInvoiced;
                const typed = roundCost(item.unit_cost);
                if (typed !== lastInvoiced && !canSetCost) {
                    throw businessError(403, {
                        error: 'return_cost_not_allowed',
                        message: `Solo un gerente o un administrador puede cambiar el costo de la devolución: se toma el último costo facturado ($${lastInvoiced.toFixed(2)}).`,
                    });
                }
                return typed;
            });
            const returnNumber = await this.nextSupplierReturnNumber(connection);

            await connection.query(`
                INSERT INTO supplier_returns (id, return_number, supplier_id, notes, status, reception_id)
                VALUES (?, ?, ?, ?, 'draft', ?)
            `, [id, returnNumber, supplier_id, notes || null, receptionId]);

            for (const [index, item] of (items || []).entries()) {
                // Not overridden: the approval takes the last invoiced cost of that moment.
                const overridden = costs[index] !== (suggested.get(item.product_id) ?? 0);
                await connection.query(`
                    INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost, reason, cost_overridden)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    id,
                    item.product_id,
                    item.quantity,
                    costs[index],
                    item.reason || null,
                    overridden ? 1 : 0
                ]);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_SUPPLIER_RETURN',
                entity_type: 'supplier_return',
                entity_id: id,
                new_values: {
                    id,
                    return_number: returnNumber,
                    supplier_id,
                    reception_id: receptionId,
                    notes: notes || null,
                    // The cost applied, the one suggested and whether purchasing changed it (ADR-028).
                    items: (items || []).map((item, index) => ({
                        ...item,
                        unit_cost: costs[index],
                        suggested_cost: suggested.get(item.product_id) ?? 0,
                        cost_overridden: costs[index] !== (suggested.get(item.product_id) ?? 0),
                    }))
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id, return_number: returnNumber };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async approveSupplierReturn(id, userId, ipAddress = null) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [returns] = await connection.query('SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE', [id]);
            if (returns.length === 0) {
                throw Object.assign(new Error('Devolución no encontrada'), { errorCode: 'RETURN_NOT_FOUND', statusCode: 404 });
            }
            const supplierReturn = returns[0];
            if (supplierReturn.status === 'approved') {
                throw Object.assign(new Error('La devolución ya fue aprobada'), { errorCode: 'RETURN_ALREADY_APPROVED', statusCode: 409 });
            }

            // Same order as a supplier invoice: the supplier, then the delivery note (L1), its lines
            // (L2), the stock (L3) and the cost (L4), so neither waits on the other in a circle. The
            // supplier before any plain read: under REPEATABLE READ the first plain read fixes the
            // snapshot, and an invoice committed while this waited must be seen (AUD-017).
            await connection.query('SELECT id FROM suppliers WHERE id = ? FOR UPDATE', [supplierReturn.supplier_id]);

            const [items] = await connection.query('SELECT * FROM supplier_return_items WHERE return_id = ? ORDER BY product_id, id', [id]);
            if (items.length === 0) {
                throw Object.assign(new Error('La devolución no tiene ítems'), { errorCode: 'RETURN_WITHOUT_ITEMS', statusCode: 400 });
            }
            // Stock counts whole units: 0,4 would leave the stock as it was and still post its value.
            if (items.some((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0)) {
                throw businessError(409, {
                    error: 'invalid_return_quantity',
                    message: 'La devolución tiene cantidades con decimales: se devuelven unidades enteras. Cargala de nuevo.',
                });
            }

            const reception = supplierReturn.reception_id
                ? await this._lockReception(connection, supplierReturn, items)
                : null;
            const productIds = items.map((item) => item.product_id);
            await this.valuation.lockStock(connection, productIds);
            const costs = await this.valuation.lockCosts(connection, productIds);
            // ADR-028: invoiced units go back at the last invoiced cost of now (an invoice may have
            // arrived after the draft), unless purchasing typed another one.
            const lastInvoiced = new Map((await this.suggestedCosts({
                supplierId: supplierReturn.supplier_id, receptionId: supplierReturn.reception_id, productIds,
            }, connection)).map((row) => [row.product_id, row]));
            const creditCostOf = (item) => {
                const saved = Number(item.unit_cost || 0);
                if (Number(item.cost_overridden) === 1) return saved;
                // Only an invoiced cost replaces the draft's (a fallback is what the draft already took).
                const latest = lastInvoiced.get(item.product_id);
                return latest?.source === 'invoice' && Number(latest.unit_cost) > 0 ? Number(latest.unit_cost) : saved;
            };

            // ADR-027/028: the goods leave the ledger at their book value (today's cost; Mermas has
            // none). Against a delivery note, the units it still had to invoice lower what is owed
            // for it (2.1.01.02, D7, or 3.1.02.02 for one received before ADR-027); the units already
            // invoiced lower what is owed to the supplier, at the return's cost (the last invoiced).
            let bookCents = 0;
            let wasteCents = 0;
            let bridgeCents = 0;
            let legacyCents = 0;
            let creditCents = 0;
            let lossCents = 0;
            const movementIds = [];
            for (const item of items) {
                const quantity = Number(item.quantity);
                const bookCost = costs.get(item.product_id)?.cost || 0;
                const moved = await this.decreaseInventory(connection, item, id, { unitCost: bookCost });
                movementIds.push(...moved.movementIds);
                bookCents += valueCents(moved.valuedQuantity, bookCost);
                // The delivery note's lines of this product (an order may bring it in two): the units
                // not invoiced first, line by line, at each line's cost; then the invoiced ones.
                const productLines = reception?.lines.get(item.product_id) || [];
                let left = quantity;
                let notInvoicedCents = 0;
                for (const line of productLines) {
                    const take = Math.min(left, line.toInvoice);
                    if (take <= 0) continue;
                    line.toInvoice -= take;
                    line.returning += take;
                    notInvoicedCents += valueCents(take, line.unit_cost);
                    left -= take;
                }
                const invoicedUnits = left;
                for (const line of productLines) {
                    const room = Number(line.quantity_received || 0) - Number(line.returned_quantity || 0) - line.returning;
                    const take = Math.min(left, Math.max(0, room));
                    if (take <= 0) continue;
                    line.returning += take;
                    left -= take;
                }
                if (reception?.bridged) bridgeCents += notInvoicedCents;
                else legacyCents += notInvoicedCents;
                const creditCost = creditCostOf(item);
                if (creditCost !== Number(item.unit_cost || 0)) {
                    await connection.query('UPDATE supplier_return_items SET unit_cost = ? WHERE id = ?', [creditCost, item.id]);
                }
                const itemCreditCents = valueCents(invoicedUnits, creditCost);
                creditCents += itemCreditCents;
                // Invoiced units handed back for nothing are a loss (their book value).
                if (invoicedUnits > 0 && itemCreditCents === 0) {
                    lossCents += Math.round(valueCents(invoicedUnits, bookCost) * moved.valuedQuantity / quantity);
                }
                // Units that were in Mermas recover their loss at what was agreed for them.
                if (moved.unvaluedQuantity > 0) {
                    wasteCents += Math.round((notInvoicedCents + itemCreditCents) * moved.unvaluedQuantity / quantity);
                }
            }
            for (const productLines of reception?.lines.values() || []) {
                for (const line of productLines) {
                    if (line.returning <= 0) continue;
                    await connection.query(
                        'UPDATE reception_items SET returned_quantity = returned_quantity + ? WHERE id = ?',
                        [line.returning, line.id]
                    );
                }
            }

            await connection.query('UPDATE supplier_returns SET status = "approved" WHERE id = ?', [id]);

            let supplierCredit = null;
            if (creditCents > 0) {
                // Mirror of the purchase (ADR-011): the VAT treatment follows the supplier's last
                // posted invoice (its VAT/net ratio: 0 for a Factura C, 21 % or the mix for a Factura A).
                supplierCredit = await this._resolveReturnAccounting(connection, supplierReturn.supplier_id, creditCents / 100);
                if (!supplierCredit) {
                    // D7: goods the supplier never invoiced are returned against their delivery note.
                    throw businessError(409, {
                        error: 'supplier_return_requires_reception',
                        message: 'El proveedor todavía no facturó esta mercadería: elegí en la devolución el remito con el que llegó.',
                    });
                }
            }
            const grossCents = supplierCredit ? Math.round(supplierCredit.grossAmount * 100) : 0;
            const entryId = await this._postReturnEntry(connection, supplierReturn, {
                debits: [
                    { account_code: ACCOUNTS.GOODS_TO_INVOICE, cents: bridgeCents, notes: 'Mercadería recibida a facturar - devolución' },
                    { account_code: ACCOUNTS.PRIOR_PERIOD_ADJUSTMENT, cents: legacyCents, notes: 'Remito anterior a la valuación por costo de última compra - devolución' },
                    { account_code: ACCOUNTS.INVENTORY_LOSSES, cents: lossCents, notes: 'Mercadería devuelta sin crédito del proveedor' },
                    { account_code: ACCOUNTS.SUPPLIERS, cents: grossCents, notes: 'Proveedores - devolución' },
                ],
                agreedCents: bridgeCents + legacyCents + lossCents + (supplierCredit ? Math.round(supplierCredit.netAmount * 100) : 0),
                bookCents,
                wasteCents,
                vatLines: supplierCredit?.vatLines || [],
            });
            if (supplierCredit) {
                const grossAmount = grossCents / 100;
                // Not a cash outflow: an adjustment that reduces what we owe the supplier.
                await connection.query(`
                    INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
                    VALUES (?, 'adjustment', ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    grossAmount,
                    `Devolución a proveedor ${supplierReturn.return_number}`,
                    id,
                    supplierReturn.supplier_id
                ]);

                // May go below zero: a balance in our favour is real and must not vanish.
                await connection.query(`
                    UPDATE suppliers
                    SET account_balance = COALESCE(account_balance, 0) - ?
                    WHERE id = ?
                `, [grossAmount, supplierReturn.supplier_id]);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'APPROVE_SUPPLIER_RETURN',
                entity_type: 'supplier_return',
                entity_id: id,
                old_values: { status: supplierReturn.status },
                new_values: {
                    status: 'approved',
                    total_amount: creditCents / 100,
                    book_value: bookCents / 100,
                    ...(reception ? { reception_id: reception.id } : {}),
                    accounting: entryId
                        ? {
                            goods_to_invoice: bridgeCents / 100,
                            prior_periods: legacyCents / 100,
                            supplier_credit: grossCents / 100,
                            loss: lossCents / 100,
                        }
                        : 'not_posted: nothing of value left the ledger',
                },
                ip_address: ipAddress
            }, connection);
            await this.valuation.linkMovements(connection, movementIds, entryId);
            await connection.commit();
            return { success: true, message: 'Devolución aprobada correctamente' };
        } catch (err) {
            await connection.rollback();
            if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando estos productos. Reintentá en unos segundos.' });
            }
            throw err;
        } finally {
            connection.release();
        }
    }

    /**
     * D7: the delivery note a return is made against, locked with its lines. A return never takes
     * back more than that delivery note brought (minus what was already returned). Each line's
     * `toInvoice`: units the supplier has not invoiced yet (ADR-028: a return takes those first).
     * `bridged`: its goods went through 2.1.01.02 (ADR-027).
     */
    async _lockReception(connection, supplierReturn, items) {
        const [receptions] = await connection.query(
            'SELECT id, supplier_id, status FROM receptions WHERE id = ? FOR UPDATE',
            [supplierReturn.reception_id]
        );
        const reception = receptions[0];
        if (!reception || reception.supplier_id !== supplierReturn.supplier_id || reception.status !== 'approved') {
            throw businessError(409, { error: 'invalid_reception', message: 'El remito de la devolución no está aprobado o es de otro proveedor.' });
        }
        const [lines] = await connection.query(
            `SELECT id, product_id, quantity_received, COALESCE(returned_quantity, 0) AS returned_quantity,
                    COALESCE(invoiced_quantity, 0) AS invoiced_quantity, unit_cost
             FROM reception_items WHERE reception_id = ? ORDER BY id FOR UPDATE`,
            [reception.id]
        );
        // Every line of each product (an order may bring a product in two lines).
        const byProduct = new Map();
        for (const line of lines) {
            line.returning = 0;
            byProduct.set(line.product_id, [...(byProduct.get(line.product_id) || []), line]);
        }
        const requested = new Map();
        for (const item of items) requested.set(item.product_id, (requested.get(item.product_id) || 0) + Number(item.quantity || 0));
        for (const [productId, quantity] of requested) {
            const productLines = byProduct.get(productId) || [];
            const left = productLines.reduce((sum, line) => sum + Number(line.quantity_received || 0) - Number(line.returned_quantity || 0), 0);
            if (productLines.length === 0 || quantity > left) {
                throw businessError(409, {
                    error: 'return_exceeds_reception',
                    message: `Se devuelve más de lo que quedó de ese remito (${Math.max(left, 0)} u.).`,
                });
            }
        }
        // A locking read: a delivery note approved while this waited is seen as bridged (AUD-017).
        const [bridged] = await connection.query(
            "SELECT id FROM journal_entries WHERE reference_type = 'goods_received' AND reference_id = ? LIMIT 1 FOR SHARE",
            [reception.id]
        );
        // One whose purchase order was invoiced without naming it is invoiced in full: its goods are
        // in the ledger and the supplier billed them, so the return lowers what is owed (AUD-016).
        const [byOrder] = bridged.length === 0
            ? await connection.query(`SELECT ${invoicedByOrderSql('r')} AS invoiced FROM receptions r WHERE r.id = ?`, [reception.id])
            : [[]];
        const invoicedByOrder = Boolean(Number(byOrder[0]?.invoiced || 0));
        for (const line of lines) {
            line.toInvoice = invoicedByOrder
                ? 0
                : Math.max(0, Number(line.quantity_received || 0) - Number(line.invoiced_quantity || 0) - Number(line.returned_quantity || 0));
        }
        return { id: reception.id, bridged: bridged.length > 0, lines: byProduct };
    }

    /**
     * The return's entry (ADR-027/028): the goods leave inventory at their book value; what the
     * supplier takes them back against (2.1.01.02, 3.1.02.02, Proveedores or, for nothing, a loss)
     * are the `debits`; units that were in Mermas recover their loss; the rest is holding result.
     * `agreedCents`: what the goods were worth by those debits (net: the VAT reversal is apart).
     */
    async _postReturnEntry(connection, supplierReturn, { debits, agreedCents, bookCents, wasteCents, vatLines = [] }) {
        const holdingCents = agreedCents - bookCents - wasteCents;
        return accountingService.createJournalEntryIfAny(connection, {
            date: new Date(),
            description: `Devolución a proveedor ${supplierReturn.return_number}`,
            reference_type: 'supplier_return',
            reference_id: supplierReturn.id,
            lines: [
                ...debits.map((debit) => ({ account_code: debit.account_code, debit: debit.cents / 100, credit: 0, notes: debit.notes })),
                { account_code: ACCOUNTS.HOLDING_RESULT, debit: holdingCents < 0 ? -holdingCents / 100 : 0, credit: holdingCents > 0 ? holdingCents / 100 : 0, notes: 'Diferencia con el costo de la mercadería' },
                { account_code: ACCOUNTS.INVENTORY, debit: 0, credit: bookCents / 100, notes: 'Salida de mercadería devuelta' },
                { account_code: ACCOUNTS.INVENTORY_LOSSES, debit: 0, credit: wasteCents / 100, notes: 'Recupero de mermas devueltas' },
                ...vatLines.map((line) => ({
                    account_code: line.account_code, debit: 0, credit: line.amount, notes: 'Reversión de IVA Crédito Fiscal'
                })),
            ],
        });
    }
}

export default new SupplierReturnService();
