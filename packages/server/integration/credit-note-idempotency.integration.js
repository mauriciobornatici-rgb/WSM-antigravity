import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool } from './helpers/qaDb.js';
import { creditNotesService } from '../services/warranties.service.js';

test.after(async () => {
    await closePool();
});

async function seedClient() {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO clients (id, name) VALUES (?, ?)', [id, `Cliente QA ${id.slice(0, 8)}`]);
    return id;
}

async function notesWithKey(key) {
    const [rows] = await pool.query('SELECT id, number FROM credit_notes WHERE idempotency_key = ?', [key]);
    return rows;
}

test('a retry with the same key returns the credit note already issued (ADR-012)', async () => {
    const clientId = await seedClient();
    const key = crypto.randomUUID();
    const body = { idempotency_key: key, client_id: clientId, amount: 150, reason: 'Bonificación', reference_type: 'manual' };

    const first = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    const retry = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');

    assert.equal(retry.idempotent_replay, true);
    assert.equal(retry.id, first.id);
    assert.equal(retry.number, first.number);
    assert.equal(retry.amount, 150);
    assert.equal((await notesWithKey(key)).length, 1);
});

test('two simultaneous submissions with the same key issue exactly one note', async () => {
    const clientId = await seedClient();
    const key = crypto.randomUUID();
    const body = { idempotency_key: key, client_id: clientId, amount: 80, reference_type: 'manual' };

    const results = await Promise.all([
        creditNotesService.createManualCreditNote(body, null, '127.0.0.1'),
        creditNotesService.createManualCreditNote(body, null, '127.0.0.1'),
    ]);

    assert.equal(results[0].id, results[1].id);
    assert.equal((await notesWithKey(key)).length, 1);
});

test('reusing a key for a different note is refused instead of replaying the first one', async () => {
    const clientA = await seedClient();
    const clientB = await seedClient();
    const key = crypto.randomUUID();
    const first = await creditNotesService.createManualCreditNote(
        { idempotency_key: key, client_id: clientA, amount: 100, reference_type: 'manual' }, null, '127.0.0.1'
    );

    for (const changed of [{ client_id: clientB, amount: 100 }, { client_id: clientA, amount: 200 }]) {
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
    const clientId = await seedClient();
    const body = { client_id: clientId, amount: 10, reference_type: 'manual' };
    const a = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    const b = await creditNotesService.createManualCreditNote(body, null, '127.0.0.1');
    assert.notEqual(a.number, b.number);
});
