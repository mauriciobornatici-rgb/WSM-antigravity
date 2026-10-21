import test from 'node:test';
import assert from 'node:assert/strict';

import {
    InventoryValuation,
    effectiveCost,
    isValuedLocation,
    repricedSalePrice,
    roundCost,
    sameLocation,
    valueCents,
} from '../domains/inventory/InventoryValuation.js';
import { checkInventoryValuation } from '../scripts/inventory-valuation/valuation.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function recordingConnection(answer = () => [[]]) {
    const calls = [];
    return {
        calls,
        query: async (sql, params = []) => {
            const statement = norm(sql);
            calls.push({ statement, params });
            return answer(statement, params);
        },
    };
}

function fakeAccounting() {
    const entries = [];
    return {
        entries,
        createJournalEntry: async (_connection, entry) => { entries.push(entry); return `je-${entries.length}`; },
        // Same contract as the real one: zero lines dropped, nothing when fewer than two remain.
        createJournalEntryIfAny: async (connection, entry) => {
            const lines = entry.lines.filter((line) => line.debit > 0 || line.credit > 0);
            if (lines.length < 2) return null;
            entries.push({ ...entry, lines });
            return `je-${entries.length}`;
        },
    };
}

const lines = (entry) => entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);

test('valued locations, cost rules and cents (ADR-027)', () => {
    assert.equal(isValuedLocation('Mermas'), false, 'D3: goods in Mermas carry no value');
    assert.equal(isValuedLocation('Cuarentena'), true);
    assert.equal(isValuedLocation(null), true);
    assert.equal(effectiveCost({ purchase_price: '120.50', cost_price: '99' }), 120.5);
    assert.equal(effectiveCost({ purchase_price: 0, cost_price: '99.999' }), 100, 'cost_price only while purchase_price is empty');
    assert.equal(effectiveCost(null), 0);
    assert.equal(roundCost('600.004'), 600);
    assert.equal(valueCents(3, 33.33), 9999);
    assert.equal(valueCents(null, 10), 0);
});

test('locations compare as the database does: case and accents ignored (AUD-016)', () => {
    assert.equal(isValuedLocation('mermas'), false, 'the same row as "Mermas" for MySQL');
    assert.equal(isValuedLocation('MERMAS'), false);
    assert.equal(isValuedLocation('Mérmas'), false);
    assert.equal(sameLocation('Depósito', 'deposito'), true);
    assert.equal(sameLocation('General', 'Salón'), false);
    assert.equal(sameLocation(null, ''), true);
});

test('postReentry: goods that left with no cost posted come back against the opening adjustment (AUD-016)', async () => {
    const accounting = fakeAccounting();
    const valuation = new InventoryValuation({ accounting, audit: { log: async () => {} } });
    const connection = recordingConnection(() => [{ affectedRows: 1 }]);
    await valuation.postReentry(connection, {
        referenceType: 'order',
        referenceId: 'o-9',
        description: 'Anulación',
        lines: [
            // Left at 25 (posted), back at 30: 15 of holding result.
            { quantity: 3, exitCost: 25, unitCost: 30, movementIds: ['m1'] },
            // Left with no cost (the product had none): back at today's 40, never valued out.
            { quantity: 1, exitCost: 0, unitCost: 40, movementIds: ['m2'] },
        ],
    });
    assert.deepEqual(lines(accounting.entries[0]), [
        ['1.1.04.01', 130, 0], ['5.1.01.01', 0, 75], ['4.2.02.01', 0, 15], ['3.1.03.01', 0, 40],
    ]);
    assert.deepEqual(connection.calls[0].params, ['je-1', ['m1', 'm2']]);
});

