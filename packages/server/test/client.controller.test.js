import test from 'node:test';
import assert from 'node:assert/strict';

import { getClients, getClientById, createClient, updateClient, deleteClient } from '../controllers/clientController.js';
import auditService from '../services/audit.service.js';
import { mockPool } from './helpers/mockDb.js';

function runHandler(handler, req) {
    return new Promise((resolve, reject) => {
        let statusSet = 200;
        let jsonBody = null;

        const res = {
            status(code) { statusSet = code; return this; },
            json(data) {
                jsonBody = data;
                resolve({ status: statusSet, body: jsonBody });
                return this;
            },
            send(data) {
                jsonBody = data;
                resolve({ status: statusSet, body: jsonBody });
                return this;
            }
        };

        const next = (err) => {
            if (err) reject(err);
            else resolve({ status: statusSet, body: jsonBody });
        };

        handler(req, res, next);
    });
}

test('createClient throws 409 if tax_id already exists', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT id FROM clients WHERE tax_id = ?')) {
            return [[{ id: 'existing-client-id' }]];
        }
        return [[]];
    });

    const req = {
        body: { name: 'Cliente Duplicado', tax_id: '20-12345678-9' }
    };

    const res = await runHandler(createClient, req);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'duplicate_tax_id');
});

test('createClient successfully creates client if unique tax_id', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT id FROM clients WHERE tax_id = ?')) {
            return [[]];
        }
        if (sql.includes('SELECT * FROM clients WHERE id = ?')) {
            return [[{ id: 'new-id', name: 'Test client', tax_id: '1234' }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    let logged = false;
    auditService.log = async () => { logged = true; };
    t.after(() => { auditService.log = originalLog; });

    const req = {
        body: { name: 'Test client', tax_id: '1234', email: 'test@wsm.com', phone: '123', address: 'Calle 1', credit_limit: 1000 }
    };

    const res = await runHandler(createClient, req);

    assert.ok(res.body);
    assert.equal(res.body.id, 'new-id');
    assert.ok(logged);

    const inserts = queryCalls.filter(c => c.sql.includes('INSERT INTO clients'));
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params[1], 'Test client');
});

test('deleteClient throws 409 if client has outstanding balance', async (t) => {
    mockPool(t, async (sql) => {
        if (sql.includes('SELECT c.id, c.name')) {
            return [[{ id: 'client-1', computed_balance: 150.00 }]];
        }
        return [[]];
    });

    const req = { params: { id: 'client-1' } };

    const res = await runHandler(deleteClient, req);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'has_balance');
});

test('deleteClient soft deletes client successfully if balance is zero', async (t) => {
    const queryCalls = [];
    mockPool(t, async (sql, params) => {
        queryCalls.push({ sql, params });
        if (sql.includes('SELECT c.id, c.name')) {
            return [[{ id: 'client-1', computed_balance: 0.00 }]];
        }
        return [[]];
    });

    const originalLog = auditService.log;
    let logged = false;
    auditService.log = async () => { logged = true; };
    t.after(() => { auditService.log = originalLog; });

    const req = { params: { id: 'client-1' } };

    const res = await runHandler(deleteClient, req);

    assert.deepEqual(res.body, { success: true });
    assert.ok(logged);

    const updates = queryCalls.filter(c => c.sql.includes('UPDATE clients'));
    assert.equal(updates.length, 1);
});

test('getClients and getClientById normalize balances and return missing clients', async (t) => {
    let mode = 'list';
    mockPool(t, async () => {
        if (mode === 'list') return [[{ id: 'c1', computed_balance: '10.50' }, { id: 'c2', computed_balance: null }]];
        if (mode === 'detail') return [[{ id: 'c1', computed_balance: '2.25' }]];
        return [[]];
    });
    const list = await runHandler(getClients, {});
    assert.equal(list.body[0].current_account_balance, 10.5);
    assert.equal(list.body[1].current_account_balance, 0);
    mode = 'detail';
    const detail = await runHandler(getClientById, { params: { id: 'c1' } });
    assert.equal(detail.body.current_account_balance, 2.25);
    mode = 'missing';
    const missing = await runHandler(getClientById, { params: { id: 'x' } });
    assert.equal(missing.status, 404);
});

