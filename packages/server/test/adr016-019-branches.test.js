import test from 'node:test';
import assert from 'node:assert/strict';

import vatRatesService from '../services/vatRates.service.js';
import treasuryService from '../services/treasury.service.js';
import auditService from '../services/audit.service.js';
import { claimIdempotentRequest } from '../utils/idempotency.js';
import { returnsService } from '../services/warranties.service.js';
import { mockPool } from './helpers/mockDb.js';

function silenceAudit(t) {
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });
}

test('vat rates: list active or all, and every refusal of a save', async (t) => {
    const calls = [];
    let mode = 'ok';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        calls.push(statement);
        if (statement.startsWith('SELECT id, name, rate, is_default, active FROM vat_rates')) {
            if (statement.includes('WHERE id = ?')) return [[{ id: 3, name: 'IVA 10,5%', rate: '10.50', is_default: 0, active: 1 }]];
            return [[{ id: 1, name: 'IVA 21%', rate: '21.00', is_default: 1, active: 1 }]];
        }
        if (statement.startsWith('SELECT * FROM vat_rates WHERE id = ? FOR UPDATE')) return [mode === 'missing' ? [] : [{ id: 3, is_default: 0 }]];
        if (statement.startsWith('INSERT INTO vat_rates') && mode === 'dup') throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        if (statement.startsWith('UPDATE vat_rates SET name') && mode === 'dup') throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        if (statement.startsWith('UPDATE vat_rates SET name') && mode === 'boom') throw new Error('boom');
        return [{ insertId: 3, affectedRows: 1 }];
    });
    silenceAudit(t);

    assert.deepEqual(await vatRatesService.list(), [{ id: 1, name: 'IVA 21%', rate: 21, is_default: true, active: true }]);
    await vatRatesService.list({ includeInactive: true });
    assert.ok(calls.some((sql) => sql.includes('vat_rates') && !sql.includes('WHERE active = 1')));

    assert.deepEqual(await vatRatesService.save({ name: 'IVA 10,5%', rate: 10.5, active: true }, 3), { id: 3, name: 'IVA 10,5%', rate: 10.5, is_default: false, active: true });
    mode = 'missing';
    await assert.rejects(() => vatRatesService.save({ name: 'X', rate: 21 }, 99), (err) => err.statusCode === 404);
    mode = 'dup';
    await assert.rejects(() => vatRatesService.save({ name: 'X', rate: 21 }), (err) => err.responseBody?.error === 'duplicate_vat_rate');
    await assert.rejects(() => vatRatesService.save({ name: 'X', rate: 21 }, 3), (err) => err.responseBody?.error === 'duplicate_vat_rate');
    mode = 'boom';
    await assert.rejects(() => vatRatesService.save({ name: 'X', rate: 21 }, 3), /boom/);
    mode = 'ok';
    await assert.rejects(
        () => vatRatesService.save({ name: 'X', rate: 21, is_default: true, active: false }),
        (err) => err.responseBody?.error === 'default_rate_inactive'
    );
});

test('idempotency: invalid keys are refused and stored responses replay as objects or JSON', async () => {
    const connection = { query: async () => [[]] };
    await assert.rejects(() => claimIdempotentRequest(connection, 's', 123, {}), (err) => err.statusCode === 400);
    await assert.rejects(() => claimIdempotentRequest(connection, 's', 'x'.repeat(65), {}), (err) => err.statusCode === 400);

    const { hashRequest } = await import('../utils/idempotency.js');
    const stored = { request_hash: hashRequest({ a: 1 }), response_json: { id: 'r' } };
    const duplicate = {
        async query(sql) {
            if (String(sql).startsWith('INSERT')) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
            return [[stored]];
        }
    };
    assert.deepEqual(await claimIdempotentRequest(duplicate, 's', 'k', { a: 1 }), { replay: { id: 'r', idempotent_replay: true } });
    stored.response_json = null;
    assert.deepEqual(await claimIdempotentRequest(duplicate, 's', 'k', { a: 1 }), { replay: { idempotent_replay: true } });
});

test('bank charges: a retry with the same key replays and a failure rolls back', async (t) => {
    let duplicate = false;
    const lifecycle = [];
    const connection = mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('INSERT INTO idempotency_requests') && duplicate) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        if (statement.includes('FROM idempotency_requests')) {
            const { hashRequest } = await import('../utils/idempotency.js');
            return [[{ request_hash: hashRequest({ charges: [{ concept: 'nope', amount: 1 }] }), response_json: '{"id":"first","total":1}' }]];
        }
        return [[]];
    });
    connection.rollback = async () => { lifecycle.push('rollback'); };
    silenceAudit(t);
    await assert.rejects(
        () => treasuryService.createBankCharges({ idempotency_key: 'k1', charges: [{ concept: 'nope', amount: 1 }] }),
        (err) => err.statusCode === 400
    );
    assert.deepEqual(lifecycle, ['rollback']);
    duplicate = true;
    assert.deepEqual(
        await treasuryService.createBankCharges({ idempotency_key: 'k1', charges: [{ concept: 'nope', amount: 1 }] }),
        { id: 'first', total: 1, idempotent_replay: true }
    );
});

test('shipping refund: nothing without an order, from the order before invoicing, nothing left after a full refund', async () => {
    assert.equal(await returnsService._shippingRefund({ query: async () => [[]] }, { id: 'r', order_id: null }), null);
    const connectionFor = ({ invoiced, refunded }) => ({
        async query(sql) {
            const statement = String(sql);
            if (statement.startsWith('SELECT id FROM orders')) return [[{ id: 'o' }]];
            if (statement.startsWith('SELECT id FROM invoices')) return [invoiced ? [{ id: 'inv' }] : []];
            if (statement.includes('FROM invoice_items')) return [[{ vat_rate: 21, gross: 1210, vat: 210 }]];
            if (statement.includes('FROM order_adjustments')) return [[{ amount: 1210, vat_rate: 21 }, { amount: -121, vat_rate: 21 }]];
            if (statement.includes('shipping_refund_amount')) return [[{ gross: refunded, vat: refunded ? 210 : 0 }]];
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    });
    assert.deepEqual(await returnsService._shippingRefund(connectionFor({ invoiced: false, refunded: 0 }), { id: 'r', order_id: 'o' }),
        { gross: 1089, vat: 189, vat_rate: 21 });
    assert.equal(await returnsService._shippingRefund(connectionFor({ invoiced: true, refunded: 1210 }), { id: 'r', order_id: 'o' }), null);
});
