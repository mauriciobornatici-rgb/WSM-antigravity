import test from 'node:test';
import assert from 'node:assert/strict';

import { outputVatLines, splitByRate, vatCreditAccount, vatDebitAccount, isArcaVatRate } from '../utils/vatAccounts.js';
import { bankChargeLines } from '../utils/bankCharges.js';
import vatRatesService from '../services/vatRates.service.js';
import treasuryService from '../services/treasury.service.js';
import financeService from '../services/finance.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { returnsService } from '../services/warranties.service.js';
import { TiendaNubeService } from '../services/tiendanube.service.js';
import { mockPool } from './helpers/mockDb.js';

const lineSet = (lines) => lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]);
const balanced = (lines) => Math.round(lines.reduce((sum, line) => sum + line.debit - line.credit, 0) * 100) === 0;

function stubLedger(t) {
    const journals = [];
    const audits = [];
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async (_connection, entry) => { journals.push(entry); };
    auditService.log = async (entry) => { audits.push(entry); };
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });
    return { journals, audits };
}

// ---- VAT accounts per rate ----

test('VAT accounts exist for every ARCA rate and unknown rates fall back to 21 %', () => {
    assert.equal(vatCreditAccount(10.5), '1.1.05.01');
    assert.equal(vatCreditAccount(27), '1.1.05.03');
    assert.equal(vatCreditAccount('5'), '1.1.05.05');
    assert.equal(vatCreditAccount(null), '1.1.05.02');
    assert.equal(vatDebitAccount(2.5), '2.1.02.05');
    assert.equal(vatDebitAccount(99), '2.1.02.02');
    assert.equal(isArcaVatRate(10.5), true);
    assert.equal(isArcaVatRate(12), false);
});

test('outputVatLines posts one line per rate and nothing for a type C voucher', () => {
    const byRate = [{ vat_rate: 21, vat: 21 }, { vat_rate: 10.5, vat: 10.5 }, { vat_rate: 21, vat: -2.1 }, { vat_rate: 0, vat: 0 }];
    assert.deepEqual(lineSet(outputVatLines(byRate, { side: 'credit', voucherType: 'B' })), [
        ['2.1.02.02', 0, 18.9],
        ['2.1.02.01', 0, 10.5],
    ]);
    assert.deepEqual(lineSet(outputVatLines(byRate, { side: 'debit', voucherType: 'A' }))[0], ['2.1.02.02', 18.9, 0]);
    assert.deepEqual(outputVatLines(byRate, { side: 'credit', voucherType: 'C' }), []);
});

test('splitByRate splits an amount over rates in proportion to their gross, to the cent', () => {
    const parts = splitByRate([{ vat_rate: 21, gross: 121, vat: 21 }, { vat_rate: 10.5, gross: 110.5, vat: 10.5 }], 100);
    assert.equal(Math.round(parts.reduce((sum, part) => sum + part.gross, 0) * 100), 10000);
    assert.deepEqual(parts.map((part) => part.vat_rate), [10.5, 21]);
    assert.deepEqual(parts[0], { vat_rate: 10.5, gross: 47.73, vat: 4.54 });
    // Nothing to split by: all at 21 %.
    assert.deepEqual(splitByRate([], 121), [{ vat_rate: 21, gross: 121, vat: 21 }]);
});

// ---- bank charges ----

