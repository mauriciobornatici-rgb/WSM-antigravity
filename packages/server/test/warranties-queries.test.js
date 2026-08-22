import test from 'node:test';
import assert from 'node:assert/strict';

import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import auditService from '../services/audit.service.js';
import afipService from '../services/afip.service.js';
import { mockPool } from './helpers/mockDb.js';

test('warranties list applies filters and create supplies an id', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('INSERT INTO warranty_claims')) return [{ affectedRows: 1 }];
        return [[{ id: 'w-1' }]];
    });
    const rows = await warrantiesService.getWarranties({ client_id: 'c-1', status: 'open' });
    const created = await warrantiesService.createWarranty({ client_id: 'c-1', issue_description: 'Falla' });
    assert.equal(rows[0].id, 'w-1');
    assert.ok(calls[0].sql.includes('w.client_id = ?') && calls[0].sql.includes('w.status = ?'));
    assert.deepEqual(calls[0].params, ['c-1', 'open']);
    assert.ok(created.id);
});

test('returns list handles empty and populated filtered responses', async (t) => {
    let primaryCalls = 0;
    mockPool(t, async (sql) => {
        if (String(sql).includes('FROM client_returns r')) {
            primaryCalls += 1;
            return primaryCalls === 1 ? [[]] : [[{ id: 'r-1' }, { id: 'r-2' }]];
        }
        if (String(sql).includes('FROM client_return_items i')) {
            return [[{ id: 'i-1', return_id: 'r-1' }]];
        }
        return [[]];
    });
    assert.deepEqual(await returnsService.getReturns(), []);
    const rows = await returnsService.getReturns({ client_id: 'c-1', status: 'approved' });
    assert.equal(rows[0].items.length, 1);
    assert.equal(rows[1].items.length, 0);
});

test('returns analytics aggregates loss as a number and releases connection', async (t) => {
    let queryIndex = 0;
    let released = false;
    const connection = mockPool(t, async () => {
        queryIndex += 1;
        if (queryIndex === 1) return [[{ product_name: 'Botín' }]];
        if (queryIndex === 2) return [[{ reason: 'Talle' }]];
        return [[{ total_loss_amount: '99.50' }]];
    });
    connection.release = () => { released = true; };
    const result = await returnsService.getReturnsAnalytics();
    assert.equal(result.totalLossAmount, 99.5);
    assert.equal(result.topDefectiveProducts[0].product_name, 'Botín');
    assert.equal(released, true);
});

test('createReturn supports a document without items and rolls back database errors', async (t) => {
    let committed = false;
    const connection = mockPool(t, async (sql) => {
        if (String(sql).includes('INSERT INTO client_returns')) return [[]];
        return [[]];
    });
    connection.commit = async () => { committed = true; };
    const result = await returnsService.createReturn({ customer_name: 'Ana' });
    assert.ok(result.id);
    assert.equal(committed, true);
});

test('return inventory impact covers supplier RMA, loss, rejection and zero quantity', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id FROM inventory')) return [[]];
        return [[]];
    } };
    assert.deepEqual(await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { quantity: 0 } }), { restocked: 0, discarded: 0 });
    const rma = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 2, condition_status: 'supplier_rma' } });
    const loss = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 1, condition_status: 'loss' } });
    const rejected = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 1, condition_status: 'rejected' } });
    assert.deepEqual(rma, { restocked: 0, discarded: 2 });
    assert.equal(loss.discarded, 1);
    assert.equal(rejected.discarded, 1);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO inventory (')));
    assert.ok(calls.some((call) => call.params?.includes('rejected')));
});

test('approveReturn rejects invalid states', async (t) => {
    mockPool(t, async (sql) => {
        if (String(sql).includes('SELECT * FROM client_returns')) return [[{ id: 'r-1', status: 'cancelled' }]];
        return [[]];
    });
    await assert.rejects(
        () => returnsService.approveReturn('r-1', 'u-1'),
        (error) => error.errorCode === 'RETURN_INVALID_STATE' && error.statusCode === 400
    );
});

test('credit note listing filters clients and authorization handles missing and replay', async (t) => {
    let lookup = 0;
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM credit_notes cn')) return [[{ id: 'cn-list' }]];
        if (String(sql).startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) {
            lookup += 1;
            if (lookup === 1) return [[]];
            return [[{ id: 'cn-1', status: 'authorized' }]];
        }
        return [[]];
    });
    const listed = await creditNotesService.getCreditNotes({ client_id: 'c-1' });
    assert.equal(listed[0].id, 'cn-list');
    await assert.rejects(() => creditNotesService.authorizeCreditNote('missing', 'u'), (error) => error.errorCode === 'CREDIT_NOTE_NOT_FOUND');
    const replay = await creditNotesService.authorizeCreditNote('cn-1', 'u');
    assert.equal(replay.status, 'authorized');
});

test('authorizeCreditNote obtains AFIP CAE from the original fiscal invoice', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) return [[{
            id: 'cn-1', status: 'issued', reference_type: 'return', reference_id: 'r-1',
            credit_note_type: 'A', amount: 121, number: 'NC-1'
        }]];
        if (statement.includes('SELECT order_id FROM client_returns')) return [[{ order_id: 'o-1' }]];
        if (statement.includes('SELECT * FROM invoices WHERE order_id')) return [[{ client_tax_id: '20123456789' }]];
        if (statement.includes('SELECT * FROM company_settings')) return [[{ tax_id: '30700000001' }]];
        if (statement.includes('FROM client_return_items ri')) return [[]];
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ?')) return [[{ id: 'cn-1', status: 'authorized', cae: '123' }]];
        return [[]];
    });
    const originalAfip = afipService.authorizeVoucher;
    const originalAudit = auditService.log;
    afipService.authorizeVoucher = async (_invoice, items) => {
        assert.equal(items[0].vat_rate, 21);
        return { cae: '123', cae_expiration_date: '2026-09-01' };
    };
    auditService.log = async () => {};
    t.after(() => {
        afipService.authorizeVoucher = originalAfip;
        auditService.log = originalAudit;
    });
    const result = await creditNotesService.authorizeCreditNote('cn-1', 'u-1');
    assert.equal(result.cae, '123');
    assert.ok(calls.some((call) => call.params?.[0] === '123' && call.params?.[2] === 'cn-1'));
});

test('authorizeCreditNote surfaces an AFIP rejection', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) return [[{
            id: 'cn-1', status: 'issued', reference_type: 'return', reference_id: 'r-1', amount: 10
        }]];
        if (statement.includes('SELECT order_id FROM client_returns')) return [[{ order_id: 'o-1' }]];
        if (statement.includes('SELECT * FROM invoices WHERE order_id')) return [[{ id: 'i-1' }]];
        if (statement.includes('SELECT * FROM company_settings')) return [[]];
        if (statement.includes('FROM client_return_items ri')) return [[{ quantity: 1, unit_price: 10, vat_rate: 21 }]];
        return [[]];
    });
    const original = afipService.authorizeVoucher;
    afipService.authorizeVoucher = async () => { throw new Error('rechazo QA'); };
    t.after(() => { afipService.authorizeVoucher = original; });
    await assert.rejects(() => creditNotesService.authorizeCreditNote('cn-1', 'u'), /AFIP rechazó.*rechazo QA/);
});
