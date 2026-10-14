import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedClientWithInvoice } from './helpers/qaDb.js';
import { creditNotesService } from '../services/warranties.service.js';

test.after(async () => {
    await closePool();
});

async function notesWithKey(key) {
    const [rows] = await pool.query('SELECT id, number FROM credit_notes WHERE idempotency_key = ?', [key]);
    return rows;
}

test('a retry with the same key returns the credit note already issued (ADR-012)', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice();
    const key = crypto.randomUUID();
    const body = { idempotency_key: key, client_id: clientId, invoice_id: invoiceId, amount: 150, reason: 'Bonificación', reference_type: 'manual' };

    const first = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    const retry = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');

    assert.equal(retry.idempotent_replay, true);
    assert.equal(retry.id, first.id);
    assert.equal(retry.number, first.number);
    assert.equal(retry.amount, 150);
    assert.equal((await notesWithKey(key)).length, 1);
});

test('two simultaneous submissions with the same key issue exactly one note', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice();
    const key = crypto.randomUUID();
    const body = { idempotency_key: key, client_id: clientId, invoice_id: invoiceId, amount: 80, reference_type: 'manual' };

    const results = await Promise.all([
        creditNotesService.createManualCreditNote(body, null, '127.0.0.1'),
        creditNotesService.createManualCreditNote(body, null, '127.0.0.1'),
    ]);

    assert.equal(results[0].id, results[1].id);
    assert.equal((await notesWithKey(key)).length, 1);
});

test('reusing a key for a different note is refused instead of replaying the first one', async () => {
    const a = await seedClientWithInvoice();
    const b = await seedClientWithInvoice();
    const key = crypto.randomUUID();
    const first = await creditNotesService.createManualCreditNote(
        { idempotency_key: key, client_id: a.clientId, invoice_id: a.invoiceId, amount: 100, reference_type: 'manual' }, null, '127.0.0.1'
    );

    for (const changed of [
        { client_id: b.clientId, invoice_id: b.invoiceId, amount: 100 },
        { client_id: a.clientId, invoice_id: a.invoiceId, amount: 200 },
    ]) {
        await assert.rejects(
            () => creditNotesService.createManualCreditNote(
                { idempotency_key: key, reference_type: 'manual', ...changed }, null, '127.0.0.1'
            ),
            (err) => err.statusCode === 409
                && err.responseBody.error === 'idempotency_key_reused'
                && err.responseBody.credit_note_number === first.number
        );
    }
    assert.equal((await notesWithKey(key)).length, 1);
});

test('notes without a key keep the previous behaviour (each submission issues a note)', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice();
    const body = { client_id: clientId, invoice_id: invoiceId, amount: 10, reference_type: 'manual' };
    const a = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    const b = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    assert.notEqual(a.number, b.number);
});

test('ADR-014: the notes on an invoice can never add up to more than the invoice, even concurrently', async () => {
    const { clientId, invoiceId } = await seedClientWithInvoice({ total: 1000, vat: 0 });
    const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () => creditNotesService.createManualCreditNote({ client_id: clientId, invoice_id: invoiceId, amount: 300 }, null, null))
    );
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 3);
    const rejected = attempts.filter((r) => r.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.responseBody.error, 'exceeds_invoice_balance');
    const [[sum]] = await pool.query('SELECT SUM(amount) AS s FROM credit_notes WHERE invoice_id = ?', [invoiceId]);
    assert.equal(Number(sum.s), 900);
});
