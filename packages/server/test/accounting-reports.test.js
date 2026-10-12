import test from 'node:test';
import assert from 'node:assert/strict';

import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('postInvoiceAccountingEntries rejects missing invoices', async () => {
    const connection = { query: async () => [[]] };
    await assert.rejects(() => accountingService.postInvoiceAccountingEntries(connection, 'missing'), /Invoice not found/);
});

test('postInvoiceAccountingEntries creates balanced sale, VAT and cost entries once', async (t) => {
    const created = [];
    const originalCreate = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (_connection, entry) => { created.push(entry); return `entry-${created.length}`; };
    t.after(() => { accountingService.createJournalEntry = originalCreate; });

    const connection = { query: async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) return [[{
            id: 'invoice-1', invoice_type: 'B', point_of_sale: 1, invoice_number: 12,
            issue_date: '2026-08-22', total_amount: 121, vat_amount: 21
        }]];
        if (sql.includes("jel.account_code = '4.1.01.01'")) return [[]];
        if (sql.includes("jel.account_code = '5.1.01.01'")) return [[]];
        if (sql.includes('SELECT ii.quantity')) return [[
            { quantity: 2, purchase_price: 30, cost_price: 20 },
            { quantity: 1, purchase_price: 0, cost_price: 10 }
        ]];
        return [[]];
    }};

    await accountingService.postInvoiceAccountingEntries(connection, 'invoice-1');
    assert.equal(created.length, 2);
    assert.equal(created[0].lines.length, 3);
    assert.equal(created[0].lines.reduce((sum, line) => sum + line.debit - line.credit, 0), 0);
    assert.equal(created[1].lines[0].debit, 70);
});

test('postInvoiceAccountingEntries skips already posted and zero-value movements', async (t) => {
    const originalCreate = accountingService.createJournalEntry;
    let created = 0;
    accountingService.createJournalEntry = async () => { created += 1; };
    t.after(() => { accountingService.createJournalEntry = originalCreate; });
    const connection = { query: async (sql) => {
        if (sql.includes('SELECT * FROM invoices')) return [[{ invoice_type: 'B', point_of_sale: 1, invoice_number: 1, total_amount: 0, vat_amount: 0 }]];
        if (sql.includes("jel.account_code = '4.1.01.01'")) return [[{ id: 'sale-entry' }]];
        if (sql.includes("jel.account_code = '5.1.01.01'")) return [[]];
        if (sql.includes('SELECT ii.quantity')) return [[{ quantity: 1, purchase_price: 0, cost_price: 0 }]];
        return [[]];
    }};
    await accountingService.postInvoiceAccountingEntries(connection, 'invoice-1');
    assert.equal(created, 0);
});

test('getJournalEntries applies filters and joins transactions, inventory and credit notes', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM journal_entries je')) return [[
            { id: 'entry-1', entry_number: 1, reference_id: 'ref-1', reference_type: 'invoice' },
            { id: 'entry-2', entry_number: 2, reference_id: null, reference_type: 'manual' }
        ]];
        if (sql.includes('FROM journal_entry_lines')) return [[
            { id: 'line-1', journal_entry_id: 'entry-1', account_code: '1.1', account_name: 'Caja', account_type: 'asset', debit: '10.25', credit: 0 }
        ]];
        if (sql.includes('FROM transactions')) return [[{ id: 'tx-1', reference_id: 'ref-1', amount: '10.25', type: 'sale' }]];
        if (sql.includes('FROM inventory_movements')) return [[{ id: 'mov-1', reference_id: 'ref-1', quantity: '2', type: 'sale' }]];
        if (sql.includes('FROM credit_notes')) return [[{ id: 'cn-1', reference_id: 'ref-1', amount: '3', number: 'NC-1', notes: null, status: 'authorized' }]];
        return [[]];
    }};

    const result = await accountingService.getJournalEntries({ start_date: '2026-01-01', end_date: '2026-12-31', reference_type: 'invoice', reference_id: 'ref-1' }, connection);
    assert.equal(result[0].lines[0].debit, 10.25);
    assert.deepEqual(result[0].related_movements.map((item) => item.kind), ['transaction', 'inventory', 'credit_note']);
    assert.deepEqual(result[1].lines, []);
    assert.deepEqual(result[1].related_movements, []);
    assert.ok(calls[0].sql.includes('DATE(je.date) >= DATE(?)'));
    assert.deepEqual(calls[0].params, ['2026-01-01', '2026-12-31', 'invoice', 'ref-1']);
});

test('getTrialBalance calculates debit and credit nature balances', async () => {
    let call = 0;
    const connection = { query: async () => {
        call += 1;
        if (call === 1) return [[{ account_code: '1.1', initial_debit: 100, initial_credit: 10 }, { account_code: '2.1', initial_debit: 0, initial_credit: 20 }]];
        if (call === 2) return [[{ account_code: '1.1', period_debit: 50, period_credit: 5 }, { account_code: '2.1', period_debit: 2, period_credit: 8 }]];
        return [[{ code: '1.1', name: 'Caja', type: 'asset' }, { code: '2.1', name: 'Proveedores', type: 'liability' }, { code: '5.1', name: 'Gasto', type: 'expense' }]];
    }};
    const result = await accountingService.getTrialBalance({ start_date: '2026-01-01', end_date: '2026-12-31' }, connection);
    assert.equal(result[0].initial_balance, 90);
    assert.equal(result[0].final_balance, 135);
    assert.equal(result[1].initial_balance, 20);
    assert.equal(result[1].final_balance, 26);
    assert.equal(result[2].final_balance, 0);
});