test('changeCost refuses a cost of 0 while there is valued stock; Mermas alone does not block it', async () => {
    const accounting = fakeAccounting();
    const valuation = new InventoryValuation({ accounting, audit: { log: async () => {} } });
    const product = { id: 'p', name: 'Pelota', purchase_price: 100, sale_price: 200 };
    await assert.rejects(
        () => valuation.changeCost(recordingConnection(), { product, stockRows: [{ location: 'General', quantity: 2 }], newCost: 0, source: 'product_edit' }),
        (error) => error.statusCode === 409 && error.errorCode === 'cost_zero_with_stock' && /Mermas/.test(error.message)
    );
    const connection = recordingConnection(() => [{ affectedRows: 1 }]);
    const changed = await valuation.changeCost(connection, { product, stockRows: [{ location: 'Mermas', quantity: 5 }], newCost: 0, source: 'product_edit' });
    assert.equal(changed.cost, 0);
    assert.equal(accounting.entries.length, 0, 'nothing valued to revalue');
});

test('repricedSalePrice keeps the markup on the final price, rounded to the cent, and stores its net', () => {
    // 1000 net at 21 % = 1210 final; cost 500 → 600: 1452 final = 1200 net.
    assert.equal(repricedSalePrice({ salePrice: 1000, vatRate: 21, oldCost: 500, newCost: 600 }), 1200);
    // 10,5 %: 100 net = 110.50 final; cost 3 → 4: 147.33 final.
    assert.equal(repricedSalePrice({ salePrice: 100, vatRate: 10.5, oldCost: 3, newCost: 4 }), 133.3303);
    assert.equal(repricedSalePrice({ salePrice: 100, vatRate: null, oldCost: 1, newCost: 2 }), 200, 'no rate means 21 %');
    assert.equal(repricedSalePrice({ salePrice: 100, vatRate: 21, oldCost: 0, newCost: 2 }), null, 'no markup to keep');
    assert.equal(repricedSalePrice({ salePrice: 0, vatRate: 21, oldCost: 1, newCost: 2 }), null);
    assert.equal(repricedSalePrice({ salePrice: 100, vatRate: 21, oldCost: 1, newCost: 0 }), null);
});

test('lockStock takes every row of the products in one ordered statement; lockCosts reads after it, shared or exclusive', async () => {
    const valuation = new InventoryValuation({ accounting: fakeAccounting(), audit: { log: async () => {} } });
    const empty = recordingConnection();
    assert.deepEqual([...(await valuation.lockStock(empty, [null])).entries()], []);
    assert.deepEqual([...(await valuation.lockCosts(empty, [])).entries()], []);
    assert.equal(empty.calls.length, 0);

    const connection = recordingConnection((statement) => {
        if (statement.includes('FROM inventory')) {
            return [[
                { id: 'i1', product_id: 'a', location: 'General', quantity: 4 },
                { id: 'i2', product_id: 'a', location: 'Mermas', quantity: 9 },
                { id: 'i3', product_id: 'b', location: 'Cuarentena', quantity: 2 },
                { id: 'i4', product_id: 'zz', location: 'General', quantity: 1 },
            ]];
        }
        return [[{ id: 'a', name: 'A', purchase_price: '0', cost_price: '15' }, { id: 'b', purchase_price: '7.5' }]];
    });
    const stock = await valuation.lockStock(connection, ['b', 'a', 'b']);
    assert.deepEqual(connection.calls[0], {
        statement: 'SELECT id, product_id, location, quantity, reserved_quantity FROM inventory WHERE product_id IN (?) ORDER BY product_id, id FOR UPDATE',
        params: [['a', 'b']],
    });
    assert.equal(valuation.valuedQuantity(stock.get('a')), 4, 'Mermas is not valued');
    assert.equal(valuation.valuedQuantity(stock.get('b')), 2);
    assert.equal(stock.has('zz'), false, 'only the products asked for');
    assert.equal(valuation.valuedQuantity(undefined), 0);

    const costs = await valuation.lockCosts(connection, ['b', 'a']);
    assert.match(connection.calls[1].statement, /FROM products WHERE id IN \(\?\) ORDER BY id FOR SHARE$/);
    assert.deepEqual(connection.calls[1].params, [['a', 'b']]);
    assert.deepEqual([costs.get('a').cost, costs.get('b').cost], [15, 7.5]);
    await valuation.lockCosts(connection, ['a'], { forUpdate: true });
    assert.match(connection.calls[2].statement, /ORDER BY id FOR UPDATE$/);
});

