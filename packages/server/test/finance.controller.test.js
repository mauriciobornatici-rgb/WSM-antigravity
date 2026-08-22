import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateShiftExpectedBalance } from '../services/cashShift.service.js';

test('cash-shift expected balance only includes cash movements', async () => {
    const queries = [];
    const connection = {
        async query(sql) {
            const statement = String(sql);
            queries.push(statement);
            if (statement.includes('FROM shift_payments')) {
                return [[{ inflow: 350, outflow: 20 }]];
            }
            if (statement.includes('SELECT opening_balance')) {
                return [[{ opening_balance: 100 }]];
            }
            throw new Error(`Unexpected SQL: ${statement}`);
        }
    };

    const result = await calculateShiftExpectedBalance(connection, 'shift-1');

    assert.equal(result.expected_balance, 430);
    assert.match(queries[0], /payment_method = 'cash'/);
});

test('cash-shift expected balance defaults missing shift and aggregates to zero', async () => {
    const connection = {
        async query(sql) {
            if (String(sql).includes('FROM shift_payments')) return [[]];
            return [[]];
        }
    };
    assert.deepEqual(await calculateShiftExpectedBalance(connection, 'missing'), {
        opening_balance: 0, inflow: 0, outflow: 0, expected_balance: 0
    });
});
