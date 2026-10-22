// ADR-027: checks that the ledger of Inventario (1.1.04.01) equals the stock valued at the
// product cost, to the cent. Read only: every query is a plain SELECT.
import { UNVALUED_LOCATIONS, effectiveCost, valueCents } from '../../domains/inventory/InventoryValuation.js';
import { invoicedByOrderSql } from '../../domains/procurement/receptionInvoicing.js';
import { BUSINESS_TIME_ZONE, businessYear } from '../../utils/businessDate.js';

const cents = (value) => Math.round(Number(value || 0) * 100);

export async function checkInventoryValuation(connection) {
    const [[ledger]] = await connection.query(
        "SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM journal_entry_lines WHERE account_code = '1.1.04.01'"
    );
    const [[valued]] = await connection.query(
        `SELECT COALESCE(SUM(i.quantity * COALESCE(NULLIF(p.purchase_price, 0), p.cost_price, 0)), 0) AS value,
                COALESCE(SUM(i.quantity), 0) AS quantity
         FROM inventory i JOIN products p ON p.id = i.product_id
         WHERE i.location NOT IN (?)`,
        [UNVALUED_LOCATIONS]
    );
    const [uncosted] = await connection.query(
        `SELECT p.id, p.sku, p.name, SUM(i.quantity) AS quantity
         FROM inventory i JOIN products p ON p.id = i.product_id
         WHERE i.location NOT IN (?) AND COALESCE(NULLIF(p.purchase_price, 0), p.cost_price, 0) = 0
         GROUP BY p.id, p.sku, p.name
         HAVING SUM(i.quantity) <> 0
         ORDER BY p.sku`,
        [UNVALUED_LOCATIONS]
    );
    const [[settings]] = await connection.query('SELECT inventory_valuation_since AS since FROM company_settings ORDER BY id LIMIT 1');
    const since = settings?.since || null;
    // Sales that left with a cost and no entry: before the cut-over these are the old rule (the
    // invoice posts them); after it, a path that forgot to post.
    const [[unposted]] = await connection.query(
        `SELECT COUNT(*) AS movements, COALESCE(SUM(quantity * unit_cost), 0) AS value
         FROM inventory_movements
         WHERE type = 'sale' AND journal_entry_id IS NULL AND unit_cost > 0
           ${since ? 'AND created_at >= ?' : ''}`,
        since ? [since] : []
    );
    const [[bridge]] = await connection.query(
        "SELECT COALESCE(SUM(credit - debit), 0) AS balance FROM journal_entry_lines WHERE account_code = '2.1.01.02'"
    );
    // What the delivery notes that went through 2.1.01.02 still owe: their units not invoiced nor
    // returned (ADR-028: a delivery note may be invoiced in parts).
    const [[pending]] = await connection.query(
        `SELECT COALESCE(SUM(GREATEST(ri.quantity_received - COALESCE(ri.invoiced_quantity, 0) - COALESCE(ri.returned_quantity, 0), 0) * ri.unit_cost), 0) AS value
         FROM reception_items ri
         WHERE ri.reception_id IN (SELECT je.reference_id FROM journal_entries je WHERE je.reference_type = 'goods_received')`
    );

    const differenceCents = cents(ledger.balance) - cents(valued.value);
    const bridgeDifferenceCents = cents(bridge.balance) - cents(pending.value);
    return {
        ok: differenceCents === 0 && bridgeDifferenceCents === 0,
        inventory_ledger: cents(ledger.balance) / 100,
        stock_valued: cents(valued.value) / 100,
        difference: differenceCents / 100,
        valued_units: Number(valued.quantity),
        products_with_stock_and_no_cost: uncosted.map((row) => ({ id: row.id, sku: row.sku, name: row.name, quantity: Number(row.quantity) })),
        valuation_since: since,
        sales_without_entry: { movements: Number(unposted.movements), value: cents(unposted.value) / 100 },
        goods_to_invoice_balance: cents(bridge.balance) / 100,
        goods_to_invoice_pending: cents(pending.value) / 100,
        goods_to_invoice_difference: bridgeDifferenceCents / 100,
    };
}

