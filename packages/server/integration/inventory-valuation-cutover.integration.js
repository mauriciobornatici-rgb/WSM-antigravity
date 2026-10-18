import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct, uniqueId } from './helpers/qaDb.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { checkCutoverPreconditions, runCutover, CUTOVER_REFERENCE } from '../scripts/inventory-valuation/valuation.js';

// ADR-027, I8: the cut-over runs inside a transaction that is rolled back here (as the script's
// simulation does), so the shared QA database is left as it was.

test.after(async () => {
    await closePool();
});

async function seedOrder(status) {
    const orderId = crypto.randomUUID();
    await pool.query('INSERT INTO orders (id, total_amount, status) VALUES (?, 0, ?)', [orderId, status]);
    return orderId;
}

async function seedSale(orderId, productId, quantity, unitCost) {
    const id = crypto.randomUUID();
    await pool.query(
        `INSERT INTO inventory_movements (id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id)
         VALUES (?, 'sale', ?, 'QA-A', ?, ?, 'Venta anterior', 'order', ?)`,
        [id, productId, quantity, unitCost, orderId]
    );
    return id;
}

async function seedInvoiceWithCost(orderId, cost) {
    const invoiceId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO invoices (id, order_id, client_name, invoice_type, point_of_sale, invoice_number, net_amount, vat_amount, total_amount, status, issue_date)
         VALUES (?, ?, 'Consumidor final', 'B', 98, FLOOR(RAND() * 1000000000), 100, 21, 121, 'issued', NOW())`,
        [invoiceId, orderId]
    );
    const entryId = await accountingService.createJournalEntry(pool, {
        date: new Date(), description: 'CMV con la regla anterior', reference_type: 'invoice', reference_id: invoiceId,
        lines: [{ account_code: '5.1.01.01', debit: cost, credit: 0 }, { account_code: '1.1.04.01', debit: 0, credit: cost }],
    });
    return { invoiceId, entryId };
}

async function seedApprovedReception(productId, quantity, unitCost) {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const receptionId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO receptions (id, reception_number, supplier_id, remito_number, status) VALUES (?, ?, ?, ?, 'approved')",
        [receptionId, uniqueId('REC'), supplierId, uniqueId('R')]
    );
    await pool.query(
        'INSERT INTO reception_items (id, reception_id, product_id, quantity_received, unit_cost) VALUES (?, ?, ?, ?, ?)',
        [crypto.randomUUID(), receptionId, productId, quantity, unitCost]
    );
    const movementId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO inventory_movements (id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id)
         VALUES (?, 'reception', ?, 'QA-A', ?, ?, 'Recepción anterior', 'reception', ?)`,
        [movementId, productId, quantity, unitCost, receptionId]
    );
    return { receptionId, movementId };
}