test('postExit: cost of goods sold against inventory, the unrecorded part against differences, movements linked', async () => {
    const accounting = fakeAccounting();
    const valuation = new InventoryValuation({ accounting, audit: { log: async () => {} } });
    const connection = recordingConnection(() => [{ affectedRows: 2 }]);

    const posted = await valuation.postExit(connection, {
        referenceType: 'order',
        referenceId: 'o-1',
        description: 'Costo',
        lines: [
            { quantity: 2, unitCost: 33.33, movementIds: ['m1', 'm2'] },
            { quantity: 1, shortage: 2, unitCost: 10, movementIds: ['m3'] },
        ],
    });

    assert.deepEqual(posted, { entryId: 'je-1', amount: 96.66 });
    assert.deepEqual(lines(accounting.entries[0]), [
        ['5.1.01.01', 96.66, 0],
        ['1.1.04.01', 0, 76.66],
        ['5.1.02.02', 0, 20],
    ]);
    assert.deepEqual([accounting.entries[0].reference_type, accounting.entries[0].reference_id], ['order', 'o-1']);
    assert.deepEqual(connection.calls, [{
        statement: 'UPDATE inventory_movements SET journal_entry_id = ? WHERE id IN (?)',
        params: ['je-1', ['m1', 'm2', 'm3']],
    }]);

    const free = recordingConnection();
    assert.equal(await valuation.postExit(free, { referenceType: 'order', referenceId: 'o-2', description: 'x', lines: [{ quantity: 3, unitCost: 0, movementIds: ['m9'] }] }), null);
    assert.equal(await valuation.postExit(free, { referenceType: 'order', referenceId: 'o-3', description: 'x' }), null);
    assert.equal(free.calls.length, 0, 'nothing worth posting, nothing linked');
    await valuation.linkMovements(free, [], 'je-x');
    await valuation.linkMovements(free, ['m1'], null);
    assert.equal(free.calls.length, 0);
});

test('revalue: holding result, from cost 0 an opening adjustment (D6), and nothing when there is nothing to revalue', async () => {
    const accounting = fakeAccounting();
    const audits = [];
    const valuation = new InventoryValuation({ accounting, audit: { log: async (entry) => { audits.push(entry); } } });
    const rows = [{ location: 'General', quantity: 3 }, { location: 'Mermas', quantity: 5 }];
    const product = { id: 'p', name: 'Pelota', purchase_price: '100.00' };

    const up = await valuation.revalue({}, { product, rows, newCost: 120.004, userId: 'u', source: 'import', details: { batch_id: 'b' } });
    assert.deepEqual(up, { quantity: 3, amount: 60, entryId: 'je-1', counterAccount: '4.2.02.01' });
    assert.deepEqual(lines(accounting.entries[0]), [['1.1.04.01', 60, 0], ['4.2.02.01', 0, 60]]);
    assert.match(accounting.entries[0].description, /Revaluación de stock de Pelota: 3 u\. de costo \$100 a \$120/);
    assert.deepEqual(audits[0].new_values, { cost: 120, quantity: 3, amount: 60, journal_entry_id: 'je-1', source: 'import', counter_account: '4.2.02.01', batch_id: 'b' });

    const down = await valuation.revalue({}, { product, rows, newCost: 90, source: 'product_edit' });
    assert.equal(down.amount, -30);
    assert.deepEqual(lines(accounting.entries[1]), [['4.2.02.01', 30, 0], ['1.1.04.01', 0, 30]]);

    const fromZero = await valuation.revalue({}, { product: { id: 'q', sku: 'Q-1', purchase_price: 0, cost_price: 0 }, rows, newCost: 50, source: 'product_edit' });
    assert.equal(fromZero.counterAccount, '3.1.03.01');
    assert.deepEqual(lines(accounting.entries[2]), [['1.1.04.01', 150, 0], ['3.1.03.01', 0, 150]]);
    assert.match(accounting.entries[2].description, /de Q-1:/);

    assert.equal(await valuation.revalue({}, { product, rows, newCost: undefined }), null);
    assert.equal(await valuation.revalue({}, { product, rows, newCost: null }), null);
    assert.equal(await valuation.revalue({}, { product, rows, newCost: '100' }), null, 'the same cost');
    assert.equal(await valuation.revalue({}, { product, rows: [{ location: 'Mermas', quantity: 4 }], newCost: 200 }), null, 'nothing valued in stock');
    assert.equal(await valuation.revalue({}, { product, rows: [], newCost: 200 }), null);
    assert.equal(accounting.entries.length, 3);
});