test('bankChargeLines splits VAT at the picked rate and keeps taxes and withholdings whole', async () => {
    const rates = [];
    const resolveRate = async (rate) => { rates.push(rate); return rate ?? 21; };
    const { lines, total } = await bankChargeLines([
        { concept: 'commission', amount: 121 },
        { concept: 'maintenance', amount: 110.5, vat_rate: 10.5 },
        { concept: 'other', amount: 50, vat_rate: 0, notes: 'sellado' },
        { concept: 'debits_credits_tax', amount: 12 },
        { concept: 'withholding', amount: 30, vat_rate: 21 },
    ], resolveRate);
    assert.equal(total, 323.5);
    assert.deepEqual(lineSet(lines), [
        ['5.1.02.04', 100, 0], ['1.1.05.02', 21, 0],
        ['5.1.02.04', 100, 0], ['1.1.05.01', 10.5, 0],
        ['5.1.02.04', 50, 0],
        ['5.1.02.05', 12, 0],
        ['1.1.05.04', 30, 0],
    ]);
    assert.match(lines[4].notes, /sellado/);
    // Only VAT-bearing concepts ask for a rate.
    assert.deepEqual(rates, [undefined, 10.5, 0]);
    await assert.rejects(() => bankChargeLines([{ concept: 'nope', amount: 1 }], resolveRate), (err) => err.statusCode === 400);
    await assert.rejects(() => bankChargeLines([{ concept: 'commission', amount: 0 }], resolveRate), (err) => err.statusCode === 400);
});

// ---- VAT rates ----

test('vat rates: default 21 when none is set, a picked rate must be active, ARCA rates only', async (t) => {
    let active = [];
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('is_default = 1')) return [active.filter((rate) => rate.is_default)];
        if (statement.includes('WHERE rate = ?')) return [active];
        return [[]];
    });
    const connection = { query: (...args) => (pool_query(...args)) };
    function pool_query(sql) {
        const statement = String(sql);
        if (statement.includes('is_default = 1')) return [active.filter((rate) => rate.is_default)];
        if (statement.includes('WHERE rate = ?')) return [active];
        return [[]];
    }
    assert.equal(await vatRatesService.defaultRate(connection), 21);
    active = [{ rate: '10.50', is_default: 1 }];
    assert.equal(await vatRatesService.resolveRate(connection, undefined), 10.5);
    assert.equal(await vatRatesService.resolveRate(connection, 10.5), 10.5);
    active = [];
    await assert.rejects(() => vatRatesService.resolveRate(connection, 27), (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_vat_rate');
    await assert.rejects(() => vatRatesService.save({ name: 'Raro', rate: 12 }), (err) => err.statusCode === 400);
});

test('vat rates: the default cannot be deactivated and marking one default clears the others', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM vat_rates WHERE id = ? FOR UPDATE')) return [[{ id: 1, is_default: 1 }]];
        if (statement.startsWith('INSERT INTO vat_rates')) return [{ insertId: 7 }];
        if (statement.startsWith('SELECT id, name, rate')) return [[{ id: 7, name: 'IVA 27%', rate: '27.00', is_default: 1, active: 1 }]];
        return [{ affectedRows: 1 }];
    });
    stubLedger(t);
    await assert.rejects(
        () => vatRatesService.save({ name: 'IVA 21%', rate: 21, active: false }, 1),
        (err) => err.statusCode === 409 && err.responseBody.error === 'default_rate_inactive'
    );
    const saved = await vatRatesService.save({ name: 'IVA 27%', rate: 27, is_default: true });
    assert.deepEqual(saved, { id: 7, name: 'IVA 27%', rate: 27, is_default: true, active: true });
    assert.ok(calls.some((call) => call.sql === 'UPDATE vat_rates SET is_default = (id = ?)' && call.params[0] === 7));
});

// ---- treasury and bank ----

function treasuryPool(t) {
    return mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('FROM vat_rates WHERE is_default = 1')) return [[{ rate: 21 }]];
        if (statement.includes('FROM vat_rates WHERE rate = ?')) return [[{ rate: 10.5 }]];
        if (statement.includes('journal_entry_lines')) return [[{ balance: 1000, pending: 1000 }]];
        return [[]];
    });
}