/**
 * The instant a fiscal year starts: midnight of that day in Argentina (UTC−3, no daylight saving),
 * whatever the server's timezone. Null for anything but a real AAAA-MM-DD date.
 */
export function fiscalYearStartOf(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
    if (!match) return null;
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00-03:00`);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return local === `${match[1]}-${match[2]}-${match[3]}` ? date : null;
}

export const CUTOVER_REFERENCE = 'inventory_valuation_cutover';
export const CUTOVER_AUDIT_ACTION = 'INVENTORY_VALUATION_CUTOVER';

/**
 * What must be true before the cut-over: the valuation migrations, the C1 stock repair done, and
 * no purchase posted twice (an unreversed 'reception' entry). Returns the problems found.
 */
export async function checkCutoverPreconditions(connection, { findAffectedOrders, findReceptionEntries }) {
    const problems = [];
    const [accounts] = await connection.query("SELECT code FROM chart_of_accounts WHERE code IN ('4.2.02.01', '2.1.01.02', '3.1.02.02')");
    if (accounts.length < 3) problems.push('Faltan las migraciones 064/065/067 (cuentas 4.2.02.01, 2.1.01.02 y 3.1.02.02).');
    const [columns] = await connection.query(
        `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND CONCAT(TABLE_NAME, '.', COLUMN_NAME) IN
               ('inventory_movements.journal_entry_id', 'company_settings.inventory_valuation_since',
                'supplier_invoice_receptions.cleared_amount', 'reception_items.invoiced_quantity')`
    );
    if (columns.length < 4) problems.push('Faltan las migraciones 065/066/067 (columnas de la valuación).');
    const pendingC1 = await findAffectedOrders(connection);
    if (pendingC1.length > 0) problems.push(`Hay ${pendingC1.length} ventas POS sin descontar stock: corré antes RUNBOOK_REPARACION_STOCK_C1.`);
    const duplicates = await findReceptionEntries(connection);
    if (duplicates.length > 0) problems.push(`Hay ${duplicates.length} asientos de recepción sin revertir: corré antes RUNBOOK_ASIENTOS_COMPRA_DUPLICADOS.`);
    return problems;
}

/**
 * The cut-over to ADR-027 (one transaction, the caller commits or rolls back): it aligns the
 * ledger of Inventario with the stock at cost and opens 2.1.01.02 for the delivery notes not yet
 * invoiced. Runs once: a second run finds inventory_valuation_since set and does nothing.
 * `accounting` posts entries (accounting.service), `audit` logs (audit.service).
 * `fiscalYearStart`: the instant the fiscal year in course starts (ADR-028): what belongs to earlier
 * years goes to 3.1.02.02. By default, January 1 of this year at midnight in Argentina.
 */
export async function runCutover(connection, { runId, userId = null, accounting, audit, fiscalYearStart = fiscalYearStartOf(`${businessYear()}-01-01`) }) {
    // The cut-over date lives in the company settings (row 1, the one the app uses): without it a
    // second run would not know it was done.
    await connection.query('INSERT IGNORE INTO company_settings (id) VALUES (1)');
    const [[settings]] = await connection.query('SELECT id, inventory_valuation_since AS since FROM company_settings ORDER BY id LIMIT 1 FOR UPDATE');
    if (settings?.since) return { already_done: true, since: settings.since };
    const report = { run_id: runId };

    // 1. One cost per product: purchase_price, taken from cost_price where it was empty.
    const [fromLegacy] = await connection.query(
        'UPDATE products SET purchase_price = cost_price WHERE (purchase_price IS NULL OR purchase_price = 0) AND cost_price > 0'
    );
    await connection.query(
        'UPDATE products SET cost_price = purchase_price WHERE purchase_price > 0 AND (cost_price IS NULL OR cost_price <> purchase_price)'
    );
    report.costs_from_cost_price = Number(fromLegacy?.affectedRows || 0);
    const before = await checkInventoryValuation(connection);
    report.products_with_stock_and_no_cost = before.products_with_stock_and_no_cost;

    // 2a. Sales whose invoice posted the cost (the old rule): their movements keep that entry. An
    // order invoiced and never packed had its cost posted for goods still in stock: that cost is
    // reversed, and packing it posts it (ADR-027, D8).
    const [invoiceCosts] = await connection.query(
        `SELECT je.id AS entry_id, i.id AS invoice_id, i.order_id, o.status AS order_status,
                (SELECT COUNT(*) FROM inventory_movements m WHERE m.reference_type = 'order' AND m.reference_id = i.order_id AND m.type = 'sale') AS movements
         FROM journal_entries je
         JOIN invoices i ON i.id = je.reference_id AND je.reference_type = 'invoice'
         LEFT JOIN orders o ON o.id = i.order_id
         WHERE je.reversal_of_entry_id IS NULL
           AND EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.journal_entry_id = je.id AND l.account_code = '5.1.01.01')
           AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_entry_id = je.id)`
    );
    report.sales_linked_to_invoice_cost = 0;
    report.reversed_costs_of_unpacked_orders = [];
    for (const row of invoiceCosts) {
        if (!row.order_id) continue;
        if (Number(row.movements) > 0) {
            const [linked] = await connection.query(
                `UPDATE inventory_movements SET journal_entry_id = ?
                 WHERE reference_type = 'order' AND reference_id = ? AND type = 'sale' AND journal_entry_id IS NULL`,
                [row.entry_id, row.order_id]
            );
            report.sales_linked_to_invoice_cost += Number(linked?.affectedRows || 0);
        } else if (['pending', 'picking', 'confirmed'].includes(String(row.order_status || '').trim().toLowerCase())) {
            const reversed = await accounting.reverseDocumentEntries(connection, {
                referenceType: 'invoice',
                referenceId: row.invoice_id,
                accountCodes: ['5.1.01.01'],
                description: 'Transición a la valuación por última compra: el costo se registra al armar el pedido',
            });
            if (reversed.length > 0) report.reversed_costs_of_unpacked_orders.push(row.order_id);
        }
    }

    // 2b. Sales that left without any cost posted (not invoiced, or invoiced before the ledger):
    // their cost is posted now, at the cost the movement carries (today's when it has none). A
    // cancelled order brought its goods back: it sold nothing, so no cost (the final adjustment
    // covers the stock either way). ADR-028 (contadora, RT 17): the cost of goods sold in an
    // earlier fiscal year corrects that year's result: it goes to 3.1.02.02, not to this year's.
    const [unposted] = await connection.query(
        `SELECT m.id, m.reference_id AS order_id, m.quantity, m.unit_cost, m.created_at, p.purchase_price, p.cost_price
         FROM inventory_movements m
         LEFT JOIN products p ON p.id = m.product_id
         LEFT JOIN orders o ON o.id = m.reference_id
         WHERE m.type = 'sale' AND m.reference_type = 'order' AND m.journal_entry_id IS NULL
           AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'cancelled'
         ORDER BY m.reference_id, m.id`
    );
    const byOrder = new Map();
    for (const movement of unposted) {
        const cost = Number(movement.unit_cost || 0) > 0 ? Number(movement.unit_cost) : effectiveCost(movement);
        const current = byOrder.get(movement.order_id) || { currentCents: 0, priorCents: 0, ids: [], costs: [] };
        const saleCents = valueCents(movement.quantity, cost);
        if (new Date(movement.created_at) < fiscalYearStart) current.priorCents += saleCents;
        else current.currentCents += saleCents;
        current.ids.push(movement.id);
        // A movement without a cost keeps the one posted: a later cancellation reverses at it.
        if (!(Number(movement.unit_cost || 0) > 0) && cost > 0) current.costs.push([cost, movement.id]);
        byOrder.set(movement.order_id, current);
    }
    report.fiscal_year_start = new Intl.DateTimeFormat('en-CA', {
        timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(fiscalYearStart);
    report.costs_posted_for_sales = { orders: 0, amount: 0, this_year: 0, earlier_years: 0 };
    for (const [orderId, sale] of byOrder) {
        const totalCents = sale.currentCents + sale.priorCents;
        const entryId = await accounting.createJournalEntryIfAny(connection, {
            date: new Date(),
            description: `Transición: costo de mercadería vendida del pedido ${String(orderId).slice(0, 8)}`,
            reference_type: CUTOVER_REFERENCE,
            reference_id: orderId,
            lines: [
                { account_code: '5.1.01.01', debit: sale.currentCents / 100, credit: 0, notes: 'Costo de lo vendido sin registrar' },
                { account_code: '3.1.02.02', debit: sale.priorCents / 100, credit: 0, notes: 'Costo de lo vendido de ejercicios anteriores' },
                { account_code: '1.1.04.01', debit: 0, credit: totalCents / 100, notes: 'Salida de mercadería' },
            ],
        });
        if (!entryId) continue;
        await connection.query('UPDATE inventory_movements SET journal_entry_id = ? WHERE id IN (?)', [entryId, sale.ids]);
        for (const [cost, movementId] of sale.costs) {
            await connection.query('UPDATE inventory_movements SET unit_cost = ? WHERE id = ?', [cost, movementId]);
        }
        const posted = report.costs_posted_for_sales;
        posted.orders += 1;
        posted.amount = (Math.round(posted.amount * 100) + totalCents) / 100;
        posted.this_year = (Math.round(posted.this_year * 100) + sale.currentCents) / 100;
        posted.earlier_years = (Math.round(posted.earlier_years * 100) + sale.priorCents) / 100;
    }

    // 3. Delivery notes approved and not invoiced: their goods enter 2.1.01.02, so the invoice
    // that comes clears it like any other. One whose purchase order was invoiced without naming
    // its delivery notes (before ADR-019 that was the usual way) is not opened: it is listed for
    // review. One opened after the supplier took goods back without a delivery note (before D7)
    // is listed too: its invoice will bring less than what is opened.
    const [openReceptions] = await connection.query(
        `SELECT r.id, r.reception_number, r.remito_number,
                ${invoicedByOrderSql('r')} AS order_invoiced,
                EXISTS (SELECT 1 FROM supplier_returns sr
                        JOIN supplier_return_items sri ON sri.return_id = sr.id
                        WHERE sr.supplier_id = r.supplier_id AND sr.status = 'approved' AND sr.reception_id IS NULL
                          AND sr.created_at >= r.created_at
                          AND sri.product_id IN (SELECT ri2.product_id FROM reception_items ri2 WHERE ri2.reception_id = r.id)) AS returned_after,
                COALESCE(SUM(GREATEST(ri.quantity_received - COALESCE(ri.invoiced_quantity, 0) - COALESCE(ri.returned_quantity, 0), 0) * ri.unit_cost), 0) AS value
         FROM receptions r JOIN reception_items ri ON ri.reception_id = r.id
         WHERE r.status = 'approved'
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.reference_type = 'goods_received' AND je.reference_id = r.id)
         GROUP BY r.id, r.reception_number, r.remito_number, r.purchase_order_id, r.supplier_id, r.created_at
         -- ADR-028: by the units still to invoice, so one invoiced in part opens what is left
         -- (one invoiced in full counts its units as invoiced since the 067).
         HAVING value > 0
         ORDER BY r.id`
    );
    report.opened_goods_to_invoice = { receptions: 0, amount: 0 };
    report.receptions_invoiced_by_their_order = [];
    report.opened_with_returns_after = [];
    for (const reception of openReceptions) {
        const label = { id: reception.id, remito: reception.remito_number || reception.reception_number, value: cents(reception.value) / 100 };
        if (Number(reception.order_invoiced)) {
            report.receptions_invoiced_by_their_order.push(label);
            continue;
        }
        if (Number(reception.returned_after)) report.opened_with_returns_after.push(label);
        const valueCentsTotal = cents(reception.value);
        const entryId = await accounting.createJournalEntryIfAny(connection, {
            date: new Date(),
            description: `Transición: mercadería recibida a facturar, remito ${reception.remito_number || reception.reception_number}`,
            reference_type: 'goods_received',
            reference_id: reception.id,
            lines: [
                { account_code: '1.1.04.01', debit: valueCentsTotal / 100, credit: 0, notes: 'Mercadería recibida sin factura' },
                { account_code: '2.1.01.02', debit: 0, credit: valueCentsTotal / 100, notes: 'Mercadería recibida a facturar' },
            ],
        });
        if (!entryId) continue;
        await connection.query(
            "UPDATE inventory_movements SET journal_entry_id = ? WHERE reference_id = ? AND type = 'reception' AND journal_entry_id IS NULL",
            [entryId, reception.id]
        );
        report.opened_goods_to_invoice.receptions += 1;
        report.opened_goods_to_invoice.amount = Math.round((report.opened_goods_to_invoice.amount + valueCentsTotal / 100) * 100) / 100;
    }

    // 4. What is still apart (purchases invoiced without a delivery note, returns never posted,
    // goods bought at another cost, counts...): one adjustment. ADR-028 (contadora, RT 17): a change
    // of valuation criterion and the errors it corrects come from earlier years: 3.1.02.02 "Ajuste
    // de resultados de ejercicios anteriores", in equity, not the result of the year (D4).
    const middle = await checkInventoryValuation(connection);
    const adjustmentCents = cents(middle.stock_valued) - cents(middle.inventory_ledger);
    if (adjustmentCents !== 0) {
        const value = Math.abs(adjustmentCents) / 100;
        const priorYears = { account_code: '3.1.02.02', notes: 'Ajuste de resultados de ejercicios anteriores (transición)' };
        await accounting.createJournalEntry(connection, {
            date: new Date(),
            description: 'Transición a la valuación por costo de última compra: ajuste del inventario al stock valuado',
            reference_type: CUTOVER_REFERENCE,
            reference_id: runId,
            lines: adjustmentCents > 0
                ? [
                    { account_code: '1.1.04.01', debit: value, credit: 0, notes: 'Stock valuado al costo de última compra' },
                    { ...priorYears, debit: 0, credit: value },
                ]
                : [
                    { ...priorYears, debit: value, credit: 0 },
                    { account_code: '1.1.04.01', debit: 0, credit: value, notes: 'Stock valuado al costo de última compra' },
                ],
        });
    }
    report.adjustment = adjustmentCents / 100;

    // 5. The cut-over date: from here on every movement posts its entry.
    await connection.query('UPDATE company_settings SET inventory_valuation_since = NOW() WHERE id = ?', [settings?.id]);
    report.after = await checkInventoryValuation(connection);
    await audit.log({
        user_id: userId,
        action: CUTOVER_AUDIT_ACTION,
        entity_type: 'company_settings',
        entity_id: String(settings?.id ?? ''),
        new_values: {
            run_id: runId,
            costs_from_cost_price: report.costs_from_cost_price,
            sales_linked_to_invoice_cost: report.sales_linked_to_invoice_cost,
            reversed_costs_of_unpacked_orders: report.reversed_costs_of_unpacked_orders.length,
            fiscal_year_start: report.fiscal_year_start,
            costs_posted_for_sales: report.costs_posted_for_sales,
            opened_goods_to_invoice: report.opened_goods_to_invoice,
            adjustment: report.adjustment,
            ok: report.after.ok,
        },
    }, connection);
    return report;
}
