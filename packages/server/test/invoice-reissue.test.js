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

function setup(t, { old = OLD, creditNotes = [], paid = 500, pendingReturns = [], deletedClients = [], costLines = [], ageDays = 1, truncatedChain = false, checks = [], otherAllocations = {}, failures = [] } = {}) {
    const calls = [];
    const pendingFailures = [...failures];
    mockPool(t, async (sql, params = []) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ sql: statement, params });
        // A write conflict thrown by the first statement of an attempt (AUD-010 retries).
        if (statement.startsWith('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE') && pendingFailures.length > 0) {
            throw pendingFailures.shift();
        }
        if (statement.startsWith('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [old ? [{ ...old }] : []];
        if (statement.startsWith('SELECT DISTINCT check_id FROM customer_check_allocations')) return [checks.map(({ id }) => ({ check_id: id }))];
        if (statement.startsWith('SELECT id, client_id, status FROM customer_checks')) return [checks];
        if (statement.startsWith('SELECT COUNT(*) AS count FROM customer_check_allocations')) return [[{ count: otherAllocations[params[0]] || 0 }]];
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
        if (statement.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
        if (statement.startsWith('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL FOR UPDATE')) return [existing ? [existing] : []];
        if (statement.startsWith('SELECT id FROM clients WHERE REPLACE(')) return [duplicate ? [{ id: 'other' }] : []];
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
    // The CUIT loaded here is serialized by its key and compared without dashes.
    const lock = calls.find(({ sql }) => sql.startsWith('SELECT GET_LOCK'));
    assert.equal(lock.params[0], 'client_tax_id:30712345674');
    assert.deepEqual(calls.find(({ sql }) => sql.startsWith('SELECT id FROM clients WHERE REPLACE(')).params, ['30712345674', 'c-1']);
    // The same CUIT typed with dashes is not a change: no duplicate check.
    duplicate = true;
    existing = { id: 'c-1', tax_id: '30712345674', tax_condition_id: null };
    calls.length = 0;
    await clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_RespInscripto', tax_id: '30-71234567-4' } });
    assert.equal(calls.some(({ sql }) => sql.startsWith('SELECT id FROM clients WHERE REPLACE(')), false);
    existing = null;
    await assert.rejects(() => clientService.setTaxCondition({ id: 'c-1', body: { tax_condition_id: 'tc_ConsFinal' } }), (error) => error.statusCode === 404);
});

test('AUD-010: the cheques follow the new customer unless they also paid other invoices, and their history says so', async (t) => {
    const { calls, audits } = setup(t, {
        checks: [{ id: 'chk-only', client_id: 'cli-cf', status: 'received' }, { id: 'chk-shared', client_id: 'cli-cf', status: 'deposited' }],
        otherAllocations: { 'chk-shared': 1 },
    });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, 'u-1');
    const newId = calls.find(({ sql }) => sql.startsWith('INSERT INTO invoices')).params[0];
    // AUD-013: the cheques are locked by the old invoice before its allocations and collections
    // move (a collection locks the cheque first too), and the other allocations are a locking read.
    const allocated = calls.find(({ sql }) => sql.startsWith('SELECT DISTINCT check_id FROM customer_check_allocations'));
    assert.deepEqual(allocated.params, ['inv-old']);
    const lockChecks = calls.find(({ sql }) => sql.startsWith('SELECT id, client_id, status FROM customer_checks'));
    assert.match(lockChecks.sql, /ORDER BY id FOR UPDATE$/);
    assert.deepEqual(lockChecks.params, [['chk-only', 'chk-shared']]);
    assert.ok(calls.indexOf(lockChecks) < calls.findIndex(({ sql }) => sql.startsWith('UPDATE customer_check_allocations')));
    assert.ok(calls.indexOf(lockChecks) < calls.findIndex(({ sql }) => sql.startsWith('UPDATE transactions SET reference_id')));
    const counts = calls.filter(({ sql }) => sql.startsWith('SELECT COUNT(*) AS count FROM customer_check_allocations'));
    assert.ok(counts.every(({ sql, params }) => sql.endsWith('FOR SHARE') && params[1] === newId));
    const moved = calls.filter(({ sql }) => sql.startsWith('UPDATE customer_checks SET client_id'));
    assert.deepEqual(moved.map(({ params }) => params), [['cli-ri', 'chk-only']], 'only the cheque that paid nothing else moves');
    const events = calls.filter(({ sql }) => sql.startsWith('INSERT INTO customer_check_events'));
    assert.deepEqual(events.map(({ params }) => [params[1], params[2], params[4]]), [['chk-only', 'received', 'u-1'], ['chk-shared', 'deposited', 'u-1']]);
    assert.match(events[0].params[3], /B-0003-00000041 anulada y emitida de nuevo como A-0003-00000042 a nombre de Club SA\. El cheque pasa a ese cliente/);
    assert.match(events[1].params[3], /también pagó otras facturas: sigue a nombre del cliente anterior/);
    assert.deepEqual(audits[0].new_values.checks, [
        { check_id: 'chk-only', previous_client_id: 'cli-cf', moved: true },
        { check_id: 'chk-shared', previous_client_id: 'cli-cf', moved: false },
    ]);
});