test('the valuation check compares the inventory ledger with the stock at cost, read only', async () => {
    const answers = (since, ledger, valued) => recordingConnection((statement) => {
        if (statement.includes("account_code = '1.1.04.01'")) return [[{ balance: ledger }]];
        if (statement.includes('AS value, COALESCE(SUM(i.quantity), 0) AS quantity')) return [[{ value: valued, quantity: '12' }]];
        if (statement.includes('GROUP BY p.id')) return [[{ id: 'p', sku: 'S', name: 'Sin costo', quantity: '3' }]];
        if (statement.includes('inventory_valuation_since')) return [[{ since }]];
        if (statement.includes('FROM inventory_movements')) return [[{ movements: '2', value: '40.5' }]];
        if (statement.includes("account_code = '2.1.01.02'")) return [[{ balance: '120' }]];
        // What the delivery notes that went through 2.1.01.02 still owe.
        if (statement.includes('FROM reception_items ri')) return [[{ value: '120' }]];
        throw new Error(`unexpected ${statement}`);
    });

    const matching = answers(null, '1500.25', '1500.25');
    const ok = await checkInventoryValuation(matching);
    assert.deepEqual(ok, {
        ok: true, inventory_ledger: 1500.25, stock_valued: 1500.25, difference: 0, valued_units: 12,
        products_with_stock_and_no_cost: [{ id: 'p', sku: 'S', name: 'Sin costo', quantity: 3 }],
        valuation_since: null, sales_without_entry: { movements: 2, value: 40.5 },
        goods_to_invoice_balance: 120, goods_to_invoice_pending: 120, goods_to_invoice_difference: 0,
    });
    assert.ok(matching.calls.every(({ statement }) => statement.startsWith('SELECT')), 'only reads');
    assert.deepEqual(matching.calls.find(({ statement }) => statement.includes('FROM inventory i JOIN products')).params, [['Mermas']]);

    const since = new Date('2026-10-17T00:00:00Z');
    const off = answers(since, '1000', '999.99');
    const result = await checkInventoryValuation(off);
    assert.equal(result.ok, false);
    assert.equal(result.difference, 0.01);
    assert.deepEqual(off.calls.find(({ statement }) => statement.includes('FROM inventory_movements')).params, [since]);

    const empty = await checkInventoryValuation(recordingConnection((statement) => {
        if (statement.includes('inventory_valuation_since')) return [[]];
        if (statement.includes('GROUP BY')) return [[]];
        return [[{}]];
    }));
    assert.equal(empty.ok, true);
    assert.equal(empty.valuation_since, null);
});

test('postReentry: goods back at today\'s cost, the cost of goods sold reversed at the exit cost, the rest is holding result', async () => {
    const accounting = fakeAccounting();
    const valuation = new InventoryValuation({ accounting, audit: { log: async () => {} } });
    const connection = recordingConnection(() => [{ affectedRows: 1 }]);

    const cheaper = await valuation.postReentry(connection, {
        referenceType: 'client_return', referenceId: 'r-1', description: 'Reingreso',
        lines: [{ quantity: 2, exitCost: 50, unitCost: 40, movementIds: ['m1'] }, { quantity: 1, exitCost: 10, unitCost: 10 }],
    });
    assert.deepEqual(cheaper, { entryId: 'je-1', amount: 90 });
    assert.deepEqual(lines(accounting.entries[0]), [['1.1.04.01', 90, 0], ['5.1.01.01', 0, 110], ['4.2.02.01', 20, 0]]);
    assert.deepEqual(connection.calls[0].params, ['je-1', ['m1']]);

    await valuation.postReentry(connection, { referenceType: 'order', referenceId: 'o', description: 'x', lines: [{ quantity: 1, exitCost: 10, unitCost: 10 }] });
    assert.deepEqual(lines(accounting.entries[1]), [['1.1.04.01', 10, 0], ['5.1.01.01', 0, 10]], 'no holding line when the cost did not change');
    assert.equal(await valuation.postReentry(connection, { referenceType: 'order', referenceId: 'o', description: 'x', lines: [] }), null);
    assert.equal(await valuation.postReentry(connection, { referenceType: 'order', referenceId: 'o', description: 'x' }), null);
});

