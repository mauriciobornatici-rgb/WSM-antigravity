import test from 'node:test';
import assert from 'node:assert/strict';

import { lockOpenShift, recordShiftSalePayments, calculateShiftExpectedBalance } from '../services/cashShift.service.js';

function recordingConnection(handlers) {
    const calls = [];
    return {
        calls,
        query: async (sql, params = []) => {
            const statement = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: statement, params });
            for (const [matcher, respond] of handlers) {
                const matches = typeof matcher === 'string' ? statement.startsWith(matcher) : matcher.test(statement);
                if (matches) return respond(params);
            }
            throw new Error(`Unexpected SQL in mock: ${statement}`);
        },
    };
}

test('lockOpenShift returns the shift when it is already open', async () => {
    const connection = recordingConnection([
        ['SELECT id, status, cash_register_id FROM cash_shifts', () => [[{ id: 'shift-1', status: 'open', cash_register_id: 'reg-1' }]]],
    ]);
    const result = await lockOpenShift(connection, 'shift-1');
    assert.deepEqual(result, { shiftId: 'shift-1', reassigned: false });
});

test('lockOpenShift rejects with 409 CASH_SHIFT_NOT_OPEN when closed and reassign is not allowed', async () => {
    const connection = recordingConnection([
        ['SELECT id, status, cash_register_id FROM cash_shifts', () => [[{ id: 'shift-1', status: 'closed', cash_register_id: 'reg-1' }]]],
    ]);
    await assert.rejects(
        () => lockOpenShift(connection, 'shift-1'),
        (err) => err.statusCode === 409 && err.errorCode === 'CASH_SHIFT_NOT_OPEN'
    );
});

test('lockOpenShift reassigns a closed offline sale to the register\'s currently open shift', async () => {
    const connection = recordingConnection([
        ['SELECT id, status, cash_register_id FROM cash_shifts', () => [[{ id: 'shift-closed', status: 'closed', cash_register_id: 'reg-1' }]]],
        ['SELECT id FROM cash_shifts WHERE cash_register_id', () => [[{ id: 'shift-open-now' }]]],
    ]);
    const result = await lockOpenShift(connection, 'shift-closed', { allowReassign: true });
    assert.deepEqual(result, { shiftId: 'shift-open-now', reassigned: true, originalShiftId: 'shift-closed' });
});

test('lockOpenShift rejects when reassign is allowed but the register has no open shift', async () => {
    const connection = recordingConnection([
        ['SELECT id, status, cash_register_id FROM cash_shifts', () => [[{ id: 'shift-closed', status: 'closed', cash_register_id: 'reg-1' }]]],
        ['SELECT id FROM cash_shifts WHERE cash_register_id', () => [[]]],
    ]);
    await assert.rejects(
        () => lockOpenShift(connection, 'shift-closed', { allowReassign: true }),
        (err) => err.statusCode === 409 && err.errorCode === 'CASH_SHIFT_NOT_OPEN'
    );
});

test('lockOpenShift rejects a missing shift id with 409 CASH_SHIFT_NOT_OPEN', async () => {
    const connection = recordingConnection([
        ['SELECT id, status, cash_register_id FROM cash_shifts', () => [[]]],
    ]);
    await assert.rejects(
        () => lockOpenShift(connection, 'missing-shift'),
        (err) => err.statusCode === 409 && err.errorCode === 'CASH_SHIFT_NOT_OPEN'
    );
    await assert.rejects(
        () => lockOpenShift(connection, 'missing-shift', { allowReassign: true }),
        (err) => err.statusCode === 409 && err.errorCode === 'CASH_SHIFT_NOT_OPEN'
    );
});

