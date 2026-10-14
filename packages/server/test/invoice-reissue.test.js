import test from 'node:test';
import assert from 'node:assert/strict';

import salesService, { annulmentCause } from '../services/sales.service.js';
import clientService from '../services/client.service.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';
import pool from '../config/db.js';

const OLD = Object.freeze({
    id: 'inv-old', order_id: 'ord-1', client_id: 'cli-cf', client_name: 'Ana', customer_name: 'Ana',
    invoice_type: 'B', point_of_sale: 3, invoice_number: 41, status: 'issued', cae: null,
    net_amount: 1000, vat_amount: 210, exempt_amount: 0, total_amount: 1210, subtotal: 1000, tax_amount: 210,
    payment_method: 'cash', payment_status: 'partial', arca_last_error: '(10243) receptor', client_tax_condition: 'Consumidor Final', client_tax_id: '20-12345678-6',
});

const CLIENTS = {
    'cli-cf': { id: 'cli-cf', name: 'Ana', tax_id: '20-12345678-6', address: null, tax_condition_id: 'tc_ConsFinal' },
    'cli-ri': { id: 'cli-ri', name: 'Club SA', tax_id: '30-71234567-4', address: 'X', tax_condition_id: 'tc_RespInscripto' },
};

function setup(t, { old = OLD, creditNotes = [], paid = 500, pendingReturns = [], deletedClients = [], costLines = [], ageDays = 1, truncatedChain = false } = {}) {
    const calls = [];
    mockPool(t, async (sql, params = []) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [old ? [{ ...old }] : []];
        if (statement.includes('FROM credit_notes WHERE invoice_id')) return [creditNotes];
        if (statement.includes('tax_condition_id FROM clients')) return [CLIENTS[params[0]] ? [CLIENTS[params[0]]] : []];
        if (statement.includes('SUM(amount), 0) AS paid')) return [[{ paid }]];
        if (statement.includes('FROM client_returns')) return [pendingReturns];
        if (statement.includes('DATEDIFF')) return [[{ days: ageDays, truncated: truncatedChain ? 1 : 0 }]];
        if (statement.includes('FROM credit_notes WHERE number LIKE')) return [[{ max_seq: null }]];
        if (statement.startsWith('SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL')) {
            return [CLIENTS[params[0]] && !deletedClients.includes(params[0]) ? [{ id: params[0] }] : []];
        }
        if (statement.includes("account_code = '5.1.01.01'")) return [costLines];
        return [{ affectedRows: 1 }];
    });
    const originals = {
        next: salesService._nextInvoiceNumber,
        byId: salesService.getInvoiceById,
        reverse: accountingService.reverseDocumentEntries,
        post: accountingService.postInvoiceAccountingEntries,
        entry: accountingService.createJournalEntry,
        audit: auditService.log,
    };
    const ledger = [];
    const audits = [];
    salesService._nextInvoiceNumber = async () => 42;
    salesService.getInvoiceById = async (id) => ({ id });
    accountingService.reverseDocumentEntries = async (connection, payload) => { ledger.push(['reverse', payload]); return []; };
    accountingService.postInvoiceAccountingEntries = async (connection, id, options) => { ledger.push(['post', id, options]); };
    accountingService.createJournalEntry = async (connection, entry) => { ledger.push(['entry', entry]); return 'je-new'; };
    auditService.log = async (payload) => { audits.push(payload); };
    let restored = false;
    const restore = () => {
        if (restored) return;
        restored = true;
        salesService._nextInvoiceNumber = originals.next;
        salesService.getInvoiceById = originals.byId;
        accountingService.reverseDocumentEntries = originals.reverse;
        accountingService.postInvoiceAccountingEntries = originals.post;
        accountingService.createJournalEntry = originals.entry;
        auditService.log = originals.audit;
    };
    t.after(restore);
    return { calls, ledger, audits, restore };
}

