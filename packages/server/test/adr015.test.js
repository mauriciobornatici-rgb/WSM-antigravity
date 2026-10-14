import test from 'node:test';
import assert from 'node:assert/strict';

import { lineAmounts, netFromGross } from '../utils/vatMath.js';
import { claimIdempotentRequest, saveIdempotentResponse, hashRequest } from '../utils/idempotency.js';
import { StockLedger } from '../domains/inventory/StockLedger.js';
import treasuryService, { ensureTreasuryFunds } from '../services/treasury.service.js';
import financeService from '../services/finance.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

// ---- vatMath (ADR-015) ----

test('lineAmounts charges quantity x the final price: the gross is rounded first', () => {
    // A final price of 100 stored net with 4 decimals (82.6446) must give back exactly 100.
    const net = netFromGross(100, 21);
    assert.equal(net, 82.6446);
    assert.deepEqual(lineAmounts(1, net, 21), { net: 82.64, vat: 17.36, gross: 100 });
    // 3 units cost exactly 300 (not 3 x 82.64 x 1.21 rounded per part), VAT = gross - net.
    assert.deepEqual(lineAmounts(3, net, 21), { net: 247.93, vat: 52.07, gross: 300 });
    // Reduced rate.
    assert.deepEqual(lineAmounts(7, netFromGross(100, 10.5), 10.5), { net: 633.48, vat: 66.52, gross: 700 });
});

test('lineAmounts VAT is always gross minus net and a null rate defaults to 21 %', () => {
    // 81 x 1.105 = 89.505 -> 89.51 gross; the old round(net x rate) gave 8.50 VAT / 89.50.
    assert.deepEqual(lineAmounts(1, 81, 10.5), { net: 81, vat: 8.51, gross: 89.51 });
    const defaulted = lineAmounts(2, 100, null);
    assert.deepEqual(defaulted, { net: 200, vat: 42, gross: 242 });
    assert.equal(defaulted.net + defaulted.vat, defaulted.gross);
    assert.deepEqual(lineAmounts(0, 100, 21), { net: 0, vat: 0, gross: 0 });
    assert.equal(netFromGross(121, ''), 100);
});

// ---- idempotency ----

function idempotencyConnection({ duplicate = false, stored = null } = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.startsWith('INSERT INTO idempotency_requests')) {
                if (duplicate) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('FROM idempotency_requests') && statement.includes('FOR SHARE')) {
                return [stored ? [stored] : []];
            }
            return [[]];
        }
    };
}

test('first attempt with a key inserts the claim and is not a replay', async () => {
    const connection = idempotencyConnection();
    const payload = { amount: 10, idempotency_key: 'k-1' };
    const result = await claimIdempotentRequest(connection, 'scope', 'k-1', payload);
    assert.deepEqual(result, { replay: null });
    assert.equal(connection.calls.length, 1);
    assert.deepEqual(connection.calls[0].params, ['scope', 'k-1', hashRequest(payload)]);
});

test('a duplicate key with the same payload replays the stored response', async () => {
    const payload = { b: 2, a: 1, idempotency_key: 'k-1' };
    // The hash ignores key order and the idempotency_key itself.
    const stored = { request_hash: hashRequest({ a: 1, b: 2 }), response_json: JSON.stringify({ id: 'first', total: 5 }) };
    const connection = idempotencyConnection({ duplicate: true, stored });
    const result = await claimIdempotentRequest(connection, 'scope', 'k-1', payload);
    assert.deepEqual(result, { replay: { id: 'first', total: 5, idempotent_replay: true } });
    assert.match(connection.calls[1].sql, /FOR SHARE$/);
});

test('a duplicate key with another payload is a 409 idempotency_key_reused', async () => {
    const stored = { request_hash: hashRequest({ amount: 10 }), response_json: '{}' };
    const connection = idempotencyConnection({ duplicate: true, stored });
    await assert.rejects(
        () => claimIdempotentRequest(connection, 'scope', 'k-1', { amount: 99 }),
        (err) => err.statusCode === 409 && err.responseBody?.error === 'idempotency_key_reused'
    );
});

test('a non-duplicate insert failure is rethrown and no key means no queries', async () => {
    const failing = { query: async () => { throw new Error('conn lost'); } };
    await assert.rejects(() => claimIdempotentRequest(failing, 'scope', 'k', {}), /conn lost/);

    const connection = idempotencyConnection();
    assert.deepEqual(await claimIdempotentRequest(connection, 'scope', undefined, { amount: 1 }), { replay: null });
    await saveIdempotentResponse(connection, 'scope', undefined, { id: 'x' });
    assert.equal(connection.calls.length, 0);

    await saveIdempotentResponse(connection, 'scope', 'k', { id: 'x' });
    assert.deepEqual(connection.calls[0].params, [JSON.stringify({ id: 'x' }), 'scope', 'k']);
});