test('a bank movement carries its bank debits in the same entry; other movements cannot', async (t) => {
    treasuryPool(t);
    const { journals } = stubLedger(t);
    const result = await treasuryService.transfer({
        from: 'bank', to: 'treasury', amount: 1000,
        charges: [{ concept: 'debits_credits_tax', amount: 6 }, { concept: 'commission', amount: 121 }],
    }, 'u1', null, { role: 'admin' });
    assert.equal(result.charges_total, 127);
    const lines = journals[0].lines;
    assert.ok(balanced(lines));
    assert.deepEqual(lineSet(lines), [
        ['1.1.01.02', 1000, 0], ['1.1.02.01', 0, 1000],
        ['5.1.02.05', 6, 0], ['5.1.02.04', 100, 0], ['1.1.05.02', 21, 0],
        ['1.1.02.01', 0, 127],
    ]);
    await assert.rejects(
        () => treasuryService.transfer({ from: 'drawer', to: 'treasury', amount: 10, charges: [{ concept: 'commission', amount: 1 }] }),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_charge'
    );
});

test('bank charges on their own: Debe each concept / Haber Banco, and at least one charge', async (t) => {
    treasuryPool(t);
    const { journals, audits } = stubLedger(t);
    await assert.rejects(() => treasuryService.createBankCharges({ charges: [] }), (err) => err.statusCode === 400);
    const result = await treasuryService.createBankCharges({
        date: '2026-10-12', reference: 'Extracto octubre',
        charges: [{ concept: 'maintenance', amount: 110.5, vat_rate: 10.5 }, { concept: 'withholding', amount: 40 }],
    }, 'u1');
    assert.equal(result.total, 150.5);
    assert.equal(journals[0].reference_type, 'bank_charge');
    assert.equal(journals[0].date.getDate(), 12);
    assert.deepEqual(lineSet(journals[0].lines), [
        ['5.1.02.04', 100, 0], ['1.1.05.01', 10.5, 0], ['1.1.05.04', 40, 0], ['1.1.02.01', 0, 150.5],
    ]);
    assert.equal(audits[0].action, 'CREATE_BANK_CHARGES');
});

test('bank summary groups the lines of an entry into one movement', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('AS balance')) return [[{ balance: '-50.5' }]];
        return [[{ id: 'e1', date: '2026-10-12', description: 'x', reference_type: 'bank_charge', debit: '0', credit: '150.50' }]];
    });
    const summary = await treasuryService.getBankSummary();
    assert.equal(summary.balance, -50.5);
    assert.equal(summary.movements[0].amount, -150.5);
});

test('card settlement: fee VAT at the picked rate, other processor debits, bank gets the rest', async (t) => {
    treasuryPool(t);
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });
    const entries = [];
    const originalIfAny = accountingService.createJournalEntryIfAny;
    accountingService.createJournalEntryIfAny = async (_connection, entry) => { entries.push(entry); };
    t.after(() => { accountingService.createJournalEntryIfAny = originalIfAny; });
    // treasuryPool answers 1000 pending for the cards account (journal_entry_lines).
    const result = await financeService.createCardSettlement({
        amount: 1000, fee_amount: 110.5, fee_vat_rate: 10.5,
        charges: [{ concept: 'withholding', amount: 30 }],
    });
    assert.equal(result.deposited, 859.5);
    assert.deepEqual(lineSet(entries[0].lines), [
        ['1.1.02.01', 859.5, 0], ['5.1.02.04', 100, 0], ['1.1.05.01', 10.5, 0], ['1.1.05.04', 30, 0], ['1.1.02.03', 0, 1000],
    ]);
    await assert.rejects(
        () => financeService.createCardSettlement({ amount: 100, fee_amount: 80, charges: [{ concept: 'withholding', amount: 20 }] }),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_charge'
    );
});

// ---- partial returns: exact refunds ----

