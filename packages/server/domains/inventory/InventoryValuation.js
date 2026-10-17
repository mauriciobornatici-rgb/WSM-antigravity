import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { netFromGross } from '../../utils/vatMath.js';

/**
 * Goods valued at the last purchase cost (ADR-027, opción a: replacement cost, RT 17).
 *
 * Invariant: the ledger of Inventario (1.1.04.01) equals the sum of quantity × product cost over
 * the valued locations, to the cent. Every movement that changes valued stock posts its entry in
 * the same transaction, at a cost read under lock, and keeps a link to it
 * (inventory_movements.journal_entry_id). A new cost revalues the units in stock.
 *
 * One lock order for every path (any other order can deadlock against it):
 *   L1 the document header (order, reception and its purchase order, return, warranty, count
 *      session, supplier). Existing rules stay: Caja 2 before the shift, the shift before the order.
 *   L2 its child rows (items, allocations, count items, the customer).
 *   L3 inventory: every row of the document's products, in one statement ordered by
 *      product_id, id (lockStock, or StockLedger.lockSellableRows for sales).
 *   L4 products, ordered by id: FOR SHARE to read the cost, FOR UPDATE to change it. Always after
 *      L3 of the same products.
 *   L5 sequences, journal entries and audit. Never L3 or L4 after L5.
 * A deadlock or a lock wait timeout answers 409 busy.
 */

// D3: goods moved to Mermas are a loss when they get there, so they carry no value.
export const UNVALUED_LOCATIONS = Object.freeze(['Mermas']);

export function isValuedLocation(location) {
    return !UNVALUED_LOCATIONS.includes(String(location || ''));
}

const toCents = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100);

/** Quantity × unit cost in cents (the cost has 2 decimals, so the product is exact). */
export function valueCents(quantity, unitCost) {
    return Math.round(Number(quantity || 0) * toCents(unitCost));
}

export function roundCost(value) {
    return toCents(value) / 100;
}

/**
 * The cost a product is valued at: purchase_price. cost_price only for products loaded before the
 * two were unified, while their purchase_price is still empty.
 */
export function effectiveCost(product) {
    const purchase = Number(product?.purchase_price || 0);
    return purchase > 0 ? roundCost(purchase) : roundCost(product?.cost_price || 0);
}

/**
 * The sale price that keeps the markup when the cost changes (D1, auto_update_price): the final
 * price moves in proportion to the cost, rounded to the cent, and its net is what gets stored
 * (ADR-015). Null when there is no markup to keep (no previous cost or price).
 */
export function repricedSalePrice({ salePrice, vatRate, oldCost, newCost }) {
    const previousCost = Number(oldCost || 0);
    const net = Number(salePrice || 0);
    const cost = Number(newCost || 0);
    if (!(previousCost > 0) || !(net > 0) || !(cost > 0)) return null;
    const rate = vatRate == null || vatRate === '' ? 21 : Number(vatRate);
    const oldGross = toCents(net * (1 + rate / 100)) / 100;
    const newGross = toCents(oldGross * cost / previousCost) / 100;
    return netFromGross(newGross, rate);
}

export class InventoryValuation {
    constructor({ accounting = accountingService, audit = auditService } = {}) {
        this.accounting = accounting;
        this.audit = audit;
    }

    /** L3: every inventory row of the products, every location, one ordered statement. */
    async lockStock(connection, productIds) {
        const ids = [...new Set((productIds || []).filter(Boolean))].sort();
        const rowsByProduct = new Map(ids.map((id) => [id, []]));
        if (ids.length === 0) return rowsByProduct;
        const [rows] = await connection.query(
            `SELECT id, product_id, location, quantity, reserved_quantity
             FROM inventory
             WHERE product_id IN (?)
             ORDER BY product_id, id
             FOR UPDATE`,
            [ids]
        );
        for (const row of rows) rowsByProduct.get(row.product_id)?.push(row);
        return rowsByProduct;
    }

    /** Units that carry value (every location but Mermas), from rows already locked. */
    valuedQuantity(rows) {
        return (rows || []).reduce(
            (sum, row) => sum + (isValuedLocation(row.location) ? Number(row.quantity || 0) : 0),
            0
        );
    }

    /**
     * L4: the products with their cost, read with a locking read after their stock rows (L3), so
     * the cost is the last one committed and cannot change until this transaction ends.
     * @returns {Promise<Map<string, object>>} product rows by id, each with `cost`
     */
    async lockCosts(connection, productIds, { forUpdate = false } = {}) {
        const ids = [...new Set((productIds || []).filter(Boolean))].sort();
        if (ids.length === 0) return new Map();
        const [rows] = await connection.query(
            `SELECT id, name, sku, purchase_price, cost_price, sale_price, vat_rate,
                    auto_update_cost, auto_update_price, deleted_at
             FROM products
             WHERE id IN (?)
             ORDER BY id
             ${forUpdate ? 'FOR UPDATE' : 'FOR SHARE'}`,
            [ids]
        );
        return new Map(rows.map((row) => [row.id, { ...row, cost: effectiveCost(row) }]));
    }