test('createClient defaults optional credit and audit identity safely', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id FROM clients WHERE tax_id')) return [[]];
        if (sql.includes('SELECT * FROM clients WHERE id')) return [[]];
        return [[]];
    });
    const original = auditService.log;
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = original; });
    const req = { body: { name: 'Ana', tax_id: '1' }, user: { id: 'u' }, ip: '127.0.0.1' };
    const result = await runHandler(createClient, req);
    assert.equal(result.body, undefined);
    const insert = calls.find((call) => call.sql.includes('INSERT INTO clients'));
    assert.equal(insert.params[6], 0);
    assert.equal(audit.user_id, 'u');
    assert.deepEqual(audit.new_values, req.body);
});

test('updateClient handles missing records, duplicate tax ids and successful fallbacks', async (t) => {
    let mode = 'missing';
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT * FROM clients WHERE id') && sql.includes('deleted_at')) {
            if (mode === 'missing') return [[]];
            if (mode === 'success-updated') return [[]];
            return [[{ id: 'c', name: 'Anterior' }]];
        }
        if (sql.includes('SELECT id FROM clients WHERE tax_id')) return mode === 'duplicate' ? [[{ id: 'other' }]] : [[]];
        return [[]];
    });
    const req = { params: { id: 'c' }, body: { name: 'Ana', tax_id: '1' }, ip: 'x' };
    assert.equal((await runHandler(updateClient, req)).status, 404);
    mode = 'duplicate';
    assert.equal((await runHandler(updateClient, req)).status, 409);
    const original = auditService.log;
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = original; });
    mode = 'success';
    const result = await runHandler(updateClient, req);
    assert.equal(result.body.id, 'c');
    assert.equal(calls.find((call) => call.sql.startsWith('UPDATE clients')).params[5], 0);
    assert.equal(audit.action, 'UPDATE_CLIENT');
});

test('the customer VAT condition is stored, kept when not sent and cleared with null (ADR-021)', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT * FROM clients WHERE id') && sql.includes('deleted_at')) {
            return [[{ id: 'c', name: 'Club', tax_condition_id: 'tc_RespInscripto' }]];
        }
        return [[]];
    });
    const original = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = original; });

    await runHandler(createClient, { body: { name: 'Club', tax_id: '30712345678', tax_condition_id: 'tc_Monotributo' } });
    const insert = calls.find((call) => call.sql.includes('INSERT INTO clients'));
    assert.match(insert.sql, /tax_condition_id/);
    assert.equal(insert.params[7], 'tc_Monotributo');

    await runHandler(createClient, { body: { name: 'Ana', tax_id: '1' } });
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO clients'))[1].params[7], null);

    const updates = () => calls.filter((call) => call.sql.startsWith('UPDATE clients SET name'));
    await runHandler(updateClient, { params: { id: 'c' }, body: { name: 'Club', tax_id: '30712345678' } });
    assert.equal(updates()[0].params[6], 'tc_RespInscripto', 'a form without the field keeps the stored condition');
    await runHandler(updateClient, { params: { id: 'c' }, body: { name: 'Club', tax_id: '30712345678', tax_condition_id: 'tc_Exento' } });
    assert.equal(updates()[1].params[6], 'tc_Exento');
    await runHandler(updateClient, { params: { id: 'c' }, body: { name: 'Club', tax_id: '30712345678', tax_condition_id: null } });
    assert.equal(updates()[2].params[6], null);
});

test('deleteClient returns 404 for an unknown client', async (t) => {
    mockPool(t, async () => [[]]);
    const result = await runHandler(deleteClient, { params: { id: 'missing' } });
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'not_found');
});