test('runCutover aligns the old data once: costs, old sales, open delivery notes and one adjustment (I8)', async () => {
    const { runCutover, checkCutoverPreconditions, CUTOVER_REFERENCE } = await import('../scripts/inventory-valuation/valuation.js');
    const state = { ledgerCents: 90000, since: null };
    const entries = [];
    const audits = [];
    const accounting = {
        createJournalEntry: async (_c, entry) => {
            entries.push(entry);
            for (const line of entry.lines) {
                if (line.account_code === '1.1.04.01') state.ledgerCents += Math.round(line.debit * 100) - Math.round(line.credit * 100);
            }
            return `je-${entries.length}`;
        },
        reverseDocumentEntries: async (_c, args) => (args.referenceId === 'i-b' ? ['rev-1'] : []),
    };
    accounting.createJournalEntryIfAny = async (c, entry) => {
        const lines = entry.lines.filter((line) => line.debit > 0 || line.credit > 0);
        return lines.length < 2 ? null : accounting.createJournalEntry(c, { ...entry, lines });
    };
    const connection = recordingConnection((statement) => {
        if (statement.startsWith('INSERT IGNORE INTO company_settings')) return [{ affectedRows: 0 }];
        if (statement.includes('inventory_valuation_since AS since FROM company_settings ORDER BY id LIMIT 1 FOR UPDATE')) return [[{ id: 1, since: state.since }]];
        if (statement.startsWith('UPDATE products SET purchase_price = cost_price')) return [{ affectedRows: 2 }];
        if (statement.startsWith('UPDATE products SET cost_price')) return [{ affectedRows: 5 }];
        if (statement.startsWith('UPDATE company_settings')) { state.since = new Date(); return [{ affectedRows: 1 }]; }
        if (statement.startsWith('UPDATE inventory_movements')) return [{ affectedRows: 2 }];
        // The valuation check: ledger from the entries posted, stock worth 1000.
        if (statement.includes("account_code = '1.1.04.01'")) return [[{ balance: String(state.ledgerCents / 100) }]];
        if (statement.includes('AS value, COALESCE(SUM(i.quantity), 0) AS quantity')) return [[{ value: '1000', quantity: '10' }]];
        if (statement.includes('GROUP BY p.id')) return [[]];
        if (statement.includes('inventory_valuation_since AS since FROM company_settings')) return [[{ since: state.since }]];
        if (statement.includes('FROM inventory_movements WHERE type = \'sale\' AND journal_entry_id IS NULL AND unit_cost > 0')) return [[{ movements: 0, value: 0 }]];
        if (statement.includes("account_code = '2.1.01.02'")) return [[{ balance: '120' }]];
        if (statement.includes('FROM reception_items ri WHERE')) return [[{ value: '120' }]];
        // Invoices that posted the cost with the old rule.
        if (statement.includes('JOIN invoices i ON i.id = je.reference_id')) {
            return [[
                { entry_id: 'je-a', invoice_id: 'i-a', order_id: 'o-a', order_status: 'completed', movements: 2 },
                { entry_id: 'je-b', invoice_id: 'i-b', order_id: 'o-b', order_status: 'pending', movements: 0 },
                { entry_id: 'je-c', invoice_id: 'i-c', order_id: null, order_status: null, movements: 0 },
                { entry_id: 'je-d', invoice_id: 'i-d', order_id: 'o-d', order_status: 'delivered', movements: 0 },
            ]];
        }
        if (statement.includes('FROM inventory_movements m LEFT JOIN products p')) {
            // m1 left in an earlier fiscal year (its cost corrects that year: 3.1.02.02), m2 in this one.
            return [[
                { id: 'm1', order_id: 'o-x', quantity: 2, unit_cost: 0, purchase_price: 30, created_at: '2025-12-30T12:00:00' },
                { id: 'm2', order_id: 'o-x', quantity: 1, unit_cost: 20, created_at: '2026-02-01T12:00:00' },
            ]];
        }
        if (statement.includes('FROM receptions r JOIN reception_items ri')) {
            return [[
                { id: 'r1', reception_number: 'REC-1', remito_number: null, order_invoiced: 0, value: '120' },
                { id: 'r2', reception_number: 'REC-2', remito_number: 'R-2', order_invoiced: 1, value: '50' },
                { id: 'r3', reception_number: 'REC-3', remito_number: null, order_invoiced: 0, value: '0' },
            ]];
        }
        throw new Error(`unexpected ${statement}`);
    });

    const fiscalYearStart = new Date(2026, 0, 1);
    const report = await runCutover(connection, { runId: 'run-1', accounting, audit: { log: async (entry) => { audits.push(entry); } }, fiscalYearStart });

    assert.equal(report.costs_from_cost_price, 2);
    assert.equal(report.sales_linked_to_invoice_cost, 2);
    assert.deepEqual(report.reversed_costs_of_unpacked_orders, ['o-b'], 'only an order not packed yet');
    assert.deepEqual(report.costs_posted_for_sales, { orders: 1, amount: 80, this_year: 20, earlier_years: 60 }, '2 × 30 (today, the movement had none) + 1 × 20');
    const oldSale = entries.find((entry) => entry.reference_type === CUTOVER_REFERENCE && entry.reference_id === 'o-x');
    assert.deepEqual(lines(oldSale), [['5.1.01.01', 20, 0], ['3.1.02.02', 60, 0], ['1.1.04.01', 0, 80]]);
    assert.equal(report.fiscal_year_start, '2026-01-01');
    assert.deepEqual(report.opened_goods_to_invoice, { receptions: 1, amount: 120 });
    assert.deepEqual(report.receptions_invoiced_by_their_order, [{ id: 'r2', remito: 'R-2', value: 50 }]);
    // 900 − 80 + 120 = 940 against 1000 in stock: one adjustment of 60 against 3.1.02.02 (ADR-028).
    assert.equal(report.adjustment, 60);
    const adjustment = entries.find((entry) => entry.reference_type === CUTOVER_REFERENCE && entry.reference_id === 'run-1');
    assert.deepEqual(lines(adjustment), [['1.1.04.01', 60, 0], ['3.1.02.02', 0, 60]]);
    assert.equal(report.after.ok, true);
    assert.equal(audits[0].action, 'INVENTORY_VALUATION_CUTOVER');
    assert.equal(audits[0].new_values.ok, true);

    // A second run finds the date and does nothing.
    const again = await runCutover(connection, { runId: 'run-2', accounting, audit: { log: async () => {} } });
    assert.equal(again.already_done, true);

    // An adjustment the other way: more in the ledger than in stock.
    state.since = null;
    // 1020 − 80 + 120 = 1060 in the ledger against 1000 in stock.
    state.ledgerCents = 102000;
    const down = await runCutover(connection, { runId: 'run-3', accounting, audit: { log: async () => {} }, fiscalYearStart });
    assert.equal(down.adjustment, -60);
    assert.deepEqual(lines(entries.at(-1)), [['3.1.02.02', 60, 0], ['1.1.04.01', 0, 60]]);

    // Preconditions: the migrations are checked on the database, the repairs through the finders.
    const preconditions = recordingConnection((statement) => {
        if (statement.includes('FROM chart_of_accounts')) return [[{ code: '4.2.02.01' }]];
        if (statement.includes('information_schema.COLUMNS')) return [[{ name: 'a' }, { name: 'b' }]];
        throw new Error(`unexpected ${statement}`);
    });
    const problems = await checkCutoverPreconditions(preconditions, { findAffectedOrders: async () => [], findReceptionEntries: async () => [] });
    assert.deepEqual(problems, [
        'Faltan las migraciones 064/065/067 (cuentas 4.2.02.01, 2.1.01.02 y 3.1.02.02).',
        'Faltan las migraciones 065/066/067 (columnas de la valuación).',
    ]);
});