test('reissueInvoice moves sale, collections, balance and order to the new invoice and annuls the old one', async (t) => {
    const { calls, ledger, audits } = setup(t);
    const result = await salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, 'u-1');
    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO invoices'));
    const newId = insert.params[0];
    assert.deepEqual(result, { id: newId });
    assert.deepEqual(
        [insert.params[2], insert.params[6], insert.params[7], insert.params[8], insert.params[9], insert.params.at(-1)],
        ['cli-ri', 'Responsable Inscripto', 'A', 3, 42, 'inv-old']
    );
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('INSERT INTO invoice_items') && params[0] === newId && params[1] === 'inv-old'));
    assert.deepEqual(ledger[0][1].accountCodes, ['4.1.01.01', '5.1.01.01']);
    assert.match(ledger[0][1].description, /factura B-0003-00000041 no autorizada por ARCA \(reemplazada por A-0003-00000042\)/);
    assert.deepEqual(ledger[1], ['post', newId, { includeCost: true }], 'no cost entry to copy: posted as usual');
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE transactions SET reference_id') && params[0] === newId && params[1] === 'cli-ri'));
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE customer_check_allocations') && params[0] === newId));
    // 1210 − 500 collected = 710 move from the old customer to the new one.
    const balances = calls.filter(({ sql }) => sql.startsWith('UPDATE clients SET current_account_balance'));
    assert.deepEqual(balances.map(({ sql, params }) => [sql.includes('- ?') ? '-' : '+', ...params]), [['-', 710, 'cli-cf'], ['+', 710, 'cli-ri']]);
    const order = calls.find(({ sql }) => sql.startsWith('UPDATE orders SET invoice_id'));
    assert.deepEqual(order.params, [newId, 'cli-ri', 'ord-1', 'inv-old']);
    const annul = calls.find(({ sql }) => sql.startsWith("UPDATE invoices SET status = 'cancelled', deleted_at = NOW(), order_id = NULL, annulled_label = ?"));
    assert.deepEqual(annul.params, ['B-0003-00000041', 'inv-old']);
    assert.ok(calls.indexOf(annul) < calls.indexOf(insert), 'annulled before the new one takes the order');
    // ADR-024: the internal credit note, never fiscal, named in the counter-entries.
    const note = calls.find(({ sql }) => sql.startsWith('INSERT INTO credit_notes'));
    assert.match(note.sql, /'INT', \?, \?, \?, \?, \?, 'internal'/);
    assert.match(note.params[1], /^NCI-\d{4}-0001$/);
    assert.deepEqual(
        [note.params[2], note.params[3], note.params[5], note.params[6], note.params[7], note.params[8]],
        ['cli-cf', 3, 'arca_error_annulment', 'inv-old', 'inv-old', 1210]
    );
    assert.match(note.params[9], /anula la factura B-0003-00000041, que ARCA no autorizó \(error de ARCA en la factura\)\. Motivo registrado: \(10243\) receptor\./);
    assert.match(note.params[9], /Reemplazada por A-0003-00000042\. No se informa a ARCA ni tiene CAE\./);
    assert.match(ledger[0][1].description, new RegExp(`Nota de crédito interna ${note.params[1]}`));
    assert.equal(audits[0].new_values.internal_credit_note, note.params[1]);
    assert.equal(audits[0].action, 'REISSUE_INVOICE');
    assert.equal(audits[0].old_values.arca_last_error, '(10243) receptor');
});

test('AUD-011: the internal note says truthfully why the invoice is annulled', () => {
    const rejected = annulmentCause({ invoice_type: 'B', arca_last_error: '(10243) receptor' }, 'B-0001-00000009');
    assert.equal(rejected.referenceType, 'arca_error_annulment');
    assert.match(rejected.text, /que ARCA no autorizó \(error de ARCA en la factura\)\. Motivo registrado: \(10243\) receptor\./);
    const ticket = annulmentCause({ invoice_type: 'tk' }, 'TK-0001-00000003');
    assert.deepEqual([ticket.referenceType, ticket.ledger], ['ticket_annulment', 'el ticket TK-0001-00000003']);
    assert.match(ticket.text, /comprobante no fiscal, no se informa a ARCA/);
    const neverSent = annulmentCause({ invoice_type: 'A' }, 'A-0001-00000004');
    assert.equal(neverSent.referenceType, 'unauthorized_annulment');
    assert.match(neverSent.text, /no llegó a autorizarse en ARCA \(se anuló antes de enviarla\)/);
    assert.doesNotMatch(neverSent.text, /error de ARCA/, 'ARCA did not intervene: it is not blamed');
});

test('reissueInvoice with the same customer only changes the letter: no balance moves', async (t) => {
    const { calls } = setup(t, { old: { ...OLD, client_id: 'cli-ri', invoice_type: 'B', order_id: null } });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'A' }, null);
    assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE clients SET current_account_balance')), false);
    assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE orders')), false);
});

