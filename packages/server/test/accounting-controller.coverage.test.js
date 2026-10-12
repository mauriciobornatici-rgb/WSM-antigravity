import test from 'node:test';
import assert from 'node:assert/strict';

import * as controller from '../controllers/accountingController.js';
import accountingService from '../services/accounting.service.js';

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    });
}

function stubService(t, method, impl) {
    const calls = [];
    const previous = accountingService[method];
    accountingService[method] = async (...args) => {
        calls.push(args);
        return impl(...args);
    };
    t.after(() => {
        accountingService[method] = previous;
    });
    return calls;
}

test('getChartOfAccounts responds with the service result', async (t) => {
    const calls = stubService(t, 'getChartOfAccounts', () => [{ code: '1.1' }]);
    const result = await runHandler(controller.getChartOfAccounts);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ code: '1.1' }]);
    assert.equal(calls.length, 1);
});

test('getJournalEntries forwards only the supported filters', async (t) => {
    const calls = stubService(t, 'getJournalEntries', () => []);
    const result = await runHandler(controller.getJournalEntries, {
        query: {
            start_date: '2026-01-01',
            end_date: '2026-01-31',
            reference_type: 'sale',
            reference_id: '7',
            injected: 'x'
        }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(calls[0], [{
        start_date: '2026-01-01',
        end_date: '2026-01-31',
        reference_type: 'sale',
        reference_id: '7'
    }]);
});

for (const name of ['getTrialBalance', 'getIncomeStatement', 'getBalanceSheet']) {
    test(`${name} forwards the date range only`, async (t) => {
        const calls = stubService(t, name, () => ({ ok: name }));
        const result = await runHandler(controller[name], {
            query: { start_date: '2026-02-01', end_date: '2026-02-28', other: 'ignored' }
        });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { ok: name });
        assert.deepEqual(calls[0], [{ start_date: '2026-02-01', end_date: '2026-02-28' }]);
    });
}

test('createManualEntry and createAccount answer 201 and pass the acting user', async (t) => {
    const entryCalls = stubService(t, 'createManualEntry', () => ({ id: 'e1' }));
    const accountCalls = stubService(t, 'createAccount', () => ({ code: '9.9' }));

    const entry = await runHandler(controller.createManualEntry, { body: { lines: [] }, user: { id: 'u1' } });
    assert.equal(entry.status, 201);
    assert.deepEqual(entry.body, { id: 'e1' });
    assert.deepEqual(entryCalls[0], [{ lines: [] }, 'u1']);

    const account = await runHandler(controller.createAccount, { body: { code: '9.9' } });
    assert.equal(account.status, 201);
    assert.deepEqual(accountCalls[0], [{ code: '9.9' }, undefined]);
});

test('updateAccount, deleteAccount and reverseJournalEntry use route params and the actor', async (t) => {
    const updateCalls = stubService(t, 'updateAccount', () => ({ updated: true }));
    const deleteCalls = stubService(t, 'deleteAccount', () => ({ deleted: true }));
    const reverseCalls = stubService(t, 'reverseJournalEntry', () => ({ reversed: true }));
    const user = { id: 'u2' };

    const updated = await runHandler(controller.updateAccount, { params: { code: '1.2' }, body: { name: 'N' }, user });
    assert.equal(updated.status, 200);
    assert.deepEqual(updateCalls[0], ['1.2', { name: 'N' }, 'u2']);

    const deleted = await runHandler(controller.deleteAccount, { params: { code: '1.2' }, user });
    assert.deepEqual(deleted.body, { deleted: true });
    assert.deepEqual(deleteCalls[0], ['1.2', 'u2']);

    const reversed = await runHandler(controller.reverseJournalEntry, { params: { id: '55' }, user });
    assert.deepEqual(reversed.body, { reversed: true });
    assert.deepEqual(reverseCalls[0], ['55', 'u2']);
});

test('service errors propagate to next() without a response', async (t) => {
    stubService(t, 'reverseJournalEntry', () => {
        throw new Error('already reversed');
    });
    await assert.rejects(
        runHandler(controller.reverseJournalEntry, { params: { id: '1' } }),
        /already reversed/
    );
});