// ---- StockLedger.orderByChannel ----

test('orderByChannel puts the sales floor first at the counter and the warehouse first for orders', () => {
    const ledger = new StockLedger();
    const rows = [
        { id: 'back-small', location: 'Deposito-A', quantity: 3, reserved_quantity: 0 },
        { id: 'floor-small', location: 'Salon', quantity: 2, reserved_quantity: 0 },
        { id: 'back-big', location: 'Deposito-B', quantity: 9, reserved_quantity: 1 },
        { id: 'floor-big', location: 'Salon-2', quantity: 6, reserved_quantity: 0 }
    ];
    const floor = new Set(['Salon', 'Salon-2']);
    // Within the same kind, the row with more available stock (quantity - reserved) goes first.
    assert.deepEqual(ledger.orderByChannel(rows, floor, 'counter').map((r) => r.id),
        ['floor-big', 'floor-small', 'back-big', 'back-small']);
    assert.deepEqual(ledger.orderByChannel(rows, floor, 'order').map((r) => r.id),
        ['back-big', 'back-small', 'floor-big', 'floor-small']);
    // The input is not mutated.
    assert.equal(rows[0].id, 'back-small');
});

test('salesFloorCodes tolerates empty and non-array answers', async () => {
    const ledger = new StockLedger();
    assert.deepEqual([...await ledger.salesFloorCodes({ query: async () => [[{ code: 'Salon' }]] })], ['Salon']);
    assert.equal((await ledger.salesFloorCodes({ query: async () => [[]] })).size, 0);
    assert.equal((await ledger.salesFloorCodes({ query: async () => [{ affectedRows: 0 }] })).size, 0);
    assert.equal((await ledger.salesFloorCodes({ query: async () => undefined })).size, 0);
});

// ---- treasury ----

test('ensureTreasuryFunds locks Caja 2 and refuses an amount above its balance with 409', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('SUM(debit)')) return [[{ balance: '100.00' }]];
        return [[]];
    } };
    assert.equal(await ensureTreasuryFunds(connection, 100), 100);
    assert.match(calls[0].sql, /FROM chart_of_accounts WHERE code = \? FOR UPDATE$/);
    assert.deepEqual(calls[0].params, ['1.1.01.02']);
    await assert.rejects(
        () => ensureTreasuryFunds(connection, 100.01),
        (err) => err.statusCode === 409 && err.responseBody.error === 'insufficient_treasury_cash' && err.responseBody.balance === 100
    );
});

function treasuryHarness(t, { treasuryBalance = 1000 } = {}) {
    const calls = [];
    const journals = [];
    let cashOut = 0;
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes("FROM cash_shifts WHERE id = ? AND status = 'open' FOR UPDATE")) return [[{ id: 'shift-1' }]];
        if (statement.includes("FROM cash_shifts WHERE status = 'open'")) return [[{ id: 'shift-1' }]];
        if (statement.includes('INSERT INTO shift_payments')) cashOut += params[2];
        if (statement.includes('FROM shift_payments')) return [[{ inflow: 500, outflow: cashOut }]];
        if (statement.includes('SELECT opening_balance')) return [[{ opening_balance: 0 }]];
        if (statement.includes('journal_entry_lines')) return [[{ balance: treasuryBalance }]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntry, audit: auditService.log };
    accountingService.createJournalEntry = async (_connection, entry) => { journals.push(entry); };
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });
    return { calls, journals, connection };
}