test('AUD-010: with the same customer the cheques are not touched', async (t) => {
    const { calls } = setup(t, { old: { ...OLD, client_id: 'cli-ri', order_id: null }, checks: [{ id: 'chk', client_id: 'cli-ri', status: 'received' }] });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'A' }, null);
    assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE customer_checks') || sql.startsWith('INSERT INTO customer_check_events')), false);
});

test('AUD-013: reissued to an anonymous buyer, the cheque keeps who handed it over', async (t) => {
    const { calls, audits } = setup(t, { paid: 1210, checks: [{ id: 'chk', client_id: 'cli-cf', status: 'received' }] });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'B', client_id: null }, null);
    assert.equal(calls.some(({ sql }) => sql.startsWith('UPDATE customer_checks')), false);
    const event = calls.find(({ sql }) => sql.startsWith('INSERT INTO customer_check_events'));
    assert.match(event.params[3], /Sin cliente registrado: el cheque sigue a nombre de quien lo entregó/);
    assert.deepEqual(audits[0].new_values.checks, [{ check_id: 'chk', previous_client_id: 'cli-cf', moved: false }]);
});

test('AUD-010: a reissue that deadlocks is retried from the start; one that keeps colliding answers 409', async (t) => {
    const deadlock = () => Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
    const doubleReversal = () => Object.assign(new Error("Duplicate entry 'je-1' for key 'journal_entries.uq_journal_entry_single_reversal'"), { code: 'ER_DUP_ENTRY' });
    const sub = (fn) => ({ after: fn });
    const realQuery = pool.query;
    const realGetConnection = pool.getConnection;
    t.after(() => { pool.query = realQuery; pool.getConnection = realGetConnection; });

    let scenario = setup(sub(() => {}), { failures: [deadlock(), doubleReversal()], paid: 1210 });
    await salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, null);
    assert.equal(scenario.calls.filter(({ sql }) => sql.startsWith('INSERT INTO invoices')).length, 1, 'the third attempt completes once');
    scenario.restore();

    scenario = setup(sub(() => {}), { failures: [deadlock(), deadlock(), deadlock()] });
    await assert.rejects(
        () => salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, null),
        (error) => error.statusCode === 409 && error.errorCode === 'busy' && /Reintentá/.test(error.message)
    );
    scenario.restore();

    // A lock wait timeout already waited 50 s: answered at once, not waited for again.
    scenario = setup(sub(() => {}), { failures: [Object.assign(new Error('Lock wait timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT' })] });
    await assert.rejects(() => salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, null), (error) => error.errorCode === 'busy');
    assert.equal(scenario.calls.filter(({ sql }) => sql.startsWith('SELECT * FROM invoices WHERE id = ?')).length, 1);
    scenario.restore();

    // Any other duplicate is a real error: never retried nor disguised.
    scenario = setup(sub(() => {}), { failures: [Object.assign(new Error("Duplicate entry for key 'uq_invoice_number'"), { code: 'ER_DUP_ENTRY' })] });
    await assert.rejects(() => salesService.reissueInvoice('inv-old', { invoice_type: 'A', client_id: 'cli-ri' }, null), (error) => error.code === 'ER_DUP_ENTRY');
    scenario.restore();
});

test('reverseDocumentEntries writes counter-entries for the entries that touch the accounts, once', async (t) => {
    const calls = [];
    const connection = {
        query: async (sql, params = []) => {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: statement, params });
            if (statement.startsWith('SELECT je.id, je.entry_number')) return [[{ id: 'je-1', entry_number: 7, description: 'Asiento de Venta' }]];
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
    // AUD-013: locking reads, serialized with a manual reversal of the same entry.
    assert.match(calls[0].sql, /NOT EXISTS \(SELECT 1 FROM journal_entries r WHERE r.reversal_of_entry_id = je.id FOR SHARE\)/);
    assert.match(calls[0].sql, /FOR UPDATE$/);
    assert.deepEqual(entries[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [['1.1.03.01', 0, 121], ['4.1.01.01', 121, 0]]);
    assert.deepEqual([entries[0].reference_type, entries[0].reversal_of_entry_id], ['reversal', 'je-1']);
    assert.equal(entries[0].description, 'Anulación: Asiento de Venta');
});