test('calculateShiftExpectedBalance sums cash inflow/outflow over the opening balance', async () => {
    const connection = recordingConnection([
        [/SUM\(CASE WHEN payment_method/, () => [[{ inflow: 500, outflow: 120 }]]],
        ['SELECT opening_balance FROM cash_shifts', () => [[{ opening_balance: 1000 }]]],
    ]);
    const summary = await calculateShiftExpectedBalance(connection, 'shift-1');
    assert.deepEqual(summary, { opening_balance: 1000, inflow: 500, outflow: 120, expected_balance: 1380 });
});

test('calculateShiftExpectedBalance defaults the opening balance to 0 for an unknown shift', async () => {
    const connection = recordingConnection([
        [/SUM\(CASE WHEN payment_method/, () => [[{ inflow: 0, outflow: 0 }]]],
        ['SELECT opening_balance FROM cash_shifts', () => [[]]],
    ]);
    const summary = await calculateShiftExpectedBalance(connection, 'shift-unknown');
    assert.equal(summary.opening_balance, 0);
    assert.equal(summary.expected_balance, 0);
});

test('recordShiftSalePayments consolidates split lines of the same method and rounds the amount', async () => {
    const state = { shiftPayments: [], updatedBalance: null };
    const connection = recordingConnection([
        [/FROM shift_payments WHERE order_id = \? AND type = 'sale'/, () => [state.shiftPayments]],
        ['INSERT INTO shift_payments', (params) => {
            state.shiftPayments.push({ id: params[0], shift_id: params[1], order_id: params[2], payment_method: params[3], amount: params[4] });
            return [{ affectedRows: 1 }];
        }],
        [/SUM\(CASE WHEN payment_method/, () => [[{ inflow: 150.005, outflow: 0 }]]],
        ['SELECT opening_balance FROM cash_shifts', () => [[{ opening_balance: 0 }]]],
        ['UPDATE cash_shifts SET expected_balance', (params) => { state.updatedBalance = params[0]; return [{ affectedRows: 1 }]; }],
    ]);

    const result = await recordShiftSalePayments(connection, {
        shiftId: 'shift-1',
        orderId: 'order-1',
        payments: [
            { method: 'cash', amount: 50.001 },
            { method: 'cash', amount: 50.001 },
            { method: 'bank', amount: 25 },
        ],
    });

    assert.equal(result.inserted.length, 2);
    const cashLine = result.inserted.find((p) => p.payment_method === 'cash');
    assert.equal(cashLine.amount, 100); // 50.001 + 50.001 rounded to cents
    const bankLine = result.inserted.find((p) => p.payment_method === 'bank');
    assert.equal(bankLine.amount, 25);
    assert.equal(result.expected_balance, 150.01); // rounded to cents
    assert.equal(state.updatedBalance, 150.01);
});

test('recordShiftSalePayments skips methods already recorded for that order (replay) and ignores non-positive amounts', async () => {
    const state = { shiftPayments: [{ id: 'existing', shift_id: 'shift-1', order_id: 'order-1', payment_method: 'cash', amount: 100 }] };
    const inserted = [];
    const connection = recordingConnection([
        [/FROM shift_payments WHERE order_id = \? AND type = 'sale'/, () => [state.shiftPayments]],
        ['INSERT INTO shift_payments', (params) => {
            inserted.push({ payment_method: params[3], amount: params[4] });
            return [{ affectedRows: 1 }];
        }],
        [/SUM\(CASE WHEN payment_method/, () => [[{ inflow: 100, outflow: 0 }]]],
        ['SELECT opening_balance FROM cash_shifts', () => [[{ opening_balance: 0 }]]],
        ['UPDATE cash_shifts SET expected_balance', () => [{ affectedRows: 1 }]],
    ]);

    const result = await recordShiftSalePayments(connection, {
        shiftId: 'shift-1',
        orderId: 'order-1',
        payments: [
            { method: 'cash', amount: 100 },      // already recorded: skipped
            { method: 'bank', amount: 0 },        // non-positive: ignored
            { method: 'card', amount: -5 },       // negative: ignored
            { method: null, amount: 50 },         // missing method: ignored
        ],
    });

    assert.deepEqual(inserted, []);
    assert.deepEqual(result.inserted, []);
});