test('treasury transfer validates origin, destination and amount before touching the database', async (t) => {
    const { calls } = treasuryHarness(t);
    const invalidTransfer = (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_transfer';
    await assert.rejects(() => treasuryService.transfer({ from: 'bank', to: 'bank', amount: 10 }), invalidTransfer);
    await assert.rejects(() => treasuryService.transfer({ from: 'bank', to: 'initial', amount: 10 }), invalidTransfer);
    await assert.rejects(() => treasuryService.transfer({ from: 'nowhere', to: 'bank', amount: 10 }), invalidTransfer);
    // The initial balance only opens Caja 2.
    await assert.rejects(() => treasuryService.transfer({ from: 'initial', to: 'bank', amount: 10 }), invalidTransfer);
    await assert.rejects(() => treasuryService.transfer({ from: 'initial', to: 'drawer', amount: 10 }), invalidTransfer);
    await assert.rejects(
        () => treasuryService.transfer({ from: 'bank', to: 'treasury', amount: 0 }),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_amount'
    );
    await assert.rejects(
        () => treasuryService.transfer({ from: 'bank', to: 'treasury', amount: -5 }),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_amount'
    );
    assert.equal(calls.length, 0);
});

test('treasury transfer posts Debe destino / Haber origen', async (t) => {
    const { journals, calls } = treasuryHarness(t);
    const result = await treasuryService.transfer({ from: 'bank', to: 'treasury', amount: 250.5, notes: ' retiro ' }, 'u1', '127.0.0.1');
    assert.equal(result.amount, 250.5);
    assert.equal(journals.length, 1);
    assert.equal(journals[0].reference_type, 'treasury_transfer');
    assert.deepEqual(journals[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [
        ['1.1.01.02', 250.5, 0],
        ['1.1.02.01', 0, 250.5]
    ]);
    // Bank to Caja 2 moves no shift cash and needs no Caja 2 balance check, but still takes the
    // Caja 2 lock first (same lock order as every other Caja 2 movement).
    assert.equal(calls.some((call) => call.sql.includes('shift_payments')), false);
    assert.equal(calls.some((call) => call.sql.includes('journal_entry_lines')), false);
    assert.match(calls[0].sql, /FROM chart_of_accounts WHERE code = \? FOR UPDATE$/);
});

test('treasury transfer from Caja 2 requires funds; from the initial balance it counters capital', async (t) => {
    const { journals } = treasuryHarness(t, { treasuryBalance: 100 });
    await assert.rejects(
        () => treasuryService.transfer({ from: 'treasury', to: 'bank', amount: 150 }),
        (err) => err.statusCode === 409 && err.responseBody.error === 'insufficient_treasury_cash'
    );
    assert.equal(journals.length, 0);
    // ADR-016: only the administrator loads the opening balance.
    await assert.rejects(
        () => treasuryService.transfer({ from: 'initial', to: 'treasury', amount: 40 }, 'u1', null, { role: 'manager' }),
        (err) => err.statusCode === 403
    );
    await treasuryService.transfer({ from: 'initial', to: 'treasury', amount: 40 }, 'u1', null, { role: 'admin' });
    assert.deepEqual(journals[0].lines.map((line) => line.account_code), ['1.1.01.02', '3.1.01.01']);
});

test('treasury transfer from the drawer records a transfer_out of the open shift', async (t) => {
    const { journals, calls } = treasuryHarness(t);
    await treasuryService.transfer({ from: 'drawer', to: 'treasury', amount: 120 });
    const outflow = calls.find((call) => call.sql.includes('INSERT INTO shift_payments'));
    assert.ok(outflow);
    assert.deepEqual([outflow.params[1], outflow.params[2], outflow.params[3]], ['shift-1', 120, 'transfer_out']);
    assert.deepEqual(journals[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [
        ['1.1.01.02', 120, 0],
        ['1.1.01.01', 0, 120]
    ]);
});

// ---- card settlement fee ----

test('createCardSettlement splits the processor fee into net expense and VAT credit 21 %', async (t) => {
    let entry;
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SUM(debit)')) return [[{ pending: 10000 }]];
        return [[]];
    });
    const originals = { journal: accountingService.createJournalEntryIfAny, audit: auditService.log };
    accountingService.createJournalEntryIfAny = async (_connection, journal) => { entry = journal; };
    auditService.log = async () => {};
    t.after(() => {
        accountingService.createJournalEntryIfAny = originals.journal;
        auditService.log = originals.audit;
    });

    const result = await financeService.createCardSettlement({ amount: 5000, fee_amount: 242 });
    assert.equal(result.pending_balance, 5000);
    // fee 242 = 200 net + 42 VAT; the bank receives amount - fee.
    const byAccount = Object.fromEntries(entry.lines.map((line) => [line.account_code, line]));
    assert.equal(byAccount['5.1.02.04'].debit, 200);
    assert.equal(byAccount['1.1.05.02'].debit, 42);
    assert.equal(byAccount['1.1.02.01'].debit, 4758);
    assert.equal(byAccount['1.1.02.03'].credit, 5000);
    const debit = entry.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = entry.lines.reduce((sum, line) => sum + line.credit, 0);
    assert.equal(Math.round(debit * 100), Math.round(credit * 100));
});
