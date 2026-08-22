import test from 'node:test';
import assert from 'node:assert/strict';

import { SupplierPaymentService } from '../domains/procurement/SupplierPaymentService.js';
import { SupplierReturnService } from '../domains/procurement/SupplierReturnService.js';
import { GoodsReceptionService } from '../domains/procurement/GoodsReceptionService.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';

function installConnection(t, query) {
    const original = pool.getConnection;
    const lifecycle = [];
    const connection = {
        query,
        async beginTransaction() { lifecycle.push('begin'); },
        async commit() { lifecycle.push('commit'); },
        async rollback() { lifecycle.push('rollback'); },
        release() { lifecycle.push('release'); }
    };
    pool.getConnection = async () => connection;
    t.after(() => { pool.getConnection = original; });
    return { connection, lifecycle };
}

test('supplier payment listing supports global and supplier-specific history', async (t) => {
    const original = pool.query;
    const calls = [];
    pool.query = async (sql, params) => { calls.push({ sql: String(sql), params }); return [[{ id: 'p' }]]; };
    t.after(() => { pool.query = original; });
    const service = new SupplierPaymentService();
    assert.equal((await service.getSupplierPayments())[0].id, 'p');
    assert.equal((await service.getSupplierPayments('s'))[0].id, 'p');
    assert.equal(calls[0].params.length, 0);
    assert.deepEqual(calls[1].params, ['s']);
});

test('supplier payments validate required supplier, lines and positive total', async (t) => {
    const service = new SupplierPaymentService();
    await assert.rejects(() => service.createSupplierPayment({ payments: [{}] }), (e) => e.errorCode === 'MISSING_SUPPLIER');
    await assert.rejects(() => service.createSupplierPayment({ supplier_id: 's', payments: [] }), (e) => e.errorCode === 'MISSING_PAYMENTS');
    const { lifecycle } = installConnection(t, async () => [[]]);
    await assert.rejects(
        () => service.createSupplierPayment({ supplier_id: 's', payments: [{ amount: 0 }, { amount: -1 }] }),
        (e) => e.errorCode === 'INVALID_TOTAL'
    );
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
});

test('supplier payments persist split lines, defaults, ledger impact and audit', async (t) => {
    const calls = [];
    const { lifecycle } = installConnection(t, async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; });
    const originals = { audit: auditService.log };
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = originals.audit; });
    const result = await new SupplierPaymentService().createSupplierPayment({
        supplier_id: 's', notes: 'Pago QA', payments: [
            { amount: 10, payment_method: 'Transferencia', reference_number: 'TR-1' },
            { amount: 5 }
        ]
    }, null, '127.0.0.1');
    assert.equal(result.total, 15);
    assert.equal(result.ids.length, 2);
    assert.equal(audit.new_values.total, 15);
    assert.equal(audit.ip_address, '127.0.0.1');
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO supplier_payments')).length, 2);
});

test('supplier return inventory deduction handles no-op, multiple rows and insufficient stock', async () => {
    const service = new SupplierReturnService();
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id, quantity')) return [[{ id: 'i1', quantity: 2 }, { id: 'i2', quantity: 3 }]];
        return [[]];
    } };
    await service.decreaseInventory(connection, 'p', 0);
    await service.decreaseInventory(connection, 'p', 4);
    assert.deepEqual(calls.filter((call) => call.sql.startsWith('UPDATE')).map((call) => call.params[0]), [2, 2]);
    await assert.rejects(() => service.decreaseInventory(connection, 'p', 9), (e) => e.errorCode === 'INSUFFICIENT_STOCK');
});

test('supplier return approval rejects missing, repeated and empty returns', async (t) => {
    let mode = 'missing';
    installConnection(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM supplier_returns')) {
            if (mode === 'missing') return [[]];
            if (mode === 'approved') return [[{ id: 'r', status: 'approved' }]];
            return [[{ id: 'r', status: 'pending' }]];
        }
        if (statement.includes('supplier_return_items')) return [[]];
        return [[]];
    });
    const service = new SupplierReturnService();
    await assert.rejects(() => service.approveSupplierReturn('r'), (e) => e.errorCode === 'RETURN_NOT_FOUND');
    mode = 'approved';
    await assert.rejects(() => service.approveSupplierReturn('r'), (e) => e.errorCode === 'RETURN_ALREADY_APPROVED');
    mode = 'empty';
    await assert.rejects(() => service.approveSupplierReturn('r'), (e) => e.errorCode === 'RETURN_WITHOUT_ITEMS');
});

