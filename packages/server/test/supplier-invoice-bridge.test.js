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
        if (statement.includes('FROM reception_items WHERE reception_id IN')) return [items];
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
    // 3.1.03.01, so its part settles that adjustment instead of adding inventory (AUD-016).
    const mixed = harness(t, {
        bridged: ['r1'],
        items: [
            { reception_id: 'r1', product_id: 'p', quantity_received: 1, returned_quantity: 0, unit_cost: 100 },
            { reception_id: 'r2', product_id: 'q', quantity_received: 2, returned_quantity: 0, unit_cost: 50 },
        ],
    });
    await mixed.service.createSupplierInvoice(invoice({ reception_ids: ['r1', 'r2'], net_amount: 190, vat_amount: 39.9, total_amount: 229.9 }), 'u');
    assert.deepEqual(lines(mixed.entries[0]), [
        ['2.1.01.02', 100, 0], ['3.1.03.01', 100, 0], ['4.2.02.01', 0, 10], ['1.1.05.02', 39.9, 0], ['2.1.01.01', 0, 229.9],
    ]);
    const links = mixed.calls.filter(({ statement }) => statement.startsWith('INSERT INTO supplier_invoice_receptions'));
    assert.deepEqual(links.map(({ params }) => params.slice(1)), [['r1', 100], ['r2', null]]);
});

test('a delivery note returned in full before its invoice: the invoice books no goods (AUD-016)', async (t) => {
    // Everything went back to the supplier (D7): nothing pending in 2.1.01.02, nothing in stock.
    const { service, entries, changes } = harness(t, {
        items: [{ reception_id: 'r1', product_id: 'p', quantity_received: 2, returned_quantity: 2, unit_cost: 100 }],
    });
    await service.createSupplierInvoice(invoice({ net_amount: 200, vat_amount: 42, total_amount: 242 }), 'u');
    // It used to fall back to "before ADR-027" and debit inventory for goods that are gone.
    assert.deepEqual(lines(entries[0]), [['4.2.02.01', 200, 0], ['1.1.05.02', 42, 0], ['2.1.01.01', 0, 242]]);
    assert.equal(changes.length, 0, 'no units to take a cost from');
});

test('a deadlock while invoicing answers 409 busy (the screen can retry)', async (t) => {
    const { service } = harness(t, {
        items: [{ reception_id: 'r1', product_id: 'p', quantity_received: 1, returned_quantity: 0, unit_cost: 100 }],
        failOn: { statement: 'INSERT INTO supplier_invoices', error: Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }) },
    });
    await assert.rejects(() => service.createSupplierInvoice(invoice(), 'u'), (err) => err.statusCode === 409 && err.responseBody.error === 'busy');
});