function returnsConnection({ invoiced = true, previous = 0, discount = null } = {}) {
    return {
        async query(sql) {
            const statement = String(sql);
            if (statement.startsWith('SELECT id, vat_rate FROM products')) return [[{ id: 'p', vat_rate: 21 }]];
            if (statement.startsWith('SELECT id FROM orders')) return [[{ id: 'o' }]];
            if (statement.startsWith('SELECT id FROM invoices')) return [invoiced ? [{ id: 'inv' }] : []];
            // 3 units charged 100 in total (33.33... each).
            if (statement.includes('product_id IS NOT NULL GROUP BY')) return [[{ product_id: 'p', vat_rate: 21, quantity: 3, gross: 100, vat: 17.36 }]];
            if (statement.includes('product_id IS NULL AND total_line < 0')) return [discount ? [discount] : []];
            if (statement.includes('FROM order_items oi')) return [[{ product_id: 'p', vat_rate: 21, quantity: 3, unit_price: 27.5482 }]];
            if (statement.includes('FROM order_adjustments')) return [discount ? [discount] : []];
            if (statement.includes('r.status = \'approved\'')) {
                const refunded = [0, 33.33, 66.67][previous] ?? 100;
                return [previous ? [{ product_id: 'p', quantity: previous, refunded, refunded_vat: [0, 5.79, 11.57][previous] ?? 17.36, legacy_lines: 0 }] : []];
            }
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    };
}

test('returning units one by one refunds exactly what was charged, never a cent more', async () => {
    const refunded = [];
    for (let previous = 0; previous < 3; previous++) {
        const [refund] = await returnsService._returnRefunds(
            returnsConnection({ previous }),
            { id: `r${previous}`, order_id: 'o' },
            [{ id: `i${previous}`, product_id: 'p', quantity: 1, unit_price: 27.5482, condition_status: 'sellable' }]
        );
        refunded.push(refund.gross);
    }
    assert.deepEqual(refunded, [33.33, 33.34, 33.33]);
    assert.equal(Math.round(refunded.reduce((sum, value) => sum + value, 0) * 100), 10000);
    // All at once: the same total.
    const [all] = await returnsService._returnRefunds(returnsConnection(), { id: 'r', order_id: 'o' },
        [{ id: 'i', product_id: 'p', quantity: 3, unit_price: 27.5482, condition_status: 'sellable' }]);
    assert.deepEqual([all.gross, all.vat], [100, 17.36]);
});

test('a return refunds net of the order discount and splits lines of the same product', async () => {
    const refunds = await returnsService._returnRefunds(
        returnsConnection({ discount: { vat_rate: 21, gross: -10, vat: -1.74 } }),
        { id: 'r', order_id: 'o' },
        [
            { id: 'a', product_id: 'p', quantity: 2, unit_price: 27.5482, condition_status: 'sellable' },
            { id: 'b', product_id: 'p', quantity: 1, unit_price: 27.5482, condition_status: 'damaged' },
            { id: 'c', product_id: 'p', quantity: 1, unit_price: 27.5482, condition_status: 'rejected' },
        ]
    );
    // 3 units, 100 charged, 10 discount: 90 back in total, 60 / 30 by quantity. Rejected: none.
    assert.deepEqual(refunds.map((refund) => [refund.item.id, refund.gross]), [['a', 60], ['b', 30]]);
    // Before invoicing: the order lines (and order discounts) are what was charged.
    const [beforeInvoice] = await returnsService._returnRefunds(returnsConnection({ invoiced: false }), { id: 'r', order_id: 'o' },
        [{ id: 'i', product_id: 'p', quantity: 3, unit_price: 27.5482, condition_status: 'sellable' }]);
    assert.equal(beforeInvoice.gross, 100);
    // Without an order: the sale formula per line.
    const [noOrder] = await returnsService._returnRefunds(returnsConnection(), { id: 'r', order_id: null },
        [{ id: 'i', product_id: 'p', quantity: 1, unit_price: 100, condition_status: 'sellable' }]);
    assert.equal(noOrder.gross, 121);
});

test('before invoicing, more units than ordered fall back to the sale formula', async () => {
    const [refund] = await returnsService._returnRefunds(returnsConnection({ previous: 3, invoiced: false }), { id: 'r', order_id: 'o' },
        [{ id: 'i', product_id: 'p', quantity: 1, unit_price: 100, condition_status: 'sellable' }]);
    assert.equal(refund.gross, 121);
});

// ---- Tiendanube shipping and discounts ----

test('Tiendanube adjustments: shipping, a discount split by VAT rate, or a surcharge', () => {
    const service = new TiendaNubeService({ db: {}, http: {}, env: {} });
    const catalog = new Map([['a', { vat_rate: 21, sale_price: 100 }], ['b', { vat_rate: 10.5, sale_price: 100 }]]);
    const items = [{ product_id: 'a', quantity: 1, unit_price: 100 }, { product_id: 'b', quantity: 1, unit_price: 100 }];
    // Products 121 + 110.50 = 231.50, shipping 1000, total 1208.35: a 23.15 discount.
    const discounted = service.orderAdjustments(
        { total: '1208.35', shipping_cost_customer: '1000', shipping_option: 'Andreani' }, items, catalog
    );
    assert.deepEqual(discounted[0], { kind: 'shipping', description: 'Envío (Andreani)', amount: 1000, vat_rate: 21 });
    const discounts = discounted.slice(1);
    assert.deepEqual(discounts.map((row) => row.vat_rate), [10.5, 21]);
    assert.equal(Math.round(discounts.reduce((sum, row) => sum + row.amount, 0) * 100), -2315);
    assert.match(discounts[0].description, /IVA 10.5%/);
    assert.deepEqual(service.orderAdjustments({ total: '300' }, [items[0]], catalog), [
        { kind: 'surcharge', description: 'Recargo', amount: 179, vat_rate: 21 },
    ]);
    assert.deepEqual(service.orderAdjustments({ total: '121' }, [items[0]], catalog), []);
    assert.deepEqual(service.orderAdjustments({}, [items[0]], catalog), []);
});

// ---- sale posting per VAT rate ----

test('an invoice posts output VAT per rate, and a type C invoice posts none', async (t) => {
    const posted = [];
    const originalCreate = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (_connection, entry) => { posted.push(entry); };
    t.after(() => { accountingService.createJournalEntry = originalCreate; });
    const connectionFor = (invoiceType) => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.startsWith('SELECT * FROM invoices')) {
                return [[{ id: 'inv', invoice_type: invoiceType, point_of_sale: 1, invoice_number: 1, total_amount: 231.5, vat_amount: 31.5, order_id: 'o' }]];
            }
            if (statement.includes('GROUP BY vat_rate')) return [[{ vat_rate: 21, gross: 121, vat: 21 }, { vat_rate: 10.5, gross: 110.5, vat: 10.5 }]];
            return [[]];
        }
    });
    await accountingService.postInvoiceAccountingEntries(connectionFor('B'), 'inv');
    assert.deepEqual(lineSet(posted[0].lines), [
        ['1.1.03.01', 231.5, 0], ['4.1.01.01', 0, 200], ['2.1.02.02', 0, 21], ['2.1.02.01', 0, 10.5],
    ]);
    await accountingService.postInvoiceAccountingEntries(connectionFor('C'), 'inv');
    assert.deepEqual(lineSet(posted[1].lines), [['1.1.03.01', 231.5, 0], ['4.1.01.01', 0, 231.5]]);
});

