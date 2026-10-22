import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { businessError } from '../../utils/businessError.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { allocateCents } from '../../utils/vatMath.js';
import defaultValuation, { effectiveCost, roundCost, valueCents } from '../inventory/InventoryValuation.js';
import { purchaseDocumentAmounts, vatCreditByAccount } from './purchaseDocumentAmounts.js';

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
        // ADR-029: what its credit notes settled of the credit expected, and their total.
        let query = `
            SELECT si.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   r.reception_number, po.po_number,
                   COALESCE(cn.applied_amount, 0) AS credit_applied_amount,
                   COALESCE(cn.total_amount, 0) AS credit_notes_total
            FROM supplier_invoices si
            LEFT JOIN (
                SELECT supplier_invoice_id, SUM(applied_amount) AS applied_amount, SUM(total_amount) AS total_amount
                FROM supplier_credit_notes GROUP BY supplier_invoice_id
            ) cn ON cn.supplier_invoice_id = si.id
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
            notes
        } = data;

        const id = crypto.randomUUID();
        // ADR-019: one invoice may cover one or several delivery notes (receptions).
        const receptionIds = [...new Set([...(Array.isArray(data.reception_ids) ? data.reception_ids : []), reception_id].filter(Boolean))];
        const { vatLines, net, vat, taxes, total } = purchaseDocumentAmounts(data);
        const purchaseKind = data.purchase_kind || 'goods';
        if (purchaseKind !== 'goods' && (receptionIds.length > 0 || purchase_order_id)) {
            throw businessError(400, {
                error: 'invalid_purchase_kind',
                message: 'Una factura vinculada a una recepción u orden de compra es de mercadería.'
            });
        }
        // ADR-028: lines say what is charged of each delivery note, so they come with them.
        if (Array.isArray(data.items) && data.items.length > 0 && receptionIds.length === 0) {
            throw businessError(400, { error: 'invalid_invoice_item', message: 'Las líneas de la factura van con los remitos que cobra.' });
        }
        // ADR-027 (D2): goods enter the stock and the ledger with their delivery note; an invoice
        // without one would book goods that never came in.
        if (purchaseKind === 'goods' && receptionIds.length === 0) {
            throw businessError(409, {
                error: 'goods_invoice_requires_reception',
                message: 'Una factura de mercadería se carga contra su remito: registrá la recepción (puede ser sin orden de compra) y elegila en la factura.'
            });
        }
        // ADR-029: units charged beyond what the delivery notes have left, only when the user says
        // the supplier will send a credit note for them.
        const expectCreditNote = data.expect_credit_note === true;
        if (expectCreditNote && !(Array.isArray(data.items) && data.items.length > 0)) {
            throw businessError(400, {
                error: 'invalid_invoice_item',
                message: 'Para esperar una nota de crédito, indicá las unidades que cobró el proveedor en cada línea.',
            });
        }
        const creatorId = userId || null;

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
                    expectCreditNote,
                });
                receptionsNet = (bridge.pendingCents + bridge.legacyCents) / 100;
            }

            // Locks for a new cost: stock (L3) and products (L4), before any entry.
            // The holding result: what the units received cost against what they cleared (the units
            // charged beyond them wait for a credit note). ADR-029 (contadora): in a delivery note
            // received before ADR-027, only its value settles 3.1.02.02; a price difference invoiced
            // this year is a result of this year, like any other.
            const differenceCents = bridge
                ? bridge.bridgedCostCents + bridge.legacyCostCents - bridge.pendingCents - bridge.legacyCents
                : 0;
            const costUpdates = bridge
                ? await this._correctCosts(connection, bridge.lines, { userId: creatorId, invoiceId: id })
                : [];

            // 2. Insert Supplier Invoice
            await connection.query(`
                INSERT INTO supplier_invoices (
                    id, invoice_number, invoice_type, supplier_id, reception_id, purchase_order_id,
                    issue_date, due_date, net_amount, vat_amount, other_taxes, total_amount, status, notes, created_by,
                    purchase_kind, credit_expected_amount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)
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
                purchaseKind,
                (bridge?.creditExpectedCents || 0) / 100
            ]);
            // ADR-028: what this invoice charged per delivery note line, and the units it took.
            // ADR-029: the units charged beyond them (excess_quantity) are not taken from the line.
            for (const line of bridge?.lines || []) {
                if (line.quantity > 0) {
                    await connection.query(
                        'UPDATE reception_items SET invoiced_quantity = invoiced_quantity + ? WHERE id = ?',
                        [line.quantity, line.id]
                    );
                }
                await connection.query(
                    `INSERT INTO supplier_invoice_items
                        (id, supplier_invoice_id, reception_id, reception_item_id, product_id, quantity, unit_cost, cleared_amount, product_cost,
                         excess_quantity)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), id, line.receptionId, line.id, line.productId, line.quantity,
                        roundCost(line.netCents / (line.quantity + line.excess) / 100), line.bridged ? line.remitoCents / 100 : null,
                        line.productCost, line.excess]
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
            const creditByAccount = givesCredit ? vatCreditByAccount(rateLines) : new Map();
            // Goods whose delivery notes went through 2.1.01.02 clear it, and what they cost beyond
            // (or below) it is holding result. Delivery notes received before ADR-027 never did: the
            // transition valued their goods with the stock against 3.1.02.02 (ADR-028, earlier
            // years), so their value at the delivery note's cost settles that adjustment instead of
            // adding inventory again (before the transition, its final adjustment nets the same amount).
            const goodsLines = bridge
                ? [
                    { account_code: ACCOUNTS.GOODS_TO_INVOICE, debit: bridge.pendingCents / 100, credit: 0, notes: 'Mercadería recibida a facturar' },
                    {
                        account_code: ACCOUNTS.PRIOR_PERIOD_ADJUSTMENT,
                        debit: bridge.legacyCents / 100,
                        credit: 0,
                        notes: 'Remito anterior a la valuación por costo de última compra',
                    },
                    {
                        account_code: ACCOUNTS.HOLDING_RESULT,
                        debit: differenceCents > 0 ? differenceCents / 100 : 0,
                        credit: differenceCents < 0 ? -differenceCents / 100 : 0,
                        notes: 'Diferencia entre lo facturado y lo recibido',
                    },
                    // ADR-029: units charged beyond the delivery notes, until the supplier's credit note.
                    {
                        account_code: ACCOUNTS.CREDIT_NOTES_TO_RECEIVE,
                        debit: bridge.creditExpectedCents / 100,
                        credit: 0,
                        notes: 'Unidades facturadas de más: nota de crédito a recibir',
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
                    ...(bridge?.creditExpectedCents
                        ? {
                            credit_expected: bridge.creditExpectedCents / 100,
                            excess_items: bridge.lines.filter((line) => line.excess > 0)
                                .map((line) => ({ reception_item_id: line.id, product_id: line.productId, excess_quantity: line.excess })),
                        }
                        : {}),
                    ...(costUpdates.length > 0 ? { cost_updates: costUpdates } : {})
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();

            // ADR-019: what the delivery notes received (at their cost) against the invoice's net:
            // a difference is shown to the user (it is not blocked: prices or extras can differ).
            // ADR-029: the net of the units charged of more is not a price difference (it is owed back).
            return {
                id,
                success: true,
                total_amount: total,
                reception_ids: receptionIds,
                ...(receptionsNet != null
                    ? {
                        receptions_net: receptionsNet,
                        receptions_difference: (Math.round(net * 100) - Math.round(receptionsNet * 100) - bridge.excessNetCents) / 100,
                    }
                    : {}),
                ...(bridge?.creditExpectedCents ? { credit_expected: bridge.creditExpectedCents / 100 } : {}),
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
     * ADR-029: with `expectCreditNote`, a line may charge more units than it has left (`excess`):
     * their share of the line's cost waits for the supplier's credit note (`creditExpectedCents`),
     * and only the units left are taken from the line.
     */
    async _invoiceLines(connection, receptions, { items, netCents, vatToCostCents, expectCreditNote = false }) {
        const receptionIds = receptions.map((row) => row.id);
        const label = new Map(receptions.map((row) => [row.id, row.remito_number || row.reception_number]));
        // A locking read: a delivery note approved while this invoice waited for its lock is seen
        // as bridged (a plain read could still use an older snapshot).
        const [bridgedRows] = await connection.query(
            "SELECT DISTINCT reference_id FROM journal_entries WHERE reference_type = 'goods_received' AND reference_id IN (?) FOR SHARE",
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
        // What earlier invoices of these lines left as the product's cost (an invoice in parts).
        const [earlierRows] = rows.length > 0
            ? await connection.query(
                `SELECT sii.reception_item_id, sii.product_cost
                 FROM supplier_invoice_items sii JOIN supplier_invoices si ON si.id = sii.supplier_invoice_id
                 WHERE sii.reception_item_id IN (?) AND sii.product_cost IS NOT NULL AND COALESCE(si.status, '') <> 'cancelled'`,
                [rows.map((row) => row.id)]
            )
            : [[]];
        const earlierByLine = new Map();
        for (const row of earlierRows) {
            earlierByLine.set(row.reception_item_id, [...(earlierByLine.get(row.reception_item_id) || []), roundCost(row.product_cost)]);
        }
        const all = rows.map((row) => ({
            id: row.id,
            receptionId: row.reception_id,
            productId: row.product_id,
            productName: row.product_name || 'Un producto',
            left: Math.max(0, Number(row.quantity_received || 0) - Number(row.invoiced_quantity || 0) - Number(row.returned_quantity || 0)),
            unitCost: roundCost(row.unit_cost),
            // What earlier invoices of this line left as the product's cost (an invoice in parts).
            earlierInvoicedCosts: earlierByLine.get(row.id) || [],
            bridged: bridgedIds.has(row.reception_id),
            quantity: 0,
            excess: 0,
            netCents: 0,
        }));
        const explicit = Array.isArray(items) && items.length > 0;
        // A delivery note with nothing left can only be charged again as units owed back (ADR-029).
        const exhausted = receptions.filter((row) => !all.some((line) => line.receptionId === row.id && line.left > 0));
        if (exhausted.length > 0 && !(explicit && expectCreditNote)) {
            throw businessError(409, {
                error: 'reception_already_invoiced',
                message: `Estos remitos ya están facturados (o devueltos) completos: ${exhausted.map((row) => label.get(row.id)).join(', ')}.`,
            });
        }

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
                if (quantity > line.left && !expectCreditNote) {
                    throw businessError(409, {
                        error: 'invoice_exceeds_reception',
                        message: `De ${line.productName} quedan ${line.left} u. por facturar en el remito ${label.get(line.receptionId)}. `
                            + 'Si el proveedor cobró de más, marcá que vas a recibir su nota de crédito.',
                    });
                }
                line.quantity = Math.min(quantity, line.left);
                line.excess = quantity - line.quantity;
                // The unit price as the invoice prints it (it may have more than 2 decimals): the
                // line's amount is rounded once, not the price before multiplying.
                line.netCents = Math.round(Number((quantity * Number(item.unit_cost)).toFixed(4)) * 100);
            }
        } else {
            for (const line of all) {
                line.quantity = line.left;
                line.netCents = valueCents(line.left, line.unitCost);
            }
        }
        const lines = all.filter((line) => line.quantity + line.excess > 0);
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
        const residualShares = allocateCents(residualCents, lines.map((line) => valueCents(line.quantity + line.excess, line.unitCost)));
        lines.forEach((line, index) => { line.netCents += residualShares[index]; });
        const vatShares = allocateCents(vatToCostCents, lines.map((line) => line.netCents));
        lines.forEach((line, index) => { line.costCents = line.netCents + (vatToCostCents ? vatShares[index] : 0); });
        // ADR-029: the units charged beyond what was left, at the line's price, wait for the credit
        // note; the rest is what the units received cost.
        for (const line of lines) {
            line.excessCents = line.excess > 0 ? Math.round(line.costCents * line.excess / (line.quantity + line.excess)) : 0;
            line.excessNetCents = line.excess > 0 ? Math.round(line.netCents * line.excess / (line.quantity + line.excess)) : 0;
            line.receivedCostCents = line.costCents - line.excessCents;
        }
        // The cost per unit this invoice gives each product (its lines with units received), kept
        // with the lines. A line that only charged units owed back gives none (AUD-018).
        const perProduct = new Map();
        for (const line of lines) {
            if (line.quantity === 0) continue;
            const current = perProduct.get(line.productId) || { cents: 0, quantity: 0 };
            current.cents += line.costCents;
            current.quantity += line.quantity + line.excess;
            perProduct.set(line.productId, current);
        }
        for (const line of lines) {
            const product = line.quantity > 0 ? perProduct.get(line.productId) : null;
            line.productCost = product ? roundCost(product.cents / product.quantity / 100) : null;
        }

        const totals = { pendingCents: 0, legacyCents: 0, bridgedCostCents: 0, legacyCostCents: 0, creditExpectedCents: 0, excessNetCents: 0 };
        const clearedByReception = new Map();
        for (const line of lines) {
            totals.creditExpectedCents += line.excessCents;
            totals.excessNetCents += line.excessNetCents;
            if (line.bridged) {
                totals.pendingCents += line.remitoCents;
                totals.bridgedCostCents += line.receivedCostCents;
                clearedByReception.set(line.receptionId, (clearedByReception.get(line.receptionId) || 0) + line.remitoCents);
            } else {
                totals.legacyCents += line.remitoCents;
                totals.legacyCostCents += line.receivedCostCents;
                if (!clearedByReception.has(line.receptionId)) clearedByReception.set(line.receptionId, null);
            }
        }
        return { ...totals, lines, receptionIds: [...clearedByReception.keys()], clearedByReception };
    }

    /**
     * D1: a product that follows the last purchase (auto_update_cost) takes what this invoice
     * charged for it per unit, revaluing its stock. Only when its cost is still this delivery
     * note's: its cost, or what an earlier invoice of the same line left (an invoice in parts). If
     * anything else changed it since (a newer purchase, a manual edit), the difference stays as
     * holding result. Lines of delivery notes received before ADR-027 do not move the cost, nor do
     * lines that only charged units owed back (ADR-029). Returns the costs that changed.
     */
    async _correctCosts(connection, lines, { userId, invoiceId }) {
        const byProduct = new Map();
        for (const line of lines) {
            if (!line.bridged || line.quantity === 0) continue;
            const current = byProduct.get(line.productId)
                || { quantity: 0, cents: 0, receivedCents: 0, remitoCents: 0, costs: new Set(), earlierInvoiced: new Set() };
            // The price per unit charged (excess units included, at the same price).
            current.quantity += line.quantity + (line.excess || 0);
            current.cents += line.costCents;
            current.receivedCents += line.receivedCostCents ?? line.costCents;
            current.remitoCents += line.remitoCents;
            current.costs.add(line.unitCost);
            for (const cost of line.earlierInvoicedCosts || []) current.earlierInvoiced.add(cost);
            byProduct.set(line.productId, current);
        }
        // Invoiced at the delivery note's cost and never invoiced before: it already is the cost.
        for (const [productId, line] of byProduct) {
            if (line.receivedCents === line.remitoCents && line.earlierInvoiced.size === 0) byProduct.delete(productId);
        }
        if (byProduct.size === 0) return [];
        const productIds = [...byProduct.keys()];
        const stockByProduct = await this.valuation.lockStock(connection, productIds);
        const products = await this.valuation.lockCosts(connection, productIds, { forUpdate: true });
        const updates = [];
        for (const [productId, line] of byProduct) {
            const product = products.get(productId);
            if (!product || Number(product.auto_update_cost ?? 1) === 0) continue;
            const today = effectiveCost(product);
            const remitoCost = line.costs.size === 1 ? [...line.costs][0] : null;
            if (!(remitoCost && remitoCost === today) && !line.earlierInvoiced.has(today)) continue;
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
            // ADR-029: the supplier's credit notes against an invoice lower what is left to pay.
            const [creditRows] = await pool.query(`
                SELECT supplier_invoice_id, SUM(total_amount) AS credited_amount
                FROM supplier_credit_notes
                WHERE supplier_invoice_id IN (?)
                GROUP BY supplier_invoice_id
            `, [invoiceIds]);
            const creditedMap = {};
            for (const cr of creditRows || []) {
                creditedMap[cr.supplier_invoice_id] = Number(cr.credited_amount || 0);
            }

            for (const row of rows) {
                const paid = paidMap[row.id] || 0;
                const credited = creditedMap[row.id] || 0;
                const total = Number(row.total_amount || 0);
                row.paid_amount = paid;
                row.credited_amount = credited;
                row.pending_amount = Math.max(0, Math.round((total - paid - credited) * 100) / 100);
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

        // 2. Approved returns, as the ledger booked them (AUD-017): only what lowered the debt with the
        // supplier, and the VAT credit actually reversed. Units the supplier had not invoiced yet
        // (against 2.1.01.02) are no fiscal document and stay out.
        const [returns] = await pool.query(`
            SELECT sr.return_number, sr.created_at, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   COALESCE(SUM(CASE WHEN jl.account_code = ? THEN jl.debit ELSE 0 END), 0) AS gross,
                   COALESCE(SUM(CASE WHEN jl.account_code LIKE '1.1.05.%' AND jl.account_code <> ? THEN jl.credit ELSE 0 END), 0) AS vat
            FROM supplier_returns sr
            JOIN suppliers s ON sr.supplier_id = s.id
            JOIN journal_entries je ON je.reference_type = 'supplier_return' AND je.reference_id = sr.id
            JOIN journal_entry_lines jl ON jl.journal_entry_id = je.id
            WHERE sr.status = 'approved'
            GROUP BY sr.id, sr.return_number, sr.created_at, s.name, s.tax_id
            HAVING gross > 0
            ORDER BY sr.created_at DESC
        `, [ACCOUNTS.SUPPLIERS, ACCOUNTS.WITHHOLDINGS]);

        // 3. The supplier's credit notes (ADR-029), negative.
        const [creditNotes] = await pool.query(`
            SELECT scn.credit_note_type, scn.credit_note_number, scn.issue_date, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   scn.net_amount, scn.vat_amount, scn.other_taxes, scn.total_amount
            FROM supplier_credit_notes scn
            JOIN suppliers s ON scn.supplier_id = s.id
            ORDER BY scn.issue_date DESC
        `);

        // 4. Merge and sort chronologically
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
            const total = Math.round(Number(ret.gross || 0) * 100) / 100;
            const iva = Math.round(Number(ret.vat || 0) * 100) / 100;
            const sub = Math.round((total - iva) * 100) / 100;
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

        for (const note of creditNotes || []) {
            records.push({
                date: new Date(note.issue_date),
                type: `Nota de crédito ${note.credit_note_type}`,
                number: note.credit_note_number,
                tax_id: note.supplier_tax_id || '-',
                supplier_name: note.supplier_name,
                subtotal: -Number(note.net_amount || 0),
                iva: -Number(note.vat_amount || 0),
                total: -Number(note.total_amount || 0)
            });
        }

        // Sort chronologically descending
        records.sort((a, b) => b.date.getTime() - a.date.getTime());

        return records;
    }
}

export default new SupplierInvoiceService();
