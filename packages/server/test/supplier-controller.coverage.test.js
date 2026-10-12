import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupplier, deleteSupplier, getSuppliers, updateSupplier } from '../controllers/supplierController.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) { statusCode = code; return this; },
            json(body) { settled = true; resolve({ status: statusCode, body }); return this; }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try { handler(req, res, next); } catch (error) { next(error); }
    });
}

function installPool(t, handler) {
    const calls = [];
    const prev = pool.query;
    pool.query = async (sql, params = []) => {
        const statement = norm(sql);
        calls.push({ statement, params });
        return handler(statement, params);
    };
    t.after(() => { pool.query = prev; });
    return calls;
}

function installAudit(t) {
    const logs = [];
    const prev = auditService.log;
    auditService.log = async (payload) => { logs.push(payload); };
    t.after(() => { auditService.log = prev; });
    return logs;
}

const body = { name: 'Proveedor SA', tax_id: '30-1', contact_name: 'Ana', email: 'a@b.c', phone: '1', address: 'X' };

test('getSuppliers lists only non-deleted suppliers', async (t) => {
    const calls = installPool(t, async () => [[{ id: 's1' }]]);
    const res = await runHandler(getSuppliers);
    assert.deepEqual(res.body, [{ id: 's1' }]);
    assert.ok(calls[0].statement.includes('deleted_at IS NULL'));
});

test('createSupplier rejects duplicate tax id with 409 and does not insert', async (t) => {
    const calls = installPool(t, async () => [[{ id: 'other' }]]);
    const logs = installAudit(t);
    const res = await runHandler(createSupplier, { body });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'duplicate_tax_id');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, ['30-1']);
    assert.equal(logs.length, 0);
});

test('createSupplier inserts, audits and returns the new row', async (t) => {
    const calls = installPool(t, async (statement) => {
        if (statement.startsWith('SELECT id FROM suppliers')) return [[]];
        if (statement.startsWith('SELECT * FROM suppliers')) return [[{ id: 'new', name: 'Proveedor SA' }]];
        return [{ affectedRows: 1 }];
    });
    const logs = installAudit(t);
    const res = await runHandler(createSupplier, { body, user: { id: 'u1' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Proveedor SA');
    const insert = calls.find((c) => c.statement.startsWith('INSERT INTO suppliers'));
    assert.equal(insert.params.length, 7);
    assert.deepEqual(insert.params.slice(1), ['Proveedor SA', '30-1', 'Ana', 'a@b.c', '1', 'X']);
    assert.equal(logs[0].action, 'CREATE_SUPPLIER');
    assert.equal(logs[0].user_id, 'u1');
    assert.equal(logs[0].entity_id, insert.params[0]);
});

test('createSupplier audits request body and null user when re-read returns nothing', async (t) => {
    installPool(t, async (statement) => {
        if (statement.startsWith('SELECT')) return [[]];
        return [{ affectedRows: 1 }];
    });
    const logs = installAudit(t);
    const res = await runHandler(createSupplier, { body });
    assert.equal(res.body, undefined);
    assert.equal(logs[0].user_id, null);
    assert.deepEqual(logs[0].new_values, body);
});

test('updateSupplier returns 404 when supplier does not exist', async (t) => {
    const calls = installPool(t, async () => [[]]);
    const res = await runHandler(updateSupplier, { params: { id: 'x' }, body });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
    assert.equal(calls.length, 1);
});

test('updateSupplier returns 409 when tax id belongs to another supplier', async (t) => {
    const calls = installPool(t, async (statement) => {
        if (statement.includes('tax_id = ? AND id != ?')) return [[{ id: 'other' }]];
        return [[{ id: 's1' }]];
    });
    const res = await runHandler(updateSupplier, { params: { id: 's1' }, body });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'duplicate_tax_id');
    assert.deepEqual(calls[1].params, ['30-1', 's1']);
    assert.ok(!calls.some((c) => c.statement.startsWith('UPDATE')));
});

test('updateSupplier updates, audits old and new values', async (t) => {
    const calls = installPool(t, async (statement) => {
        if (statement.includes('tax_id = ? AND id != ?')) return [[]];
        if (statement.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        return [[{ id: 's1', name: 'viejo' }]];
    });
    const logs = installAudit(t);
    const res = await runHandler(updateSupplier, { params: { id: 's1' }, body, user: { id: 'u2' } });
    assert.equal(res.body.id, 's1');
    const update = calls.find((c) => c.statement.startsWith('UPDATE suppliers'));
    assert.deepEqual(update.params, ['Proveedor SA', '30-1', 'Ana', 'a@b.c', '1', 'X', 's1']);
    assert.equal(logs[0].action, 'UPDATE_SUPPLIER');
    assert.deepEqual(logs[0].old_values, { id: 's1', name: 'viejo' });
    assert.equal(logs[0].user_id, 'u2');
});

test('updateSupplier audits request body when updated row vanished', async (t) => {
    let selects = 0;
    installPool(t, async (statement) => {
        if (statement.includes('tax_id = ? AND id != ?')) return [[]];
        if (statement.startsWith('UPDATE')) return [{ affectedRows: 0 }];
        selects += 1;
        return selects === 1 ? [[{ id: 's1' }]] : [[]];
    });
    const logs = installAudit(t);
    await runHandler(updateSupplier, { params: { id: 's1' }, body });
    assert.deepEqual(logs[0].new_values, body);
    assert.equal(logs[0].user_id, null);
});

test('deleteSupplier returns 404 for unknown supplier', async (t) => {
    installPool(t, async () => [[]]);
    const res = await runHandler(deleteSupplier, { params: { id: 'x' } });
    assert.equal(res.status, 404);
});

test('deleteSupplier refuses suppliers with pending balance', async (t) => {
    const calls = installPool(t, async () => [[{ id: 's1', account_balance: '-150.50' }]]);
    const logs = installAudit(t);
    const res = await runHandler(deleteSupplier, { params: { id: 's1' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'has_balance');
    assert.equal(calls.length, 1);
    assert.equal(logs.length, 0);
});

test('deleteSupplier soft-deletes a zero-balance supplier and audits', async (t) => {
    const calls = installPool(t, async (statement) => {
        if (statement.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        return [[{ id: 's1', name: 'N', account_balance: null }]];
    });
    const logs = installAudit(t);
    const res = await runHandler(deleteSupplier, { params: { id: 's1' }, user: { id: 'u3' } });
    assert.deepEqual(res.body, { success: true });
    const update = calls.find((c) => c.statement.startsWith('UPDATE suppliers SET deleted_at'));
    assert.deepEqual(update.params, ['s1']);
    assert.ok(!calls.some((c) => c.statement.startsWith('DELETE')));
    assert.equal(logs[0].action, 'DELETE_SUPPLIER');
    assert.equal(logs[0].user_id, 'u3');
});

test('deleteSupplier audit falls back to null user', async (t) => {
    installPool(t, async (statement) => {
        if (statement.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        return [[{ id: 's1', account_balance: 0 }]];
    });
    const logs = installAudit(t);
    await runHandler(deleteSupplier, { params: { id: 's1' } });
    assert.equal(logs[0].user_id, null);
});

test('supplier handlers propagate database errors to next', async (t) => {
    installPool(t, async () => { throw new Error('boom'); });
    await assert.rejects(() => runHandler(getSuppliers), /boom/);
});
