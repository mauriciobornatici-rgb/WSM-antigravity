import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyOrigin, correction } from '../scripts/repair-tiendanube-prices.js';
import { SupplierInvoiceService } from '../domains/procurement/SupplierInvoiceService.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import salesService from '../services/sales.service.js';
import { mockPool } from './helpers/mockDb.js';

const lineSet = (lines) => lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);

// ---- price repair: origin without guessing ----

test('the price repair trusts the recorded origin and otherwise the creation date in Tiendanube', async () => {
    const family = new Date('2026-05-01T12:00:00Z');
    const base = { remote_product_id: '77', family_created_at: family };
    const never = async () => { throw new Error('no debe consultar'); };
    assert.equal((await classifyOrigin({ ...base, origin: 'tiendanube_import' }, never)).origin, 'imported');
    assert.equal((await classifyOrigin({ ...base, origin: 'tienda_online' }, never)).origin, 'erp');
    assert.equal((await classifyOrigin({ ...base, origin: null, remote_product_id: null }, never)).origin, 'erp');
    // Created in Tiendanube a month before its family existed here: an import.
    assert.equal((await classifyOrigin({ ...base, origin: null }, async () => new Date('2026-04-01T00:00:00Z'))).origin, 'imported');
    // Created there after (published from here) or within the clock tolerance: leave it.
    assert.equal((await classifyOrigin({ ...base, origin: null }, async () => new Date('2026-05-01T12:05:00Z'))).origin, 'erp');
    assert.equal((await classifyOrigin({ ...base, origin: null }, async () => new Date('2026-05-01T11:59:30Z'))).origin, 'erp');
    // No answer from Tiendanube: never fixed blindly.
    assert.equal((await classifyOrigin({ ...base, origin: null }, async () => null)).origin, 'unverified');
    assert.deepEqual(correction({ id: 'p', sku: 'S', name: 'N', sale_price: '121.0000', vat_rate: 21 }), {
        id: 'p', sku: 'S', name: 'N', vat_rate: 21, stored_net: 121, final_shown_now: 146.41, corrected_net: 100, final_after: 121,
    });
});

// ---- supplier invoices: several rates and what is bought ----

function supplierInvoiceHarness(t) {
    const journals = [];
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (/FROM suppliers WHERE id = \? AND deleted_at IS NULL FOR UPDATE/.test(String(sql))) return [[{ id: params[0] }]];
        // A delivery note received before ADR-027: its goods were valued by the transition against
        // 3.1.02.02 (ADR-028), so the invoice settles that adjustment (AUD-016) instead of adding inventory.
        if (String(sql).includes('FROM receptions WHERE id IN')) return [[{ id: 'r', supplier_id: 's', status: 'approved' }]];
        if (String(sql).includes('FROM reception_items ri')) return [[{ id: 'ri', reception_id: 'r', product_id: 'p', quantity_received: 1, unit_cost: 3000 }]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async (_connection, entry) => { journals.push(entry); };
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });
    return { journals, calls };
}

test('a Factura A with several rates books one fiscal credit line per rate and stores them', async (t) => {
    const { journals, calls } = supplierInvoiceHarness(t);
    await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: '0001-1', invoice_type: 'A', supplier_id: 's', issue_date: '2026-10-12', reception_id: 'r',
        vat_lines: [{ vat_rate: 21, net_amount: 1000, vat_amount: 210 }, { vat_rate: 10.5, net_amount: 2000, vat_amount: 210 }],
        other_taxes: 30, total_amount: 3450,
    }, 'u');
    assert.deepEqual(lineSet(journals[0].lines), [
        ['3.1.02.02', 3000, 0], ['1.1.05.02', 210, 0], ['1.1.05.01', 210, 0], ['1.1.05.04', 30, 0], ['2.1.01.01', 0, 3450],
    ]);
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO supplier_invoice_vat_lines')).length, 2);
});

