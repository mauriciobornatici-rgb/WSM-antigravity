import test from 'node:test';
import assert from 'node:assert/strict';

import { SupplierInvoiceService } from '../domains/procurement/SupplierInvoiceService.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

// ADR-027 (I5): an invoice of goods clears what its delivery notes left in 2.1.01.02; the
// difference is holding result and moves the cost of the products that follow the last purchase.

function harness(t, { bridged = ['r1'], items, failOn = null } = {}) {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (failOn && statement.includes(failOn.statement)) throw failOn.error;
        if (statement.includes('FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [[{ id: params[0] }]];
        if (statement.includes('FROM receptions WHERE id IN')) return [params[0].map((id) => ({ id, supplier_id: 's', status: 'approved', remito_number: `R-${id}` }))];
        if (statement.includes("reference_type = 'goods_received'")) return [bridged.map((id) => ({ reference_id: id }))];
        if (statement.includes('FROM reception_items ri')) return [items.map((item, index) => ({ id: `ri-${index}`, invoiced_quantity: 0, ...item }))];
        return [[]];
    });
    const entries = [];
    const audits = [];
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async (_c, entry) => { entries.push(entry); return 'je'; };
    auditService.log = async (entry) => { audits.push(entry); };
    t.after(() => { accountingService.createJournalEntry = originals.journal; auditService.log = originals.audit; });
    const changes = [];
    const valuation = {
        lockStock: async (_c, ids) => new Map(ids.map((id) => [id, [{ id: `inv-${id}`, product_id: id, location: 'General', quantity: 4 }]])),
        lockCosts: async () => new Map([
            ['p', { id: 'p', name: 'Pelota', purchase_price: 100, auto_update_cost: 1 }],
            ['q', { id: 'q', name: 'Red', purchase_price: 50, auto_update_cost: 0 }],
            ['z', { id: 'z', name: 'Cambiado', purchase_price: 77, auto_update_cost: 1 }],
        ]),
        changeCost: async (_c, args) => { changes.push(args); return { oldCost: 100, cost: args.newCost, salePrice: 260, revaluation: null }; },
    };
    return { service: new SupplierInvoiceService({ valuation }), calls, entries, audits, changes };
}

const invoice = (overrides = {}) => ({
    invoice_number: '0001-9', invoice_type: 'A', supplier_id: 's', issue_date: '2026-10-17',
    reception_ids: ['r1'], net_amount: 280, vat_amount: 58.8, vat_rate: 21, total_amount: 338.8, ...overrides,
});
const lines = (entry) => entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);

test('the invoice clears the delivery note, posts the difference and moves the cost that follows it', async (t) => {
    const { service, entries, changes, calls, audits } = harness(t, {
        items: [
            { reception_id: 'r1', product_id: 'p', quantity_received: 3, returned_quantity: 1, unit_cost: '100.00' },
            { reception_id: 'r1', product_id: 'q', quantity_received: 1, returned_quantity: 0, unit_cost: '50.00' },
            // Its cost changed since the delivery note (77, not 10): it keeps it.
            { reception_id: 'r1', product_id: 'z', quantity_received: 0, returned_quantity: 0, unit_cost: '10.00' },
        ],
    });

    const result = await service.createSupplierInvoice(invoice(), 'u');

    // 2 kept × 100 + 1 × 50 = 250 pending; the invoice says 280: 30 of holding result.
    assert.deepEqual(lines(entries[0]), [
        ['2.1.01.02', 250, 0], ['4.2.02.01', 30, 0], ['1.1.05.02', 58.8, 0], ['2.1.01.01', 0, 338.8],
    ]);
    // Spread by value: 24 to the 200 of "p" → cost (200 + 24) / 2 = 112. "q" has a fixed cost.
    assert.deepEqual(changes.map((change) => [change.product.id, change.newCost, change.source]), [['p', 112, 'supplier_invoice']]);
    assert.deepEqual(result.cost_updates, [{ product_id: 'p', name: 'Pelota', old_cost: 100, new_cost: 112, new_sale_price: 260 }]);
    const link = calls.find(({ statement }) => statement.startsWith('INSERT INTO supplier_invoice_receptions'));
    assert.deepEqual(link.params.slice(1), ['r1', 250]);
    assert.deepEqual([result.receptions_net, result.receptions_difference], [250, 30]);
    assert.deepEqual([audits[0].new_values.cleared_from_received, audits[0].new_values.difference], [250, 30]);
});

