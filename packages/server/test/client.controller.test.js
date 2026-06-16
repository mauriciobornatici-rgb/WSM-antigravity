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
