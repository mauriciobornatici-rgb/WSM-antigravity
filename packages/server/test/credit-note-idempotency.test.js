import test from 'node:test';
import assert from 'node:assert/strict';

import { creditNotesService } from '../services/warranties.service.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

const KEY = '0a252ca9-9af2-455d-89d7-87150716f8ae';
const issued = {
    id: 'cn-1', number: 'NC-2026-0007', client_id: 'c-1', customer_name: null,
    reference_type: 'other', reference_id: null, amount: '100.00', notes: null, status: 'issued',
};

const invoice = {
    id: 'inv-1', client_id: 'c-1', invoice_type: 'B', point_of_sale: 1, total_amount: '1000.00', vat_amount: '173.55',
};

function notesPool(t, { existing = [], insert } = {}) {
    const calls = [];
    const lifecycle = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT * FROM credit_notes WHERE idempotency_key')) return [existing];
        if (statement.startsWith('SELECT * FROM invoices WHERE id')) return [[invoice]];
        if (statement.includes('AS credited FROM credit_notes')) return [[{ credited: 0 }]];
        if (statement.startsWith('INSERT INTO credit_notes') && insert) return insert();
        if (statement.includes('max_seq')) return [[{ max_seq: 0 }]];
        if (statement.includes('document_sequences')) return [[{ last_value: 1 }]];
        return [{ affectedRows: 1, insertId: 0 }];
    });
    connection.commit = async () => { lifecycle.push('commit'); };
    connection.rollback = async () => { lifecycle.push('rollback'); };
    connection.release = () => { lifecycle.push('release'); };
    const originalLog = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalLog; });
    return { calls, lifecycle };
}

test('a retry with the same key and body replays the note without numbering another', async (t) => {
    const { calls, lifecycle } = notesPool(t, { existing: [issued] });

    const result = await creditNotesService.createManualCreditNote(
        { idempotency_key: KEY, client_id: 'c-1', amount: 100, reference_type: 'manual' }, 'u-1', '127.0.0.1'
    );

    assert.equal(result.idempotent_replay, true);
    assert.equal(result.number, 'NC-2026-0007');
    assert.equal(result.amount, 100);
    assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT')), false);
    assert.deepEqual(lifecycle, ['commit', 'release']);
});

test('the same key with a different client, amount or reference is refused with 409', async (t) => {
    const variants = [
        { client_id: 'c-2', amount: 100 },
        { client_id: 'c-1', amount: 100.01 },
        { client_id: 'c-1', amount: 100, reference_type: 'discount' },
        { client_id: 'c-1', amount: 100, reference_id: 'ret-1' },
        { client_id: 'c-1', amount: 100, invoice_id: 'inv-2' },
    ];
    for (const variant of variants) {
        const { calls, lifecycle } = notesPool(t, { existing: [issued] });
        await assert.rejects(
            () => creditNotesService.createManualCreditNote({ idempotency_key: KEY, reference_type: 'manual', ...variant }, 'u-1', null),
            (err) => err.statusCode === 409
                && err.responseBody.error === 'idempotency_key_reused'
                && err.responseBody.credit_note_number === 'NC-2026-0007',
            JSON.stringify(variant)
        );
        assert.equal(calls.some(({ statement }) => statement.startsWith('INSERT')), false);
        assert.deepEqual(lifecycle, ['rollback', 'release']);
    }
});

test('collisions are retried a bounded number of times, then surface', async (t) => {
    let inserts = 0;
    notesPool(t, {
        insert: () => {
            inserts += 1;
            throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' });
        },
    });

    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ idempotency_key: KEY, client_id: 'c-1', invoice_id: 'inv-1', amount: 5 }, null, null),
        (err) => err.code === 'ER_LOCK_DEADLOCK'
    );
    assert.equal(inserts, 3);
});

test('without a key a collision is not retried', async (t) => {
    let inserts = 0;
    notesPool(t, {
        insert: () => {
            inserts += 1;
            throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        },
    });

    await assert.rejects(
        () => creditNotesService.createManualCreditNote({ client_id: 'c-1', invoice_id: 'inv-1', amount: 5 }, null, null),
        (err) => err.code === 'ER_DUP_ENTRY'
    );
    assert.equal(inserts, 1);
});