test('reissueInvoice to an anonymous buyer only when nothing is owed; the order follows (AUD-010)', async (t) => {
    const { calls } = setup(t, { paid: 1210 });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'B', client_id: null }, null);
    assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE clients SET current_account_balance')), false);
    const order = calls.find(({ sql }) => sql.startsWith('UPDATE orders SET invoice_id'));
    assert.equal(order.params[1], null, 'the order leaves the old customer too');
});

test('ADR-022: an electronic invoice can become a ticket, and an administrator can reissue past the window', async (t) => {
    const { calls, audits } = setup(t, { ageDays: 12, paid: 1210 });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'TK' }, null, { allowLate: true });
    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO invoices'));
    assert.equal(insert.params[7], 'TK');
    assert.deepEqual([audits[0].old_values.age_days, audits[0].old_values.late_by_administrator], [12, true]);
});

test('reissueInvoice copies the cost entry instead of recalculating it (AUD-010)', async (t) => {
    const costLines = [
        { account_code: '5.1.01.01', debit: '412.37', credit: '0', notes: 'Costo de ventas (CMV)' },
        { account_code: '1.1.04.01', debit: '0', credit: '412.37', notes: 'Salida de inventario' },
    ];
    const { ledger } = setup(t, { costLines, old: { ...OLD, client_id: 'cli-ri' } });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'A' }, null);
    const post = ledger.find(([kind]) => kind === 'post');
    assert.deepEqual(post[2], { includeCost: false });
    const [, entry] = ledger.find(([kind]) => kind === 'entry');
    assert.equal(entry.reference_id, post[1]);
    assert.match(entry.description, /Costo de Mercadería Vendida - Factura A-0003-00000042/);
    assert.deepEqual(entry.lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [['5.1.01.01', 412.37, 0], ['1.1.04.01', 0, 412.37]]);
});

test('reissueInvoice to the same customer and letter refreshes the data loaded later', async (t) => {
    const { calls } = setup(t, { old: { ...OLD, client_tax_id: null, client_tax_condition: 'Consumidor Final', client_id: 'cli-cf' } });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'B' }, null);
    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO invoices'));
    assert.equal(insert.params[4], '20-12345678-6');
});

test('reissueInvoice refuses what cannot be annulled and rolls back', async (t) => {
    const realQuery = pool.query;
    const realGetConnection = pool.getConnection;
    const reject = async (old, payload, check, extra = {}) => {
        // Each case restores its mocks before the next one (mockPool restores on its own).
        const sub = { after: (fn) => t.after(fn) };
        const { calls, restore } = setup(sub, { old, ...extra });
        try {
            await assert.rejects(() => salesService.reissueInvoice('inv-old', payload, null), check);
            assert.equal(calls.some(({ sql }) => sql.startsWith('INSERT INTO invoices')), false);
        } finally {
            restore();
        }
    };
    await reject(null, { invoice_type: 'A' }, (error) => error.statusCode === 404);
    await reject({ ...OLD, cae: '123', status: 'authorized' }, { invoice_type: 'A' }, /nota de crédito/);
    await reject({ ...OLD, status: 'authorizing' }, { invoice_type: 'A' }, /verificación/);
    // AUD-011: a pending ARCA number means it is not settled yet, whatever the status says.
    await reject({ ...OLD, arca_expected_number: 42 }, { invoice_type: 'A' }, (error) => error.errorCode === 'invoice_not_reissuable');
    await reject(OLD, { invoice_type: 'TK' }, (error) => error.errorCode === 'invoice_has_credit_notes', { creditNotes: [{ id: 'cn-1' }] });
    await reject(OLD, { client_id: 'cli-missing' }, (error) => error.errorCode === 'client_not_found');
    await reject(OLD, {}, (error) => error.errorCode === 'nothing_to_change');
    await reject(OLD, { invoice_type: 'A' }, (error) => error.errorCode === 'invoice_type_mismatch');
    // AUD-010: the VAT treatment is kept, a debt is never left without a debtor, a return in
    // progress blocks it, and a deleted customer cannot receive it.
    await reject(OLD, { invoice_type: 'C' }, (error) => error.errorCode === 'reissue_letter_not_allowed' && error.message.includes('como factura A o factura B o ticket'));
    // ADR-022: past 5 days only an administrator.
    await reject(OLD, { invoice_type: 'A', client_id: 'cli-ri' }, (error) => error.statusCode === 409 && error.errorCode === 'reissue_too_old' && error.message.includes('12 días'), { ageDays: 12 });
    // Security review: a chain longer than the limit never restarts the window (fails closed).
    await reject(OLD, { invoice_type: 'A', client_id: 'cli-ri' }, (error) => error.errorCode === 'reissue_too_old' && error.message.includes('demasiadas veces'), { ageDays: 0, truncatedChain: true });
    await reject({ ...OLD, invoice_type: 'C' }, { invoice_type: 'B' }, (error) => error.errorCode === 'reissue_letter_not_allowed');
    await reject(OLD, { invoice_type: 'B', client_id: null }, (error) => error.statusCode === 409 && error.errorCode === 'outstanding_requires_client');
    await reject(OLD, { invoice_type: 'A', client_id: 'cli-ri' }, (error) => error.errorCode === 'invoice_has_pending_returns', { pendingReturns: [{ id: 'r-1' }] });
    await reject(OLD, { invoice_type: 'A', client_id: 'cli-ri' }, (error) => error.errorCode === 'client_not_found', { deletedClients: ['cli-ri'] });
    // Registered last, so it runs after the per-case restores: the real pool comes back.
    t.after(() => { pool.query = realQuery; pool.getConnection = realGetConnection; });
});

