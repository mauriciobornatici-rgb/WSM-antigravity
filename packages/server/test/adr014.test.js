import test from 'node:test';
import assert from 'node:assert/strict';

import { creditNotesService } from '../services/warranties.service.js';
import { recordDrawerOutflow } from '../services/cashShift.service.js';
import { formatAfipDate, associatedVoucherMatches } from '../services/afip.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

// ---- manual credit note against an invoice (ADR-014) ----

const invoice = {
    id: 'inv-1', client_id: 'c-1', invoice_type: 'A', point_of_sale: 4, total_amount: '1210.00', vat_amount: '210.00',
};

function manualNotePool(t, { invoiceRow = invoice, credited = 0 } = {}) {
    const calls = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT * FROM invoices WHERE id')) return [invoiceRow ? [invoiceRow] : []];
        if (statement.includes('AS credited FROM credit_notes')) return [[{ credited }]];
        if (statement.includes('max_seq')) return [[{ max_seq: 0 }]];
        if (statement.includes('document_sequences')) return [[{ last_value: 1 }]];
        return [{ affectedRows: 1, insertId: 0 }];
    });
    const lifecycle = [];
    connection.commit = async () => { lifecycle.push('commit'); };
    connection.rollback = async () => { lifecycle.push('rollback'); };
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntryIfAny };
    const journals = [];
    auditService.log = async () => {};
    accountingService.createJournalEntryIfAny = async (_connection, entry) => { journals.push(entry); };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntryIfAny = originals.journal;
    });
    return { calls, lifecycle, journals };
}

test('a manual credit note without invoice_id is refused with 400 before anything is written', async (t) => {
    const { calls, lifecycle } = manualNotePool(t);
    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: 'c-1', amount: 100 }, 'u-1', null),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invoice_required'
    );
    assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT')), false);
    assert.deepEqual(lifecycle, ['rollback']);
});

test('a manual credit note on an invoice of another client or a missing one is refused with 400', async (t) => {
    for (const invoiceRow of [{ ...invoice, client_id: 'c-2' }, null]) {
        const { calls, lifecycle } = manualNotePool(t, { invoiceRow });
        await assert.rejects(
            () => creditNotesService.createManualCreditNote({ client_id: 'c-1', invoice_id: 'inv-1', amount: 100 }, 'u-1', null),
            (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_invoice'
        );
        assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT')), false);
        assert.deepEqual(lifecycle, ['rollback']);
    }
});

test('a manual credit note above what is still creditable is refused with 409', async (t) => {
    const { calls, lifecycle } = manualNotePool(t, { credited: '1000.00' });
    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: 'c-1', invoice_id: 'inv-1', amount: 210.01 }, 'u-1', null),
        (err) => err.statusCode === 409
            && err.responseBody.error === 'exceeds_invoice_balance'
            && err.responseBody.creditable === 210
    );
    assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT INTO credit_notes')), false);
    assert.deepEqual(lifecycle, ['rollback']);
    // The invoice is locked so two notes cannot both pass the balance check.
    assert.ok(calls.some(({ statement }) => statement.startsWith('SELECT * FROM invoices') && statement.endsWith('FOR UPDATE')));
});

test('a manual credit note up to the creditable balance takes the invoice letter and its VAT proportion', async (t) => {
    const { calls, lifecycle, journals } = manualNotePool(t, { credited: '1089.00' });
    const result = await creditNotesService.createManualCreditNote(
        { client_id: 'c-1', invoice_id: 'inv-1', amount: 121, reference_type: 'discount', notes: 'Bonificación' }, 'u-1', null
    );
    assert.deepEqual(lifecycle, ['commit']);
    assert.equal(result.invoice_id, 'inv-1');
    assert.equal(result.credit_note_type, 'A');
    const insert = calls.find(({ statement }) => statement.startsWith('INSERT INTO credit_notes'));
    assert.equal(insert.params.length, 12);
    assert.deepEqual(insert.params.slice(6), [121, 'Bonificación', null, 'inv-1', 'A', 4]);
    // 210 / 1210 of the note is VAT: 121 -> 100 net + 21 VAT, no company_settings lookup.
    assert.equal(calls.some(({ statement }) => statement.includes('company_settings')), false);
    const [entry] = journals;
    assert.deepEqual(entry.lines.map((line) => [line.debit, line.credit]), [[100, 0], [21, 0], [0, 121]]);
});

// ---- cash leaving the drawer ----

function drawerConnection({ shifts = [{ id: 'shift-1' }], inflow = 100, opening = 0, locked = true } = {}) {
    const calls = [];
    let outflow = 0;
    return {
        calls,
        async query(sql, params) {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ statement, params });
            if (statement.startsWith('SELECT id FROM cash_shifts WHERE id = ?')) return [locked ? shifts.slice(0, 1) : []];
            if (statement.startsWith('SELECT id FROM cash_shifts')) return [shifts];
            if (statement.startsWith('INSERT INTO shift_payments')) { outflow += params[2]; return [{ affectedRows: 1 }]; }
            if (statement.includes('FROM shift_payments')) return [[{ inflow, outflow }]];
            if (statement.startsWith('SELECT opening_balance')) return [[{ opening_balance: opening }]];
            return [{ affectedRows: 1 }];
        },
    };
}