test('the cut-over aligns old data with the valuation and runs once (simulated: rolled back)', async () => {
    const [[settings]] = await pool.query('SELECT inventory_valuation_since AS since FROM company_settings ORDER BY id LIMIT 1');
    assert.equal(settings?.since ?? null, null, 'QA never had the cut-over applied');

    // A product whose cost still lives in cost_price.
    const legacyCost = await seedProduct({ cost: 0, stock: [{ location: 'QA-A', quantity: 2 }] });
    await pool.query('UPDATE products SET cost_price = 30 WHERE id = ?', [legacyCost]);
    const productId = await seedProduct({ cost: 50 });
    // An order packed and invoiced with the old rule: its sales keep the invoice's cost entry.
    const invoicedOrder = await seedOrder('completed');
    const invoicedSale = await seedSale(invoicedOrder, productId, 2, 50);
    const invoiced = await seedInvoiceWithCost(invoicedOrder, 100);
    // An order invoiced before packing with the old rule: that cost is reversed (packing posts it).
    const unpackedOrder = await seedOrder('pending');
    const unpacked = await seedInvoiceWithCost(unpackedOrder, 150);
    // An order packed and never invoiced: its cost was never posted.
    const packedOrder = await seedOrder('packed');
    const packedSale = await seedSale(packedOrder, productId, 3, 25);
    // A delivery note approved and not invoiced: it opens 2.1.01.02.
    const reception = await seedApprovedReception(productId, 3, 40);

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const report = await runCutover(connection, { runId: crypto.randomUUID(), accounting: accountingService, audit: auditService });

        const [[normalized]] = await connection.query('SELECT purchase_price, cost_price FROM products WHERE id = ?', [legacyCost]);
        assert.deepEqual([Number(normalized.purchase_price), Number(normalized.cost_price)], [30, 30]);
        assert.ok(report.costs_from_cost_price >= 1);

        const [[linked]] = await connection.query('SELECT journal_entry_id FROM inventory_movements WHERE id = ?', [invoicedSale]);
        assert.equal(linked.journal_entry_id, invoiced.entryId);
        assert.ok(report.reversed_costs_of_unpacked_orders.includes(unpackedOrder));
        const [[reversal]] = await connection.query('SELECT id FROM journal_entries WHERE reversal_of_entry_id = ?', [unpacked.entryId]);
        assert.ok(reversal, 'the cost posted for goods still in stock is reversed');

        const [packedLines] = await connection.query(
            `SELECT jel.account_code, jel.debit, jel.credit FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
             WHERE je.reference_type = ? AND je.reference_id = ? ORDER BY jel.account_code`,
            [CUTOVER_REFERENCE, packedOrder]
        );
        assert.deepEqual(packedLines.map((line) => [line.account_code, Number(line.debit), Number(line.credit)]), [['1.1.04.01', 0, 75], ['5.1.01.01', 75, 0]]);
        const [[packedLink]] = await connection.query('SELECT journal_entry_id FROM inventory_movements WHERE id = ?', [packedSale]);
        assert.ok(packedLink.journal_entry_id);

        const [bridge] = await connection.query(
            `SELECT jel.account_code, jel.debit, jel.credit FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
             WHERE je.reference_type = 'goods_received' AND je.reference_id = ? ORDER BY jel.account_code`,
            [reception.receptionId]
        );
        assert.deepEqual(bridge.map((line) => [line.account_code, Number(line.debit), Number(line.credit)]), [['1.1.04.01', 120, 0], ['2.1.01.02', 0, 120]]);
        const [[receptionLink]] = await connection.query('SELECT journal_entry_id FROM inventory_movements WHERE id = ?', [reception.movementId]);
        assert.ok(receptionLink.journal_entry_id);

        // Whatever else was apart is one adjustment: the ledger ends equal to the stock at cost.
        assert.equal(report.after.ok, true, JSON.stringify({ difference: report.after.difference, bridge: report.after.goods_to_invoice_difference }));
        assert.ok(report.after.valuation_since);

        // A second run does nothing.
        const again = await runCutover(connection, { runId: crypto.randomUUID(), accounting: accountingService, audit: auditService });
        assert.equal(again.already_done, true);
    } finally {
        await connection.rollback();
        connection.release();
    }
    const [[still]] = await pool.query('SELECT inventory_valuation_since AS since FROM company_settings ORDER BY id LIMIT 1');
    assert.equal(still?.since ?? null, null, 'the simulation writes nothing');
});

test('the cut-over refuses to start without the migrations, the C1 repair or the duplicate-entries runbook', async () => {
    const none = async () => [];
    assert.deepEqual(await checkCutoverPreconditions(pool, { findAffectedOrders: none, findReceptionEntries: none }), []);
    const problems = await checkCutoverPreconditions(pool, {
        findAffectedOrders: async () => [{ id: 'o' }],
        findReceptionEntries: async () => [{ id: 'e' }, { id: 'f' }],
    });
    assert.deepEqual(problems, [
        'Hay 1 ventas POS sin descontar stock: corré antes RUNBOOK_REPARACION_STOCK_C1.',
        'Hay 2 asientos de recepción sin revertir: corré antes RUNBOOK_ASIENTOS_COMPRA_DUPLICADOS.',
    ]);
});