// ---- review fixes (AUD-005) ----

test('allocateCents splits exactly, also negative totals', async () => {
    const { allocateCents, grossLineAmounts } = await import('../utils/vatMath.js');
    assert.deepEqual(allocateCents(-10000, [10000, 10000, 10000]), [-3334, -3333, -3333]);
    assert.deepEqual(allocateCents(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocateCents(5, [0, 0]), [0, 5]);
    assert.deepEqual(allocateCents(5, []), []);
    assert.deepEqual(grossLineAmounts(-12.1, 21), { net: -10, vat: -2.1, gross: -12.1 });
});

function couponConnection(previousRows = []) {
    // Three products of $100 at 21 %, a -$100 coupon: invoice total $200.
    return {
        async query(sql) {
            const statement = String(sql);
            if (statement.startsWith('SELECT id, vat_rate FROM products')) return [[{ id: 'a', vat_rate: 21 }, { id: 'b', vat_rate: 21 }, { id: 'c', vat_rate: 21 }]];
            if (statement.startsWith('SELECT id FROM orders')) return [[{ id: 'o' }]];
            if (statement.startsWith('SELECT id FROM invoices')) return [[{ id: 'inv' }]];
            if (statement.includes('product_id IS NOT NULL GROUP BY')) {
                return [['a', 'b', 'c'].map((id) => ({ product_id: id, vat_rate: 21, quantity: 1, gross: 100, vat: 17.36 }))];
            }
            if (statement.includes('product_id IS NULL AND total_line < 0')) return [[{ vat_rate: 21, gross: -100, vat: -17.36 }]];
            if (statement.includes("r.status = 'approved'")) return [previousRows];
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    };
}

test('with a coupon over several products the refunds add up to the invoice, never a cent more', async () => {
    const item = (id) => ({ id: `i-${id}`, product_id: id, quantity: 1, unit_price: 82.6446, condition_status: 'sellable' });
    const all = await returnsService._returnRefunds(couponConnection(), { id: 'r', order_id: 'o' }, [item('a'), item('b'), item('c')]);
    assert.equal(Math.round(all.reduce((sum, refund) => sum + refund.gross, 0) * 100), 20000);
    assert.equal(Math.round(all.reduce((sum, refund) => sum + refund.vat, 0) * 100), 3472);
    // The last unit of a product returns what is left of its charge after earlier refunds.
    const [last] = await returnsService._returnRefunds(
        couponConnection([{ product_id: 'a', quantity: 0, refunded: 0, refunded_vat: 0, legacy_lines: 0 }]),
        { id: 'r2', order_id: 'o' }, [item('a')]
    );
    assert.ok(last.gross === 66.67 || last.gross === 66.66);
});

test('once invoiced, a return of more units than invoiced is refused', async () => {
    await assert.rejects(
        () => returnsService._returnRefunds(couponConnection([{ product_id: 'a', quantity: 1, refunded: 66.67, refunded_vat: 11.57, legacy_lines: 0 }]),
            { id: 'r3', order_id: 'o' },
            [{ id: 'x', product_id: 'a', quantity: 1, unit_price: 82.6446, condition_status: 'sellable' }]),
        (err) => err.statusCode === 409 && err.responseBody.error === 'return_exceeds_invoiced'
    );
});

test('a bank charge too small to carry VAT stays in the expense', async () => {
    const { lines } = await bankChargeLines([{ concept: 'commission', amount: 0.02 }], async () => 21);
    assert.deepEqual(lineSet(lines), [['5.1.02.04', 0.02, 0]]);
});

test('Tiendanube: a discount larger than the products becomes a discount on the shipping', () => {
    const service = new TiendaNubeService({ db: {}, http: {}, env: {} });
    const catalog = new Map([['a', { vat_rate: 21, sale_price: 100 }]]);
    const adjustments = service.orderAdjustments({ total: '50', shipping_cost_customer: '100' }, [{ product_id: 'a', quantity: 1, unit_price: 100 }], catalog);
    assert.deepEqual(adjustments, [
        { kind: 'shipping', description: 'Envío', amount: 100, vat_rate: 21 },
        { kind: 'shipping_discount', description: 'Descuento sobre el envío', amount: -50, vat_rate: 21 },
        { kind: 'discount', description: 'Descuento', amount: -121, vat_rate: 21 },
    ]);
});