test('supplier return approval updates inventory, accounting, balance and audit', async (t) => {
    const calls = [];
    installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM supplier_returns')) return [[{ id: 'r', status: 'pending', return_number: 'DR-1', supplier_id: 's' }]];
        if (statement.includes('SELECT * FROM supplier_return_items')) return [[{ product_id: 'p', quantity: 2, unit_cost: 5, reason: '' }]];
        if (statement.startsWith('SELECT id, quantity FROM inventory')) return [[{ id: 'i', quantity: 2 }]];
        return [[]];
    });
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntry };
    let journal;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async (_connection, value) => { journal = value; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });
    const result = await new SupplierReturnService().approveSupplierReturn('r', null);
    assert.equal(result.success, true);
    assert.equal(journal.lines[0].debit, 10);
    assert.ok(calls.some((call) => call.sql.includes('UPDATE suppliers')));
});

test('goods reception rejects duplicate products and missing quality control', async (t) => {
    let mode = 'duplicate';
    installConnection(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM receptions')) return [[{ id: 'r', status: 'pending' }]];
        if (statement.includes('SELECT * FROM reception_items')) {
            return mode === 'duplicate'
                ? [[{ product_id: 'p' }, { product_id: 'p' }]]
                : [[{ id: 'ri', product_id: 'p', quantity_received: 1 }]];
        }
        if (statement.includes('FROM quality_checks')) return [[]];
        return [[]];
    });
    const service = new GoodsReceptionService();
    await assert.rejects(() => service.processReceptionApproval('r'), (e) => e.errorCode === 'RECEPTION_DUPLICATE_PRODUCT_ITEMS');
    mode = 'qc';
    await assert.rejects(() => service.processReceptionApproval('r'), (e) => e.errorCode === 'RECEPTION_QC_INCOMPLETE');
});

test('goods reception rejects quality mismatches and purchase-order over-receipt', async (t) => {
    let mode = 'qc';
    installConnection(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM receptions')) return [[{ id: 'r', status: 'pending', supplier_id: 's' }]];
        if (statement.includes('SELECT * FROM reception_items')) return [[{ id: 'ri', product_id: 'p', quantity_received: 2, po_item_id: 'poi' }]];
        if (statement.includes('FROM quality_checks')) return [[mode === 'qc'
            ? { quantity_checked: 1, quantity_passed: 1, quantity_failed: 0 }
            : { quantity_checked: 2, quantity_passed: 2, quantity_failed: 0 }]];
        if (statement.includes('SELECT id FROM inventory')) return [[{ id: 'inv' }]];
        if (statement.includes('SELECT quantity_ordered')) return [[{ quantity_ordered: 2, quantity_received: 1 }]];
        return [[]];
    });
    const service = new GoodsReceptionService();
    await assert.rejects(() => service.processReceptionApproval('r'), (e) => e.errorCode === 'RECEPTION_QC_INVALID');
    mode = 'po';
    await assert.rejects(() => service.processReceptionApproval('r'), (e) => e.errorCode === 'RECEPTION_EXCEEDS_PENDING_QUANTITY');
});

test('goods reception segregates failed stock, creates batches and marks partial purchase orders', async (t) => {
    const calls = [];
    installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM receptions')) return [[{
            id: 'r', status: 'pending', supplier_id: 's', purchase_order_id: 'po', reception_number: 'REC-1', reception_date: '2026-08-22'
        }]];
        if (statement.includes('SELECT * FROM reception_items')) return [[{
            id: 'ri', product_id: 'p', quantity_received: 3, unit_cost: 10, location_assigned: 'A',
            batch_number: 'L-1', expiration_date: null, po_item_id: 'poi'
        }]];
        if (statement.includes('FROM quality_checks')) return [[{
            quantity_checked: 3, quantity_passed: 2, quantity_failed: 1, defect_description: 'Golpe'
        }]];
        if (statement.includes('SELECT id FROM inventory')) return String(params[1]) === 'A' ? [[]] : [[{ id: 'quarantine' }]];
        if (statement.includes('SELECT quantity_ordered')) return [[{ quantity_ordered: 5, quantity_received: 0 }]];
        if (statement.includes('SUM(quantity_ordered)')) return [[{ ordered_qty: 5, received_qty: 3 }]];
        return [[]];
    });
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntry };
    let journal;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async (_connection, entry) => { journal = entry; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });
    const result = await new GoodsReceptionService().processReceptionApproval('r', { actorUserId: 'u', approvedBy: 'Admin' });
    assert.equal(result.success, true);
    assert.equal(journal.lines[2].credit, 36.3);
    assert.ok(calls.some((call) => call.params?.[0] === 'partial' && call.params?.[1] === 'po'));
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO product_batches')).length, 2);
});
