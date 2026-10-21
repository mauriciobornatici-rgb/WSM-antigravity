import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import purchaseOrderService from './PurchaseOrderService.js';
import { businessError } from '../../utils/businessError.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { vatCreditAccount } from '../../utils/vatAccounts.js';
import { allocateCents } from '../../utils/vatMath.js';
import defaultValuation, { effectiveCost, roundCost, valueCents } from '../inventory/InventoryValuation.js';

// What a supplier invoice buys (ADR-017): goods go to inventory, freight and other expenses
// to their expense accounts.
const PURCHASE_ACCOUNTS = Object.freeze({
    goods: { code: '1.1.04.01', notes: 'Inventario / Bienes de Cambio' },
    shipping: { code: '5.1.02.06', notes: 'Fletes y envíos' },
    expense: { code: '5.1.02.01', notes: 'Gastos generales' },
});

export class SupplierInvoiceService {
    constructor({ valuation = defaultValuation } = {}) {
        this.valuation = valuation;
    }

    async getSupplierInvoices(filters = {}) {
        const { supplier_id, status } = filters;
        let query = `
            SELECT si.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   r.reception_number, po.po_number
            FROM supplier_invoices si
            LEFT JOIN suppliers s ON si.supplier_id = s.id
            LEFT JOIN receptions r ON si.reception_id = r.id
            LEFT JOIN purchase_orders po ON si.purchase_order_id = po.id
            WHERE 1=1
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND si.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND si.status = ?';
            params.push(status);
        }
        query += ' ORDER BY si.issue_date DESC, si.created_at DESC';

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createSupplierInvoice(data, userId, ipAddress = null) {
        const {
            invoice_number,
            invoice_type,
            supplier_id,
            reception_id,
            purchase_order_id,
            issue_date,
            due_date,
            net_amount,
            vat_amount,
            other_taxes,
            total_amount,
            notes
        } = data;

        const id = crypto.randomUUID();
        // ADR-019: one invoice may cover one or several delivery notes (receptions).
        const receptionIds = [...new Set([...(Array.isArray(data.reception_ids) ? data.reception_ids : []), reception_id].filter(Boolean))];
        // ADR-017: an invoice with several VAT rates comes as one line per rate.
        const vatLines = Array.isArray(data.vat_lines) && data.vat_lines.length > 0
            ? data.vat_lines.map((line) => ({
                vat_rate: Number(line.vat_rate),
                net: Math.round(Number(line.net_amount || 0) * 100) / 100,
                vat: Math.round(Number(line.vat_amount || 0) * 100) / 100,
            }))
            : null;
        const net = vatLines
            ? vatLines.reduce((sum, line) => sum + Math.round(line.net * 100), 0) / 100
            : Math.round(Number(net_amount || 0) * 100) / 100;
        const vat = vatLines
            ? vatLines.reduce((sum, line) => sum + Math.round(line.vat * 100), 0) / 100
            : Math.round(Number(vat_amount || 0) * 100) / 100;
        if (vatLines && vatLines.some((line) => line.vat > 0 && line.vat_rate === 0)) {
            throw businessError(400, { error: 'invalid_vat_rate', message: 'Una línea con IVA no puede tener alícuota 0 %.' });
        }
        // AUD-006: each line's VAT must match its rate (a few cents of rounding per item are
        // allowed), and the header amounts, when sent, must be the sums of the lines.
        for (const line of vatLines || []) {
            const expected = line.net * line.vat_rate / 100;
            if (line.vat_rate > 0 && Math.abs(line.vat - expected) > Math.max(0.05, line.net * 0.001)) {
                throw businessError(400, {
                    error: 'invalid_vat_line',
                    message: `El IVA de la línea al ${line.vat_rate}% (${line.vat.toFixed(2)}) no corresponde a su neto (${expected.toFixed(2)}).`
                });
            }
        }
        if (vatLines && ((net_amount != null && Math.round(Number(net_amount) * 100) !== Math.round(net * 100))
            || (vat_amount != null && Math.round(Number(vat_amount) * 100) !== Math.round(vat * 100)))) {
            throw businessError(400, {
                error: 'invalid_invoice_total',
                message: 'El neto y el IVA del comprobante deben ser la suma de sus alícuotas.'
            });
        }
        if (!(net > 0)) {
            throw businessError(400, { error: 'invalid_net_amount', message: 'El neto del comprobante debe ser mayor a cero.' });
        }
        const purchaseKind = data.purchase_kind || 'goods';
        if (purchaseKind !== 'goods' && (receptionIds.length > 0 || purchase_order_id)) {
            throw businessError(400, {
                error: 'invalid_purchase_kind',
                message: 'Una factura vinculada a una recepción u orden de compra es de mercadería.'
            });
        }
        // ADR-027 (D2): goods enter the stock and the ledger with their delivery note; an invoice
        // without one would book goods that never came in.
        if (purchaseKind === 'goods' && receptionIds.length === 0) {
            throw businessError(409, {
                error: 'goods_invoice_requires_reception',
                message: 'Una factura de mercadería se carga contra su remito: registrá la recepción (puede ser sin orden de compra) y elegila en la factura.'
            });
        }
        const taxes = Math.round(Number(other_taxes || 0) * 100) / 100;
        const total = Math.round(Number(total_amount || (net + vat + taxes)) * 100) / 100;
        const creatorId = userId || null;
        // The total is what we owe: it must be the sum of its parts or the entry would not
        // balance (a typed total that disagrees used to post an unbalanced purchase).
        const partsCents = Math.round(net * 100) + Math.round(vat * 100) + Math.round(taxes * 100);
        if (Math.round(total * 100) !== partsCents) {
            throw businessError(400, {
                error: 'invalid_invoice_total',
                message: `El total (${total.toFixed(2)}) no coincide con neto + IVA + percepciones (${(partsCents / 100).toFixed(2)}).`
            });
        }
        if (vat > 0 && data.vat_rate != null && Number(data.vat_rate) === 0) {
            throw businessError(400, {
                error: 'invalid_vat_rate',
                message: 'La factura tiene IVA: elegí su alícuota (0 % es solo para comprobantes sin IVA).'
            });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 0. The supplier exists and is not being deleted at this moment (its row is locked:
            // a concurrent deletion waits and then sees the new balance).
            const [supplierRows] = await connection.query(
                'SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [supplier_id]
            );
            if (supplierRows.length === 0) {
                throw businessError(404, { error: 'supplier_not_found', message: 'Proveedor no encontrado o eliminado.' });
            }

            // 1. Check for duplicates (invoice number + type per supplier)
            const [existing] = await connection.query(
                'SELECT id FROM supplier_invoices WHERE supplier_id = ? AND invoice_type = ? AND invoice_number = ? LIMIT 1',
                [supplier_id, invoice_type, invoice_number]
            );
            if (existing.length > 0) {
                // The catch below rolls the transaction back; the controller answers with responseBody.
                const message = `La factura ${invoice_type} ${invoice_number} ya se encuentra registrada para este proveedor.`;
                throw businessError(409, { error: 'duplicate_invoice', message });
            }

            // ADR-027: the invoice clears what its delivery notes put in 2.1.01.02. What it costs
            // beyond (or below) that is the holding result, and the products that follow the last
            // purchase take the invoiced cost, revaluing their stock (D1).
            const givesCredit = invoice_type === 'A' || invoice_type === 'M';
            const debitBase = Math.round((net + (givesCredit ? 0 : vat)) * 100) / 100;

            // ADR-019: the delivery notes are this supplier's and approved. Locked (L1, then their
            // lines L2) so two invoices or a return loaded at the same time wait for each other.
            // ADR-028: each line is invoiced in the units the supplier charged; the rest stays to
            // invoice (a later invoice, or a return).
            let receptionsNet = null;
            let bridge = null;
            if (receptionIds.length > 0) {
                const [receptions] = await connection.query(
                    'SELECT id, supplier_id, status, remito_number, reception_number FROM receptions WHERE id IN (?) ORDER BY id FOR UPDATE',
                    [receptionIds]
                );
                if (receptions.length !== receptionIds.length || receptions.some((row) => row.supplier_id !== supplier_id)) {
                    throw businessError(400, { error: 'invalid_reception', message: 'Algún remito no existe o es de otro proveedor.' });
                }
                // ADR-019 (usuario): only goods that passed quality control are invoiced.
                const notApproved = receptions.filter((row) => String(row.status || '').toLowerCase() !== 'approved');
                if (notApproved.length > 0) {
                    throw businessError(409, {
                        error: 'reception_not_approved',
                        message: `Estos remitos no tienen el control de calidad aprobado: ${notApproved.map((row) => row.remito_number || row.reception_number).join(', ')}.`
                    });
                }
                bridge = await this._invoiceLines(connection, receptions, {
                    items: data.items,
                    netCents: Math.round(net * 100),
                    vatToCostCents: givesCredit ? 0 : Math.round(vat * 100),
                });
                receptionsNet = (bridge.pendingCents + bridge.legacyCents) / 100;
            }

            // Locks for a new cost: stock (L3) and products (L4), before any entry.
            // The holding result: what the lines of bridged delivery notes cost against what they
            // cleared (the lines of older delivery notes go whole to 3.1.02.02).
            const differenceCents = bridge ? bridge.bridgedCostCents - bridge.pendingCents : 0;
            const costUpdates = bridge
                ? await this._correctCosts(connection, bridge.lines, { userId: creatorId, invoiceId: id })
                : [];

            // 2. Insert Supplier Invoice
            await connection.query(`
                INSERT INTO supplier_invoices (
                    id, invoice_number, invoice_type, supplier_id, reception_id, purchase_order_id,
                    issue_date, due_date, net_amount, vat_amount, other_taxes, total_amount, status, notes, created_by,
                    purchase_kind
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
            `, [
                id,
                invoice_number,
                invoice_type,
                supplier_id,
                bridge?.receptionIds[0] || receptionIds[0] || null,
                purchase_order_id || null,
                issue_date,
                due_date || null,
                net,
                vat,
                taxes,
                total,
                notes || null,
                creatorId,
                purchaseKind
            ]);
            // ADR-028: what this invoice charged per delivery note line, and the units it took.
            for (const line of bridge?.lines || []) {
                await connection.query(
                    'UPDATE reception_items SET invoiced_quantity = invoiced_quantity + ? WHERE id = ?',
                    [line.quantity, line.id]
                );
                await connection.query(
                    `INSERT INTO supplier_invoice_items
                        (id, supplier_invoice_id, reception_id, reception_item_id, product_id, quantity, unit_cost, cleared_amount)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), id, line.receptionId, line.id, line.productId, line.quantity,
                        roundCost(line.netCents / line.quantity / 100), line.bridged ? line.remitoCents / 100 : null]
                );
            }
            for (const receptionId of bridge?.receptionIds || []) {
                const cleared = bridge.clearedByReception.get(receptionId);
                await connection.query(
                    'INSERT INTO supplier_invoice_receptions (supplier_invoice_id, reception_id, cleared_amount) VALUES (?, ?, ?)',
                    [id, receptionId, cleared == null ? null : cleared / 100]
                );
            }
            for (const line of vatLines || []) {
                await connection.query(
                    `INSERT INTO supplier_invoice_vat_lines (id, supplier_invoice_id, vat_rate, net_amount, vat_amount)
                     VALUES (?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), id, line.vat_rate, line.net, line.vat]
                );
            }

            // 3. Increment Supplier Account Balance
            await connection.query(`
                UPDATE suppliers
                SET account_balance = COALESCE(account_balance, 0) + ?
                WHERE id = ?
            `, [total, supplier_id]);

            // 4. Create Transaction Ledger entry (Libro Mayor Auxiliar de Proveedores)
            await connection.query(`
                INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id, date)
                VALUES (?, 'purchase', ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                total,
                `Factura de Compra ${invoice_type} ${invoice_number}`,
                id,
                supplier_id,
                issue_date || new Date()
            ]);

            // 5. Create Accounting Journal Entry (Double-Entry Bookkeeping)
            // ADR-016: only a Factura A (or M) gives fiscal credit, in the account of its rate.
            // On a B or C invoice the VAT is part of the cost. Perceptions ("Percepciones /
            // Otros") are tax paid in advance: Retenciones y percepciones sufridas, not cost.
            // ADR-017: several rates post one fiscal credit line each, and a freight or expense
            // invoice goes to its expense account instead of inventory.
            const rateLines = vatLines || [{ vat_rate: data.vat_rate == null ? 21 : Number(data.vat_rate), net, vat }];
            const debitAccount = PURCHASE_ACCOUNTS[purchaseKind] || PURCHASE_ACCOUNTS.goods;
            const creditByAccount = new Map();
            if (givesCredit) {
                for (const line of rateLines) {
                    if (!(line.vat > 0)) continue;
                    const account = vatCreditAccount(line.vat_rate);
                    const current = creditByAccount.get(account) || { amount: 0, rates: new Set() };
                    current.amount = Math.round((current.amount + line.vat) * 100) / 100;
                    current.rates.add(line.vat_rate);
                    creditByAccount.set(account, current);
                }
            }
            // Goods whose delivery notes went through 2.1.01.02 clear it, and what they cost beyond
            // (or below) it is holding result. Delivery notes received before ADR-027 never did: the
            // transition valued their goods with the stock against 3.1.02.02 (ADR-028, earlier
            // years), so their invoice settles that adjustment instead of adding inventory again
            // (before the transition, its final adjustment nets the same amount).
            const goodsLines = bridge
                ? [
                    { account_code: ACCOUNTS.GOODS_TO_INVOICE, debit: bridge.pendingCents / 100, credit: 0, notes: 'Mercadería recibida a facturar' },
                    {
                        account_code: ACCOUNTS.PRIOR_PERIOD_ADJUSTMENT,
                        debit: bridge.legacyCostCents / 100,
                        credit: 0,
                        notes: 'Remito anterior a la valuación por costo de última compra',
                    },
                    {
                        account_code: ACCOUNTS.HOLDING_RESULT,
                        debit: differenceCents > 0 ? differenceCents / 100 : 0,
                        credit: differenceCents < 0 ? -differenceCents / 100 : 0,
                        notes: 'Diferencia entre lo facturado y lo recibido',
                    },
                ]
                : [{ account_code: debitAccount.code, debit: debitBase, credit: 0, notes: debitAccount.notes }];
            await accountingService.createJournalEntryIfAny(connection, {
                date: issue_date || new Date(),
                description: `Factura de Compra ${invoice_type} ${invoice_number}`,
                reference_type: 'supplier_invoice',
                reference_id: id,
                lines: [
                    ...goodsLines,
                    ...[...creditByAccount.entries()].map(([account_code, credit]) => ({
                        account_code, debit: credit.amount, credit: 0, notes: `IVA Crédito Fiscal ${[...credit.rates].join(' / ')}%`
                    })),
                    ...(taxes > 0
                        ? [{ account_code: ACCOUNTS.WITHHOLDINGS, debit: taxes, credit: 0, notes: 'Percepciones sufridas' }]
                        : []),
                    { account_code: '2.1.01.01', debit: 0, credit: total, notes: `Proveedores - Cuenta Corriente` }
                ]
            });

            await auditService.log({
                user_id: creatorId,
                action: 'CREATE_SUPPLIER_INVOICE',
                entity_type: 'supplier_invoice',
                entity_id: id,
                new_values: {
                    id,
                    invoice_number,
                    invoice_type,
                    supplier_id,
                    reception_id,
                    reception_ids: receptionIds,
                    purchase_order_id,
                    issue_date,
                    net_amount: net,
                    vat_amount: vat,
                    other_taxes: taxes,
                    total_amount: total,
                    ...(bridge ? { cleared_from_received: bridge.pendingCents / 100, difference: differenceCents / 100 } : {}),
                    ...(costUpdates.length > 0 ? { cost_updates: costUpdates } : {})
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();

            // ADR-019: what the delivery notes received (at their cost) against the invoice's net:
            // a difference is shown to the user (it is not blocked: prices or extras can differ).
            return {
                id,
                success: true,
                total_amount: total,
                reception_ids: receptionIds,
                ...(receptionsNet != null
                    ? { receptions_net: receptionsNet, receptions_difference: Math.round((net - receptionsNet) * 100) / 100 }
                    : {}),
                // ADR-027 (D1): products whose cost (and price, if it follows) changed with this invoice.
                ...(costUpdates.length > 0 ? { cost_updates: costUpdates } : {})
            };
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
     * The delivery note lines this invoice charges (ADR-028), locked (L2). A line has
     * `received − invoiced − returned` units left to invoice (a return takes the units not invoiced
     * first). With `items`, the invoice says how many units of each line and at what net cost, and
     * the lines must add up to its net (one cent of rounding per line, spread by value). Without
     * them, every unit left is invoiced and the difference with the net is spread by value (D1).
     * Each line: what it clears from 2.1.01.02 (`remitoCents`, at the delivery note's cost), its
     * net (`netCents`) and its cost (`costCents`: the net plus the VAT of a B or C invoice).
     * Delivery notes received before ADR-027 have no 'goods_received' entry: they never went
     * through 2.1.01.02 (`legacy*`).
     */
    async _invoiceLines(connection, receptions, { items, netCents, vatToCostCents }) {
        const receptionIds = receptions.map((row) => row.id);
        const label = new Map(receptions.map((row) => [row.id, row.remito_number || row.reception_number]));
        const [bridgedRows] = await connection.query(
            "SELECT DISTINCT reference_id FROM journal_entries WHERE reference_type = 'goods_received' AND reference_id IN (?)",
            [receptionIds]
        );
        const bridgedIds = new Set(bridgedRows.map((row) => row.reference_id));
        const [rows] = await connection.query(
            `SELECT ri.id, ri.reception_id, ri.product_id, p.name AS product_name, ri.quantity_received,
                    COALESCE(ri.returned_quantity, 0) AS returned_quantity, COALESCE(ri.invoiced_quantity, 0) AS invoiced_quantity,
                    ri.unit_cost
             FROM reception_items ri LEFT JOIN products p ON p.id = ri.product_id
             WHERE ri.reception_id IN (?) ORDER BY ri.id FOR UPDATE OF ri`,
            [receptionIds]
        );
        const all = rows.map((row) => ({
            id: row.id,
            receptionId: row.reception_id,
            productId: row.product_id,
            productName: row.product_name || 'Un producto',
            left: Math.max(0, Number(row.quantity_received || 0) - Number(row.invoiced_quantity || 0) - Number(row.returned_quantity || 0)),
            unitCost: roundCost(row.unit_cost),
            bridged: bridgedIds.has(row.reception_id),
            quantity: 0,
            netCents: 0,
        }));
        const exhausted = receptions.filter((row) => !all.some((line) => line.receptionId === row.id && line.left > 0));
        if (exhausted.length > 0) {
            throw businessError(409, {
                error: 'reception_already_invoiced',
                message: `Estos remitos ya están facturados (o devueltos) completos: ${exhausted.map((row) => label.get(row.id)).join(', ')}.`,
            });
        }

        const explicit = Array.isArray(items) && items.length > 0;
        if (explicit) {
            const byId = new Map(all.map((line) => [line.id, line]));
            const seen = new Set();
            for (const item of items) {
                const line = byId.get(item.reception_item_id);
                const quantity = Number(item.quantity);
                if (!line || seen.has(item.reception_item_id) || !Number.isInteger(quantity) || quantity < 0) {
                    throw businessError(400, { error: 'invalid_invoice_item', message: 'Alguna línea no es de los remitos elegidos, está repetida o tiene una cantidad inválida.' });
                }
                seen.add(item.reception_item_id);
                if (quantity > line.left) {
                    throw businessError(409, {
                        error: 'invoice_exceeds_reception',
                        message: `De ${line.productName} quedan ${line.left} u. por facturar en el remito ${label.get(line.receptionId)}.`,
                    });
                }
                line.quantity = quantity;
                line.netCents = valueCents(quantity, item.unit_cost);
            }
        } else {
            for (const line of all) {
                line.quantity = line.left;
                line.netCents = valueCents(line.left, line.unitCost);
            }
        }
        const lines = all.filter((line) => line.quantity > 0);
        if (lines.length === 0) {
            throw businessError(400, { error: 'invoice_without_items', message: 'Indicá al menos una línea con unidades facturadas.' });
        }
        for (const line of lines) line.remitoCents = valueCents(line.quantity, line.unitCost);

        // What the lines add up to against the invoice's net: rounding (with lines) or the whole
        // difference (without them), spread over the lines by value.
        const residualCents = netCents - lines.reduce((sum, line) => sum + line.netCents, 0);
        if (explicit && Math.abs(residualCents) > lines.length) {
            const linesNet = (netCents - residualCents) / 100;
            throw businessError(400, {
                error: 'invoice_items_mismatch',
                message: `Las líneas suman $${linesNet.toFixed(2)} y el neto de la factura es $${(netCents / 100).toFixed(2)}: revisá las unidades y los costos.`,
            });
        }
        const residualShares = allocateCents(residualCents, lines.map((line) => line.remitoCents));
        lines.forEach((line, index) => { line.netCents += residualShares[index]; });
        const vatShares = allocateCents(vatToCostCents, lines.map((line) => line.netCents));
        lines.forEach((line, index) => { line.costCents = line.netCents + (vatToCostCents ? vatShares[index] : 0); });

        const totals = { pendingCents: 0, legacyCents: 0, bridgedCostCents: 0, legacyCostCents: 0 };
        const clearedByReception = new Map();
        for (const line of lines) {
            if (line.bridged) {
                totals.pendingCents += line.remitoCents;
                totals.bridgedCostCents += line.costCents;
                clearedByReception.set(line.receptionId, (clearedByReception.get(line.receptionId) || 0) + line.remitoCents);
            } else {
                totals.legacyCents += line.remitoCents;
                totals.legacyCostCents += line.costCents;
                if (!clearedByReception.has(line.receptionId)) clearedByReception.set(line.receptionId, null);
            }
        }
        return { ...totals, lines, receptionIds: [...clearedByReception.keys()], clearedByReception };
    }

    /**
     * D1: a product that follows the last purchase (auto_update_cost) takes what this invoice
     * charged for it per unit, revaluing its stock. Only when its cost is still the delivery note's
     * (nobody changed it since): otherwise the difference stays as holding result. Lines of delivery
     * notes received before ADR-027 do not move the cost. Returns the costs that changed.
     */
    async _correctCosts(connection, lines, { userId, invoiceId }) {
        const byProduct = new Map();
        for (const line of lines) {
            if (!line.bridged) continue;
            const current = byProduct.get(line.productId) || { quantity: 0, cents: 0, remitoCents: 0, costs: new Set() };
            current.quantity += line.quantity;
            current.cents += line.costCents;
            current.remitoCents += line.remitoCents;
            current.costs.add(line.unitCost);
            byProduct.set(line.productId, current);
        }
        // Invoiced at the delivery note's cost: it already is the cost, nothing to lock or change.
        for (const [productId, line] of byProduct) if (line.cents === line.remitoCents) byProduct.delete(productId);
        if (byProduct.size === 0) return [];
        const productIds = [...byProduct.keys()];
        const stockByProduct = await this.valuation.lockStock(connection, productIds);
        const products = await this.valuation.lockCosts(connection, productIds, { forUpdate: true });
        const updates = [];
        for (const [productId, line] of byProduct) {
            const product = products.get(productId);
            if (!product || Number(product.auto_update_cost ?? 1) === 0) continue;
            if (line.costs.size !== 1 || ![...line.costs][0] || [...line.costs][0] !== effectiveCost(product)) continue;
            const newCost = roundCost(line.cents / line.quantity / 100);
            if (!(newCost > 0)) continue;
            const changed = await this.valuation.changeCost(connection, {
                product,
                stockRows: stockByProduct.get(productId) || [],
                newCost,
                userId,
                source: 'supplier_invoice',
                details: { supplier_invoice_id: invoiceId },
            });
            if (changed) {
                updates.push({
                    product_id: productId,
                    name: product.name,
                    old_cost: changed.oldCost,
                    new_cost: changed.cost,
                    ...(changed.salePrice != null ? { new_sale_price: changed.salePrice } : {}),
                });
            }
        }
        return updates;
    }

    async getPendingSupplierInvoices(filters = {}) {
        const { supplier_id } = filters;
        let query = `
            SELECT si.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id
            FROM supplier_invoices si
            LEFT JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.status != 'cancelled'
              AND si.payment_status IN ('pending', 'partial')
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND si.supplier_id = ?';
            params.push(supplier_id);
        }

        query += ' ORDER BY si.issue_date ASC';

        const [rows] = await pool.query(query, params);

        // Get paid amounts from supplier_payments to compute exact pending amount
        if (rows.length > 0) {
            const invoiceIds = rows.map(r => r.id);
            const [paymentRows] = await pool.query(`
                SELECT supplier_invoice_id, SUM(amount) as paid_amount
                FROM supplier_payments
                WHERE supplier_invoice_id IN (?)
                GROUP BY supplier_invoice_id
            `, [invoiceIds]);

            const paidMap = {};
            for (const pr of paymentRows) {
                paidMap[pr.supplier_invoice_id] = Number(pr.paid_amount || 0);
            }

            for (const row of rows) {
                const paid = paidMap[row.id] || 0;
                const total = Number(row.total_amount || 0);
                row.paid_amount = paid;
                row.pending_amount = Math.max(0, total - paid);
            }
        }

        return rows;
    }

    /** Libro IVA Compras: approved supplier invoices plus approved returns as negative entries. */
    async getPurchasesVatBook() {
        // 1. Get all approved supplier invoices
        const [invoices] = await pool.query(`
            SELECT si.invoice_number, si.invoice_type, si.issue_date, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   si.net_amount, si.vat_amount, si.other_taxes, si.total_amount
            FROM supplier_invoices si
            JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.status = 'approved'
            ORDER BY si.issue_date DESC
        `);

        // 2. Get all approved returns
        const [returns] = await pool.query(`
            SELECT sr.return_number, sr.created_at, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   COALESCE(SUM(sri.quantity * sri.unit_cost), 0) AS subtotal
            FROM supplier_returns sr
            JOIN suppliers s ON sr.supplier_id = s.id
            JOIN supplier_return_items sri ON sri.return_id = sr.id
            WHERE sr.status = 'approved'
            GROUP BY sr.id, sr.return_number, sr.created_at, s.name, s.tax_id
            ORDER BY sr.created_at DESC
        `);

        const taxRate = await purchaseOrderService.getTaxRate();

        // 3. Merge and sort chronologically
        const records = [];
        for (const inv of invoices) {
            const net = Number(inv.net_amount || 0);
            const iva = Number(inv.vat_amount || 0);
            const taxes = Number(inv.other_taxes || 0);
            const total = Number(inv.total_amount || (net + iva + taxes));
            records.push({
                date: new Date(inv.issue_date),
                type: `Factura ${inv.invoice_type}`,
                number: inv.invoice_number,
                tax_id: inv.supplier_tax_id || '-',
                supplier_name: inv.supplier_name,
                subtotal: net,
                iva: iva,
                total: total
            });
        }

        for (const ret of returns) {
            const sub = Number(ret.subtotal || 0);
            const iva = sub * taxRate;
            const total = sub + iva;
            records.push({
                date: new Date(ret.created_at),
                type: 'Devolución (Egreso/Ajuste)',
                number: ret.return_number,
                tax_id: ret.supplier_tax_id || '-',
                supplier_name: ret.supplier_name,
                subtotal: -sub,
                iva: -iva,
                total: -total
            });
        }

        // Sort chronologically descending
        records.sort((a, b) => b.date.getTime() - a.date.getTime());

        return records;
    }
}

export default new SupplierInvoiceService();
