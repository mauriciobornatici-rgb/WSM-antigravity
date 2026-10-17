// ADR-027: checks that the ledger of Inventario (1.1.04.01) equals the stock valued at the
// product cost, to the cent. Read only: every query is a plain SELECT.
import { UNVALUED_LOCATIONS } from '../../domains/inventory/InventoryValuation.js';

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

    const differenceCents = cents(ledger.balance) - cents(valued.value);
    return {
        ok: differenceCents === 0,
        inventory_ledger: cents(ledger.balance) / 100,
        stock_valued: cents(valued.value) / 100,
        difference: differenceCents / 100,
        valued_units: Number(valued.quantity),
        products_with_stock_and_no_cost: uncosted.map((row) => ({ id: row.id, sku: row.sku, name: row.name, quantity: Number(row.quantity) })),
        valuation_since: since,
        sales_without_entry: { movements: Number(unposted.movements), value: cents(unposted.value) / 100 },
        goods_to_invoice_balance: cents(bridge.balance) / 100,
    };
}