test('a freight invoice goes to Fletes y envíos and cannot be tied to a reception', async (t) => {
    const { journals } = supplierInvoiceHarness(t);
    const service = new SupplierInvoiceService();
    await service.createSupplierInvoice({
        invoice_number: '0002-1', invoice_type: 'A', supplier_id: 's', issue_date: '2026-10-12',
        net_amount: 1000, vat_amount: 210, vat_rate: 21, total_amount: 1210, purchase_kind: 'shipping',
    }, 'u');
    assert.deepEqual(lineSet(journals[0].lines), [['5.1.02.06', 1000, 0], ['1.1.05.02', 210, 0], ['2.1.01.01', 0, 1210]]);
    await assert.rejects(
        () => service.createSupplierInvoice({
            invoice_number: '0002-2', invoice_type: 'A', supplier_id: 's', issue_date: '2026-10-12', reception_id: 'r',
            net_amount: 100, vat_amount: 21, total_amount: 121, purchase_kind: 'expense',
        }, 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_purchase_kind'
    );
    await assert.rejects(
        () => service.createSupplierInvoice({
            invoice_number: '0002-3', invoice_type: 'A', supplier_id: 's', issue_date: '2026-10-12',
            vat_lines: [{ vat_rate: 0, net_amount: 100, vat_amount: 21 }], total_amount: 121,
        }, 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_vat_rate'
    );
});

// ---- shipping of an order made here ----

test('the shipping of an order can change only on an order made here, not invoiced and without payments', async (t) => {
    let order = { id: 'o', status: 'pending', external_source: null, invoice_id: null, total_amount: 121 };
    let payments = 0;
    const writes = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM orders')) return [[order]];
        if (statement.includes('FROM order_payments')) return [[{ n: payments }]];
        if (statement.includes('FROM order_items oi')) return [[{ quantity: 1, unit_price: 100, vat_rate: 21 }]];
        if (statement.includes('SUM(amount)') && statement.includes('billable = 1')) {
            const billed = writes.find((write) => write.sql.startsWith('INSERT INTO order_adjustments'));
            return [[{ total: billed && billed.params[4] ? billed.params[2] : 0 }]];
        }
        if (statement.startsWith('SELECT amount, vat_rate, billable')) return [[]];
        writes.push({ sql: statement, params });
        return [{ affectedRows: 1 }];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    const charged = await salesService.updateOrderShipping('o', { amount: 3000, charge_customer: true }, 'u');
    assert.equal(charged.total_amount, 3121);
    writes.length = 0;
    const absorbed = await salesService.updateOrderShipping('o', { amount: 3000, charge_customer: false }, 'u');
    assert.equal(absorbed.total_amount, 121, 'a shipping absorbed by the business does not add to the total');

    for (const [patch, error] of [
        [{ external_source: 'tiendanube' }, 'channel_order'],
        [{ invoice_id: 'inv' }, 'order_invoiced'],
        [{ status: 'cancelled' }, 'order_cancelled'],
    ]) {
        order = { id: 'o', status: 'pending', external_source: null, invoice_id: null, ...patch };
        await assert.rejects(() => salesService.updateOrderShipping('o', { amount: 1, charge_customer: true }), (err) => err.responseBody?.error === error);
    }
    order = { id: 'o', status: 'pending', external_source: null, invoice_id: null };
    payments = 1;
    await assert.rejects(() => salesService.updateOrderShipping('o', { amount: 1, charge_customer: true }), (err) => err.responseBody?.error === 'order_has_payments');
});

test('the price repair never touches a product created in the ERP and linked later', async () => {
    const base = { origin: null, remote_product_id: '77', family_created_at: new Date('2026-05-01T12:00:00Z') };
    const old = async () => new Date('2026-01-01T00:00:00Z');
    assert.equal((await classifyOrigin({ ...base, created_in_erp: 1 }, old)).origin, 'erp');
    assert.equal((await classifyOrigin({
        ...base, created_in_erp: 0,
        product_created_at: new Date('2026-03-01T00:00:00Z'), linked_at: new Date('2026-05-01T12:00:00Z'),
    }, old)).origin, 'erp');
    assert.equal((await classifyOrigin({
        ...base, created_in_erp: 0,
        product_created_at: new Date('2026-05-01T12:00:00Z'), linked_at: new Date('2026-05-01T12:00:01Z'),
    }, old)).origin, 'imported');
});

// ---- ADR-018 ----

test('opening stock without a cost is refused (it would enter stock without its entry)', async () => {
    const { default: inventoryService } = await import('../services/inventory.service.js');
    await assert.rejects(
        () => inventoryService.createProduct({ sku: 'X', name: 'Sin costo', sale_price: 100, stock_initial: 3 }, 'u'),
        (err) => err.statusCode === 400 && err.responseBody.error === 'initial_stock_requires_cost'
    );
});

test('the opening stock entry goes to the adjustment account, not capital', async () => {
    const posted = [];
    const original = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (_connection, entry) => { posted.push(entry); };
    try {
        await accountingService.postInitialStock({}, { productId: 'p', quantity: 4, unitCost: 50 });
        assert.equal(await accountingService.postInitialStock({}, { productId: 'p', quantity: 4, unitCost: 0 }), null);
    } finally {
        accountingService.createJournalEntry = original;
    }
    assert.deepEqual(lineSet(posted[0].lines), [['1.1.04.01', 200, 0], ['3.1.03.01', 0, 200]]);
    assert.equal(posted.length, 1);
});

test('only a manager or admin can absorb the shipping of a new order', async (t) => {
    const { CreateOrderUseCase } = await import('../domains/sales/CreateOrderUseCase.js');
    mockPool(t, async (sql) => {
        if (String(sql).includes('SELECT id, sale_price, name, vat_rate FROM products')) return [[{ id: 'p', sale_price: 100, name: 'P', vat_rate: 21 }]];
        return [[]];
    });
    const order = { items: [{ product_id: 'p', quantity: 1 }], shipping_charge: { amount: 500, charge_customer: false } };
    await assert.rejects(
        () => new CreateOrderUseCase({ onStockChanged: async () => {} }).execute(order, 'u', { role: 'cashier' }),
        (err) => err.statusCode === 403 && err.errorCode === 'SHIPPING_ABSORB_NOT_ALLOWED'
    );
});