test('getTrialBalance supports an unrestricted period', async () => {
    let call = 0;
    const connection = { query: async () => {
        call += 1;
        if (call === 1) return [[{ account_code: '3.1', period_debit: 1, period_credit: 11 }]];
        return [[{ code: '3.1', name: 'Capital', type: 'equity' }]];
    }};
    const result = await accountingService.getTrialBalance({}, connection);
    assert.equal(result[0].final_balance, 10);
});

test('getIncomeStatement merges posted and historical unposted operations', async () => {
    let call = 0;
    const connection = { query: async () => {
        call += 1;
        if (call === 1) return [[
            { account_code: '4.1.01.01', account_name: 'Ventas', account_type: 'revenue', total_debit: 10, total_credit: 110 },
            { account_code: '5.1.01.01', account_name: 'CMV', account_type: 'expense', total_debit: 50, total_credit: 5 }
        ]];
        return [[{ revenue: 20, cmv: 8 }]];
    }};
    const result = await accountingService.getIncomeStatement({ start_date: '2026-01-01', end_date: '2026-12-31' }, connection);
    assert.equal(result.total_revenues, 120);
    assert.equal(result.total_expenses, 53);
    assert.equal(result.net_result, 67);
    assert.equal(result.revenues[0].balance, 120);
    assert.equal(result.expenses[0].balance, 53);
});

test('getIncomeStatement creates historical rows when no matching account is posted', async () => {
    let call = 0;
    const connection = { query: async () => {
        call += 1;
        return call === 1 ? [[]] : [[{ revenue: 100, cmv: 40 }]];
    }};
    const result = await accountingService.getIncomeStatement({}, connection);
    assert.equal(result.revenues[0].code, '4.1.01.01');
    assert.equal(result.expenses[0].code, '5.1.01.01');
    assert.equal(result.net_result, 60);
});

test('manual journal entry commits and audits, while failures rollback', async (t) => {
    const connection = mockPool(t, async () => [{ affectedRows: 1 }]);
    let commits = 0;
    let rollbacks = 0;
    connection.commit = async () => { commits += 1; };
    connection.rollback = async () => { rollbacks += 1; };
    const originalCreate = accountingService.createJournalEntry;
    const originalAudit = auditService.log;
    accountingService.createJournalEntry = async () => 'manual-1';
    auditService.log = async () => {};
    t.after(() => { accountingService.createJournalEntry = originalCreate; auditService.log = originalAudit; });

    assert.equal((await accountingService.createManualEntry({ date: '2026-08-22', description: 'Ajuste', lines: [{}, {}] }, 'user-1')).id, 'manual-1');
    assert.equal(commits, 1);
    accountingService.createJournalEntry = async () => { throw new Error('invalid'); };
    await assert.rejects(() => accountingService.createManualEntry({ lines: [] }, 'user-1'), /invalid/);
    assert.equal(rollbacks, 1);
});

test('account CRUD enforces uniqueness and protects used accounts', async (t) => {
    const calls = [];
    let existing = true;
    let hasLines = true;
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT code FROM')) return [existing ? [{ code: '9.1' }] : []];
        if (sql.includes('SELECT id FROM journal_entry_lines')) return [hasLines ? [{ id: 'line-1' }] : []];
        return [{ affectedRows: 1 }];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });

    await assert.rejects(() => accountingService.createAccount({ code: '9.1', name: 'Test', type: 'asset' }, 'u1'), /Ya existe/);
    existing = false;
    assert.equal((await accountingService.createAccount({ code: '9.1', name: 'Test', type: 'asset' }, 'u1')).success, true);
    assert.equal((await accountingService.updateAccount('9.1', { name: 'Nuevo', active: false }, 'u1')).success, true);
    await assert.rejects(() => accountingService.deleteAccount('9.1', 'u1'), /movimientos contables/);
    hasLines = false;
    assert.equal((await accountingService.deleteAccount('9.1', 'u1')).success, true);
    assert.ok(calls.some(({ sql }) => sql.startsWith('DELETE FROM chart_of_accounts')));
});

test('getBalanceSheet groups current and non-current Argentine balances', async (t) => {
    const originalTrial = accountingService.getTrialBalance;
    const originalIncome = accountingService.getIncomeStatement;
    accountingService.getTrialBalance = async () => [
        { code: '1.1.01', name: 'Caja', type: 'asset', final_balance: 100, debit: 100, credit: 0 },
        { code: '1.2.01', name: 'Rodados', type: 'asset', final_balance: 200, debit: 200, credit: 0 },
        { code: '2.1.01', name: 'Proveedores', type: 'liability', final_balance: 80, debit: 0, credit: 80 },
        { code: '2.2.01', name: 'Préstamo', type: 'liability', final_balance: 120, debit: 0, credit: 120 },
        { code: '3.1.01', name: 'Capital', type: 'equity', final_balance: 50, debit: 0, credit: 50 },
        { code: '9.9.99', name: 'Vacía', type: 'asset', final_balance: 0, debit: 0, credit: 0 }
    ];
    accountingService.getIncomeStatement = async () => ({ net_result: 50 });
    t.after(() => { accountingService.getTrialBalance = originalTrial; accountingService.getIncomeStatement = originalIncome; });

    const result = await accountingService.getBalanceSheet({});
    assert.equal(result.assets.corriente.length, 1);
    assert.equal(result.assets.no_corriente.length, 1);
    assert.equal(result.liabilities.corriente.length, 1);
    assert.equal(result.liabilities.no_corriente.length, 1);
    assert.equal(result.equity.total, 100);
    assert.equal(result.totals.discrepancy, 0);
});