test('setTaxCondition locks the customer, checks the CUIT and the duplicates, and audits', async (t) => {
    let existing = { id: 'c-1', tax_id: '28999000', tax_condition_id: null };
    let duplicate = false;
    const calls = [];
    mockPool(t, async (sql, params = []) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [existing ? [existing] : []];
        if (statement.startsWith('SELECT id FROM clients WHERE tax_id = ?')) return [duplicate ? [{ id: 'other' }] : []];
        if (statement.includes('computed_balance')) return [[{ id: 'c-1', tax_condition_id: params.length ? 'x' : null, computed_balance: '15.50' }]];
        return [{ affectedRows: 1 }];
    });
    const originalLog = auditService.log;
    const audits = [];
    auditService.log = async (payload) => { audits.push(payload); };
    t.after(() => { auditService.log = originalLog; });

    await assert.rejects(() => clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_RespInscripto' } }), (error) => error.errorCode === 'cuit_required');
    const updated = await clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_Monotributo' }, actorId: 'u' });
    assert.equal(updated.current_account_balance, 15.5);
    assert.deepEqual(calls.find(({ sql }) => sql.startsWith('UPDATE clients SET tax_condition_id')).params, ['tc_Monotributo', '28999000', 'c-1']);
    assert.deepEqual(audits[0].new_values, { tax_condition_id: 'tc_Monotributo', tax_id: '28999000' });

    duplicate = true;
    await assert.rejects(
        () => clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_RespInscripto', tax_id: '30712345674' } }),
        (error) => error.statusCode === 409
    );
    existing = null;
    await assert.rejects(() => clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_ConsFinal' } }), (error) => error.statusCode === 404);
});

test('reverseDocumentEntries writes counter-entries for the entries that touch the accounts, once', async (t) => {
    const calls = [];
    const connection = {
        query: async (sql, params = []) => {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: statement, params });
            if (statement.startsWith('SELECT DISTINCT je.id')) return [[{ id: 'je-1', entry_number: 7, description: 'Asiento de Venta' }]];
            if (statement.startsWith('SELECT * FROM journal_entry_lines')) {
                return [[{ account_code: '1.1.03.01', debit: 121, credit: 0 }, { account_code: '4.1.01.01', debit: 0, credit: 121 }]];
            }
            return [{ affectedRows: 1 }];
        },
    };
    const original = accountingService.createJournalEntry;
    const entries = [];
    accountingService.createJournalEntry = async (conn, entry) => { entries.push(entry); return 'rev-1'; };
    t.after(() => { accountingService.createJournalEntry = original; });

    const result = await accountingService.reverseDocumentEntries(connection, {
        referenceType: 'invoice', referenceId: 'inv-1', accountCodes: ['4.1.01.01'], description: 'Anulación',
    });
    assert.deepEqual(result, ['rev-1']);
    assert.match(calls[0].sql, /NOT EXISTS \(SELECT 1 FROM journal_entries r WHERE r.reversal_of_entry_id = je.id\)/);
    assert.deepEqual(entries[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [['1.1.03.01', 0, 121], ['4.1.01.01', 121, 0]]);
    assert.deepEqual([entries[0].reference_type, entries[0].reversal_of_entry_id], ['reversal', 'je-1']);
    assert.equal(entries[0].description, 'Anulación: Asiento de Venta');
});
