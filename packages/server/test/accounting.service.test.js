import test from 'node:test';
import assert from 'node:assert/strict';

import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

test('createJournalEntry throws if description is missing or empty', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: '',
            lines: []
        }),
        /La descripción del asiento contable es obligatoria/
    );
});

test('createJournalEntry throws if lines count is less than 2', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: 'Asiento Inicial',
            lines: [
                { account_code: '1.1.01.01', debit: 100, credit: 0 }
            ]
        }),
        /Un asiento contable debe tener al menos dos partidas/
    );
});

test('createJournalEntry throws if any line has a negative amount', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: 'Asiento Inicial',
            lines: [
                { account_code: '1.1.01.01', debit: -100, credit: 0 },
                { account_code: '1.1.03.01', debit: 0, credit: 100 }
            ]
        }),
        /Los montos del Debe y el Haber no pueden ser negativos/
    );
});

test('createJournalEntry throws if a line has both debit and credit', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: 'Asiento Inicial',
            lines: [
                { account_code: '1.1.01.01', debit: 100, credit: 50 },
                { account_code: '1.1.03.01', debit: 0, credit: 50 }
            ]
        }),
        /Una sola línea contable no puede tener débito y crédito simultáneos/
    );
});

test('createJournalEntry throws if any line has zero amount', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: 'Asiento Inicial',
            lines: [
                { account_code: '1.1.01.01', debit: 0, credit: 0 },
                { account_code: '1.1.03.01', debit: 0, credit: 100 }
            ]
        }),
        /Cada partida debe tener un importe mayor a cero/
    );
});

test('createJournalEntry throws if debits and credits do not balance', async (t) => {
    const connection = {};
    await assert.rejects(
        () => accountingService.createJournalEntry(connection, {
            description: 'Asiento Inicial',
            lines: [
                { account_code: '1.1.01.01', debit: 100, credit: 0 },
                { account_code: '1.1.03.01', debit: 0, credit: 99 }
            ]
        }),
        /Error de partida doble/
    );
});

test('createJournalEntry successfully creates balanced entry', async (t) => {
    const queryCalls = [];
    const mockConnection = {
        async query(sql, params) {
            queryCalls.push({ sql, params });
            return [{ affectedRows: 1 }];
        }
    };

    await accountingService.createJournalEntry(mockConnection, {
        description: 'Venta de mercaderías',
        reference_type: 'invoice',
        reference_id: 'invoice-123',
        lines: [
            { account_code: '1.1.01.01', debit: 121.00, credit: 0, notes: 'Ingreso Caja' },
            { account_code: '4.1.01.01', debit: 0, credit: 100.00, notes: 'Venta neta' },
            { account_code: '2.1.03.01', debit: 0, credit: 21.00, notes: 'IVA Débito Fiscal' }
        ]
    });

    const inserts = queryCalls.filter(c => c.sql.includes('INSERT INTO'));
    assert.ok(inserts.some(c => c.sql.includes('INSERT INTO journal_entries')));
    assert.equal(inserts.filter(c => c.sql.includes('INSERT INTO journal_entry_lines')).length, 3);
});

test('getChartOfAccounts mapping correctly format output properties', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('FROM chart_of_accounts')) {
            return [[
                { code: '1.1.01.01', name: 'Caja', type: 'asset', active: 1, total_debit: 500, total_credit: 200, balance: 300 },
                { code: '2.1.01.01', name: 'Proveedores', type: 'liability', active: 0, total_debit: 100, total_credit: 400, balance: 300 }
            ]];
        }
        return [[]];
    });

    const result = await accountingService.getChartOfAccounts();
    assert.equal(result.length, 2);
    
    assert.equal(result[0].code, '1.1.01.01');
    assert.equal(result[0].active, true);
    assert.equal(result[0].balance, 300);

    assert.equal(result[1].code, '2.1.01.01');
    assert.equal(result[1].active, false);
    assert.equal(result[1].balance, 300);
});
