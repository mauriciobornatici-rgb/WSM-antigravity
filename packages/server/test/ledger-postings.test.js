import test from 'node:test';
import assert from 'node:assert/strict';

import { ACCOUNTS, receiptAccountFor, disbursementAccountFor } from '../utils/paymentAccounts.js';
import cashRegisterService from '../services/cashRegister.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { returnsService } from '../services/warranties.service.js';
import { mockPool } from './helpers/mockDb.js';

test('C5: card and QR receipts are not cash in the drawer', () => {
    assert.equal(receiptAccountFor('cash'), ACCOUNTS.CASH);
    for (const method of ['card', 'debit_card', 'credit_card', 'qr']) assert.equal(receiptAccountFor(method), ACCOUNTS.CARDS_TO_COLLECT, method);
    assert.equal(receiptAccountFor('transfer'), ACCOUNTS.BANK);
    assert.equal(receiptAccountFor('check'), ACCOUNTS.CHECKS_TO_DEPOSIT);
    assert.equal(receiptAccountFor(undefined), ACCOUNTS.CASH);
});

test('supplier payments leave the drawer only when paid in cash', () => {
    assert.equal(disbursementAccountFor('Efectivo'), ACCOUNTS.CASH);
    assert.equal(disbursementAccountFor('cash'), ACCOUNTS.CASH);
    assert.equal(disbursementAccountFor('transfer'), ACCOUNTS.BANK);
    assert.equal(disbursementAccountFor('check'), ACCOUNTS.BANK);
    assert.equal(disbursementAccountFor('check', { thirdPartyCheck: true }), ACCOUNTS.CHECKS_TO_DEPOSIT);
});

test('createJournalEntryIfAny drops zero lines and skips an all-zero entry', async (t) => {
    const posted = [];
    const original = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (_c, entry) => { posted.push(entry); return 'je'; };
    t.after(() => { accountingService.createJournalEntry = original; });

    assert.equal(await accountingService.createJournalEntryIfAny({}, { description: 'x', lines: [{ account_code: 'a', debit: 0 }, { account_code: 'b', credit: 0 }] }), null);
    await accountingService.createJournalEntryIfAny({}, { description: 'y', lines: [{ account_code: 'a', debit: 5 }, { account_code: 'z', debit: 0 }, { account_code: 'b', credit: 5 }] });
    assert.deepEqual(posted[0].lines.map((l) => l.account_code), ['a', 'b']);
});

function cashPool(t, { order = { client_id: 'c-1' } } = {}) {
    const calls = [];
    const entries = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT id FROM cash_shifts')) return [[{ id: 's-1' }]];
        if (statement.startsWith('SELECT current_shift_id')) return [[{ current_shift_id: 's-1', status: 'open' }]];
        if (statement.startsWith('SELECT client_id FROM orders')) return [order ? [order] : []];
        if (statement.includes('FROM shift_payments') && statement.startsWith('SELECT id')) return [[]];
        if (statement.includes('FROM cash_shifts') || statement.includes('shift_payments')) return [[{ opening_balance: 0, inflow: 0, outflow: 0, expected_balance: 0 }]];
        return [{ affectedRows: 1 }];
    });
    const original = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (_c, entry) => { entries.push(entry); return 'je'; };
    const originalLog = auditService.log;
    auditService.log = async () => {};
    t.after(() => { accountingService.createJournalEntry = original; auditService.log = originalLog; });
    return { calls, entries };
}

const sides = (entry) => entry.lines.map((l) => [l.account_code, l.debit, l.credit]);

test('C4: a cash refund is posted against receivables and recorded in the client account', async (t) => {
    const { calls, entries } = cashPool(t);
    await cashRegisterService.addShiftPayment('s-1', { orderId: 'o-1', paymentMethod: 'cash', amount: 50, type: 'refund' });
    assert.deepEqual(sides(entries[0]), [[ACCOUNTS.RECEIVABLES, 50, 0], [ACCOUNTS.CASH, 0, 50]]);
    const refund = calls.find(({ statement }) => statement.startsWith('INSERT INTO transactions'));
    assert.equal(refund.params[1], 50);
    assert.equal(refund.params.at(-1), 'c-1', 'the refund belongs to the client of the order');
});

test('C4: a sale shift payment is not posted again (its invoice posts it)', async (t) => {
    const { entries } = cashPool(t);
    await cashRegisterService.addShiftPayment('s-1', { orderId: 'o-1', paymentMethod: 'cash', amount: 50, type: 'sale' });
    assert.equal(entries.length, 0);
});

test('C4: a refund "to current account" is refused: no money leaves the drawer', async (t) => {
    const { calls, entries } = cashPool(t);
    await assert.rejects(
        () => cashRegisterService.addShiftPayment('s-1', { orderId: 'o-1', paymentMethod: 'credit_account', amount: 50, type: 'refund' }),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_payment_method'
    );
    assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT')), false);
    assert.equal(entries.length, 0);
});

test('C4: drawer expenses and income are posted', async (t) => {
    const { entries } = cashPool(t);
    await cashRegisterService.createCashTransaction({ registerId: 'r-1', type: 'expense', amount: 30, reason: 'Flete' });
    await cashRegisterService.createCashTransaction({ registerId: 'r-1', type: 'income', amount: 20, reason: 'Aporte' });
    assert.deepEqual(sides(entries[0]), [[ACCOUNTS.GENERAL_EXPENSES, 30, 0], [ACCOUNTS.CASH, 0, 30]]);
    assert.deepEqual(sides(entries[1]), [[ACCOUNTS.CASH, 20, 0], [ACCOUNTS.OTHER_INCOME, 0, 20]]);
});

test('C6: an approved return reverses the cost of what came back once the sale posted its CMV', async (t) => {
    const entries = [];
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM client_returns')) return [[{ id: 'r', status: 'pending', order_id: 'o', client_id: null }]];
        if (statement.includes('SELECT * FROM client_return_items')) return [[
            { product_id: 'p', quantity: 2, unit_price: 50, condition_status: 'sellable' },
            { product_id: 'p', quantity: 1, unit_price: 50, condition_status: 'damaged' },
        ]];
        if (statement.includes('SELECT id, vat_rate FROM products')) return [[{ id: 'p', vat_rate: 21 }]];
        if (statement.includes('purchase_price, cost_price FROM products')) return [[{ id: 'p', purchase_price: 30 }]];
        if (statement.includes('JOIN invoices i ON i.id = je.reference_id')) return [[{ id: 'je-cmv' }]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntry, number: returnsService._nextCreditNoteNumber, log: auditService.log };
    accountingService.createJournalEntry = async (_c, entry) => { entries.push(entry); };
    returnsService._nextCreditNoteNumber = async () => 'NC-1';
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        returnsService._nextCreditNoteNumber = originals.number;
        auditService.log = originals.log;
    });

    await returnsService.approveReturn('r', null, null);

    const cost = entries.find((entry) => entry.description.startsWith('Reversión de costo'));
    assert.deepEqual(sides(cost), [
        [ACCOUNTS.INVENTORY, 60, 0],          // 2 sellable units × 30 back in stock
        [ACCOUNTS.INVENTORY_LOSSES, 30, 0],   // 1 damaged unit × 30 lost
        [ACCOUNTS.COGS, 0, 90],
    ]);
});