    async linkMovements(connection, movementIds, entryId) {
        const ids = (movementIds || []).filter(Boolean);
        if (!entryId || ids.length === 0) return;
        await connection.query('UPDATE inventory_movements SET journal_entry_id = ? WHERE id IN (?)', [entryId, ids]);
    }

    /**
     * Goods that left the stock (D8: the cost of goods sold is posted when they leave, not when
     * they are invoiced): Debe CMV / Haber Inventario at the cost read under lock. Units sold that
     * the system did not have (an offline sale, ADR-010) were never in the ledger: their cost goes
     * against inventory differences, so a later count does not count the loss twice.
     * One entry for the document; its movements keep the link. Null when it is worth nothing.
     * @param {Array<{quantity:number, unitCost:number, shortage?:number, movementIds?:string[]}>} lines
     */
    async postExit(connection, { referenceType, referenceId, description, lines, date = new Date() }) {
        let exitCents = 0;
        let shortageCents = 0;
        const movementIds = [];
        for (const line of lines || []) {
            exitCents += valueCents(line.quantity, line.unitCost);
            shortageCents += valueCents(line.shortage, line.unitCost);
            movementIds.push(...(line.movementIds || []));
        }
        const entryId = await this.accounting.createJournalEntryIfAny(connection, {
            date,
            description,
            reference_type: referenceType,
            reference_id: referenceId,
            lines: [
                { account_code: ACCOUNTS.COGS, debit: (exitCents + shortageCents) / 100, credit: 0, notes: 'Costo de la mercadería vendida' },
                { account_code: ACCOUNTS.INVENTORY, debit: 0, credit: exitCents / 100, notes: 'Salida de mercadería' },
                { account_code: ACCOUNTS.INVENTORY_LOSSES, debit: 0, credit: shortageCents / 100, notes: 'Vendido sin stock registrado' },
            ],
        });
        if (!entryId) return null;
        await this.linkMovements(connection, movementIds, entryId);
        return { entryId, amount: (exitCents + shortageCents) / 100 };
    }

    /**
     * A new cost on goods already in stock: the units in valued locations are revalued against the
     * holding result, or against the opening adjustment when the cost was 0 (D6: those goods had
     * never been valued, it is not a gain). The caller holds the product's stock rows (L3, `rows`)
     * and then the product FOR UPDATE (L4). Returns what was posted, or null when nothing changes.
     */
    async revalue(connection, { product, rows, newCost, userId = null, source, details = {} }) {
        if (newCost == null) return null;
        const oldCost = effectiveCost(product);
        const cost = roundCost(newCost);
        if (cost === oldCost) return null;
        const quantity = this.valuedQuantity(rows);
        if (quantity <= 0) return null;
        const amountCents = valueCents(quantity, cost) - valueCents(quantity, oldCost);
        if (amountCents === 0) return null;

        const fromZero = !(oldCost > 0);
        const counterpart = fromZero
            ? { account_code: ACCOUNTS.OPENING_ADJUSTMENT, notes: 'Ajuste por inventario inicial (costo cargado)' }
            : { account_code: ACCOUNTS.HOLDING_RESULT, notes: 'Resultado por tenencia' };
        const value = Math.abs(amountCents) / 100;
        const lines = amountCents > 0
            ? [
                { account_code: ACCOUNTS.INVENTORY, debit: value, credit: 0, notes: 'Mayor valor del stock' },
                { ...counterpart, debit: 0, credit: value },
            ]
            : [
                { ...counterpart, debit: value, credit: 0 },
                { account_code: ACCOUNTS.INVENTORY, debit: 0, credit: value, notes: 'Menor valor del stock' },
            ];
        const name = product.name || product.sku || product.id;
        const entryId = await this.accounting.createJournalEntry(connection, {
            date: new Date(),
            description: `Revaluación de stock de ${name}: ${quantity} u. de costo $${oldCost} a $${cost}`,
            reference_type: 'stock_revaluation',
            reference_id: product.id,
            lines,
        });
        const amount = amountCents / 100;
        await this.audit.log({
            user_id: userId,
            action: 'REVALUE_STOCK',
            entity_type: 'product',
            entity_id: product.id,
            old_values: { cost: oldCost },
            new_values: {
                cost, quantity, amount, journal_entry_id: entryId, source,
                counter_account: counterpart.account_code, ...details,
            },
        }, connection);
        return { quantity, amount, entryId, counterAccount: counterpart.account_code };
    }
}

export default new InventoryValuation();