test('an invoice for exactly what was received changes no cost; legacy and new delivery notes mix', async (t) => {
    const exact = harness(t, { items: [{ reception_id: 'r1', product_id: 'p', quantity_received: 2, returned_quantity: 0, unit_cost: 100 }] });
    const same = await exact.service.createSupplierInvoice(invoice({ net_amount: 200, vat_amount: 42, total_amount: 242 }), 'u');
    assert.deepEqual(lines(exact.entries[0]), [['2.1.01.02', 200, 0], ['1.1.05.02', 42, 0], ['2.1.01.01', 0, 242]]);
    assert.equal(exact.changes.length, 0);
    assert.equal(same.cost_updates, undefined);

    // r2 came before ADR-027 (never in 2.1.01.02): the transition valued its goods against
    // 3.1.02.02 (ADR-028), so its part settles that adjustment instead of adding inventory (AUD-016).
    // The 10 below the delivery notes is spread by value: 5 to each line, so the old line's goes
    // with it to 3.1.02.02 and only the new line's is holding result.
    const mixed = harness(t, {
        bridged: ['r1'],
        items: [
            { reception_id: 'r1', product_id: 'p', quantity_received: 1, returned_quantity: 0, unit_cost: 100 },
            { reception_id: 'r2', product_id: 'q', quantity_received: 2, returned_quantity: 0, unit_cost: 50 },
        ],
    });
    await mixed.service.createSupplierInvoice(invoice({ reception_ids: ['r1', 'r2'], net_amount: 190, vat_amount: 39.9, total_amount: 229.9 }), 'u');
    assert.deepEqual(lines(mixed.entries[0]), [
        ['2.1.01.02', 100, 0], ['3.1.02.02', 95, 0], ['4.2.02.01', 0, 5], ['1.1.05.02', 39.9, 0], ['2.1.01.01', 0, 229.9],
    ]);
    const links = mixed.calls.filter(({ statement }) => statement.startsWith('INSERT INTO supplier_invoice_receptions'));
    assert.deepEqual(links.map(({ params }) => params.slice(1)), [['r1', 100], ['r2', null]]);
});

test('a delivery note with nothing left to invoice (returned or invoiced in full) is refused', async (t) => {
    // Everything went back to the supplier (D7): there are no units to invoice, so no goods are booked.
    const { service, entries } = harness(t, {
        items: [{ reception_id: 'r1', product_id: 'p', quantity_received: 2, returned_quantity: 2, unit_cost: 100 }],
    });
    await assert.rejects(
        () => service.createSupplierInvoice(invoice({ net_amount: 200, vat_amount: 42, total_amount: 242 }), 'u'),
        (err) => err.statusCode === 409 && err.responseBody.error === 'reception_already_invoiced' && /R-r1/.test(err.message)
    );
    assert.equal(entries.length, 0);
});

// ---- ADR-028: the invoice says how many units of each line it charges, and at what cost ----