test('paying cash without an open register is refused with 409', async () => {
    const connection = drawerConnection({ shifts: [] });
    await assert.rejects(
        () => recordDrawerOutflow(connection, { amount: 10 }),
        (err) => err.statusCode === 409 && err.responseBody.error === 'no_open_cash_register'
    );
    assert.equal(connection.calls.some(({ statement }) => statement.startsWith('INSERT')), false);
});

test('paying cash with two open registers asks which one, with 409', async () => {
    const connection = drawerConnection({ shifts: [{ id: 'a' }, { id: 'b' }] });
    await assert.rejects(
        () => recordDrawerOutflow(connection, { amount: 10 }),
        (err) => err.statusCode === 409 && err.responseBody.error === 'cash_register_required'
    );
    assert.equal(connection.calls.some(({ statement }) => statement.startsWith('INSERT')), false);
});

test('a chosen register narrows the lookup to its own open shift', async () => {
    const connection = drawerConnection();
    await recordDrawerOutflow(connection, { registerId: 'reg-2', amount: 10 });
    const [lookup, lock] = connection.calls;
    // Found without locking (no scan-lock of every shift), then only that row is locked.
    assert.match(lookup.statement, /cash_register_id = \? AND status = 'open'$/);
    assert.deepEqual(lookup.params, ['reg-2']);
    assert.match(lock.statement, /WHERE id = \? AND status = 'open' FOR UPDATE$/);
    assert.deepEqual(lock.params, ['shift-1']);
});

test('a register closed between lookup and lock is refused with 409', async () => {
    const connection = drawerConnection({ locked: false });
    await assert.rejects(
        () => recordDrawerOutflow(connection, { amount: 10 }),
        (err) => err.statusCode === 409 && err.responseBody.error === 'no_open_cash_register'
    );
    assert.equal(connection.calls.some(({ statement }) => statement.startsWith('INSERT')), false);
});

test('paying more cash than the drawer holds is refused with 409 and writes nothing', async () => {
    const connection = drawerConnection({ inflow: 50, opening: 25 });
    await assert.rejects(
        () => recordDrawerOutflow(connection, { amount: 75.01 }),
        (err) => err.statusCode === 409 && err.responseBody.error === 'insufficient_cash'
    );
    assert.equal(connection.calls.some(({ statement }) => statement.startsWith('INSERT') || statement.startsWith('UPDATE')), false);
});

test('a cash payment inserts an expense in the open shift and lowers its expected balance', async () => {
    const connection = drawerConnection({ inflow: 80, opening: 20 });
    const result = await recordDrawerOutflow(connection, { amount: 60, referenceId: 'pay-1' });
    const insert = connection.calls.find(({ statement }) => statement.startsWith('INSERT INTO shift_payments'));
    // ADR-015: el tipo viaja parametrizado (default 'expense'); antes era literal en el SQL.
    assert.ok(insert.statement.includes("'cash'"));
    assert.deepEqual([insert.params[1], insert.params[2], insert.params[3]], ['shift-1', 60, 'expense']);
    const update = connection.calls.find(({ statement }) => statement.startsWith('UPDATE cash_shifts SET expected_balance'));
    assert.deepEqual(update.params, [40, 'shift-1']);
    assert.deepEqual(result, { shiftId: 'shift-1', expected_balance: 40, referenceId: 'pay-1' });
});

test('the whole drawer can be paid out, down to zero', async () => {
    const connection = drawerConnection({ inflow: 100 });
    const result = await recordDrawerOutflow(connection, { amount: 100 });
    assert.equal(result.expected_balance, 0);
});

// ---- ARCA: recovering a lost credit note response ----

test('a lost credit note is recovered only if ARCA lists the same associated invoice', () => {
    const associated = { point_of_sale: 3, invoice_number: 10 };
    assert.equal(associatedVoucherMatches({ CbtesAsoc: { CbteAsoc: [{ Tipo: 1, PtoVta: 3, Nro: 10 }] } }, associated), true);
    assert.equal(associatedVoucherMatches({ CbtesAsoc: { CbteAsoc: { Tipo: 1, PtoVta: 3, Nro: 10 } } }, associated), true);
    // Another note of the same amount to the same customer, for another invoice: not ours.
    assert.equal(associatedVoucherMatches({ CbtesAsoc: { CbteAsoc: [{ Tipo: 1, PtoVta: 3, Nro: 11 }] } }, associated), false);
    // Unknown shape: do not adopt someone else's CAE.
    assert.equal(associatedVoucherMatches({}, associated), false);
    assert.equal(associatedVoucherMatches(null, associated), false);
});

// ---- ARCA dates ----

test('formatAfipDate formats local dates as YYYYMMDD', () => {
    assert.equal(formatAfipDate(new Date(2026, 7, 5, 10, 0)), '20260805');
    assert.equal(formatAfipDate(new Date(2026, 0, 2, 23, 30)), '20260102');
    assert.equal(formatAfipDate(new Date(2026, 11, 31, 0, 5)), '20261231');
});

test('formatAfipDate keeps a date-only string as the same calendar day (no UTC shift)', () => {
    assert.equal(formatAfipDate('2026-08-05'), '20260805');
    assert.equal(formatAfipDate('2026-01-01 00:00:00'), '20260101');
});