test('a partial invoice clears only its units at the delivery note cost; each line moves its own cost', async (t) => {
    const { service, entries, changes, calls, audits } = harness(t, {
        items: [
            { id: 'line-p', reception_id: 'r1', product_id: 'p', quantity_received: 5, returned_quantity: 0, invoiced_quantity: 1, unit_cost: '100.00' },
            { id: 'line-q', reception_id: 'r1', product_id: 'q', quantity_received: 2, returned_quantity: 0, unit_cost: '50.00' },
        ],
    });
    // 3 of the 4 units left of "p" at 110, none of "q" yet: 330 net.
    const result = await service.createSupplierInvoice(invoice({
        net_amount: 330, vat_amount: 69.3, total_amount: 399.3,
        items: [{ reception_item_id: 'line-p', quantity: 3, unit_cost: 110 }, { reception_item_id: 'line-q', quantity: 0, unit_cost: 50 }],
    }), 'u');

    assert.deepEqual(lines(entries[0]), [['2.1.01.02', 300, 0], ['4.2.02.01', 30, 0], ['1.1.05.02', 69.3, 0], ['2.1.01.01', 0, 399.3]]);
    assert.deepEqual(changes.map((change) => [change.product.id, change.newCost]), [['p', 110]]);
    const taken = calls.filter(({ statement }) => statement.startsWith('UPDATE reception_items SET invoiced_quantity'));
    assert.deepEqual(taken.map(({ params }) => params), [[3, 'line-p']]);
    const saved = calls.filter(({ statement }) => statement.startsWith('INSERT INTO supplier_invoice_items'));
    assert.deepEqual(saved.map(({ params }) => params.slice(2)), [['r1', 'line-p', 'p', 3, 110, 300]]);
    assert.deepEqual([result.receptions_net, result.receptions_difference], [300, 30]);
    assert.equal(audits[0].new_values.difference, 30);
});

test('invoice lines must add up to the net (a cent per line) and never take more than is left', async (t) => {
    const lineItems = [{ id: 'line-p', reception_id: 'r1', product_id: 'p', quantity_received: 3, returned_quantity: 1, unit_cost: '33.33' }];
    let { service } = harness(t, { items: lineItems });
    await assert.rejects(
        () => service.createSupplierInvoice(invoice({ net_amount: 70, vat_amount: 14.7, total_amount: 84.7, items: [{ reception_item_id: 'line-p', quantity: 2, unit_cost: 33.33 }] }), 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invoice_items_mismatch' && /66\.66.*70\.00/.test(err.message)
    );
    ({ service } = harness(t, { items: lineItems }));
    await assert.rejects(
        () => service.createSupplierInvoice(invoice({ net_amount: 99.99, vat_amount: 21, total_amount: 120.99, items: [{ reception_item_id: 'line-p', quantity: 3, unit_cost: 33.33 }] }), 'u'),
        (err) => err.statusCode === 409 && err.responseBody.error === 'invoice_exceeds_reception' && /quedan 2 u\./.test(err.message)
    );
    ({ service } = harness(t, { items: lineItems }));
    await assert.rejects(
        () => service.createSupplierInvoice(invoice({ net_amount: 1, vat_amount: 0.21, total_amount: 1.21, items: [{ reception_item_id: 'other', quantity: 1, unit_cost: 1 }] }), 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_invoice_item'
    );
    ({ service } = harness(t, { items: lineItems }));
    await assert.rejects(
        () => service.createSupplierInvoice(invoice({ net_amount: 1, vat_amount: 0.21, total_amount: 1.21, items: [{ reception_item_id: 'line-p', quantity: 0, unit_cost: 1 }] }), 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invoice_without_items'
    );
    // A cent of rounding is spread, and a Factura B puts its VAT in the cost.
    const rounded = harness(t, { items: lineItems });
    await rounded.service.createSupplierInvoice(invoice({ invoice_type: 'B', net_amount: 66.67, vat_amount: 14, total_amount: 80.67, items: [{ reception_item_id: 'line-p', quantity: 2, unit_cost: 33.33 }] }), 'u');
    assert.deepEqual(lines(rounded.entries[0]), [['2.1.01.02', 66.66, 0], ['4.2.02.01', 14.01, 0], ['2.1.01.01', 0, 80.67]]);
    // "p" costs 100 today, not the delivery note's 33.33: someone changed it since, so it stays.
    assert.equal(rounded.changes.length, 0);
});

test('a deadlock while invoicing answers 409 busy (the screen can retry)', async (t) => {
    const { service } = harness(t, {
        items: [{ reception_id: 'r1', product_id: 'p', quantity_received: 1, returned_quantity: 0, unit_cost: 100 }],
        failOn: { statement: 'INSERT INTO supplier_invoices', error: Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }) },
    });
    await assert.rejects(() => service.createSupplierInvoice(invoice(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'busy');
});
