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
    // The default method is cash: an open shift with enough cash must back it (ADR-014).
    let cashOut = 0;
    const { connection, lifecycle } = installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes("FROM cash_shifts WHERE id = ? AND status = 'open' FOR UPDATE")) return [[{ id: 'shift-1' }]];
        if (statement.includes("FROM cash_shifts WHERE status = 'open'")) return [[{ id: 'shift-1' }]];
        if (statement.includes('INSERT INTO shift_payments')) cashOut += params[2];
        if (statement.includes('FROM shift_payments')) return [[{ inflow: 100, outflow: cashOut }]];
        if (statement.includes('SELECT opening_balance')) return [[{ opening_balance: 0 }]];
        return [[]];
    });
    const originals = { audit: auditService.log };
    let audit;
    let auditExecutor;
    auditService.log = async (payload, executor) => { audit = payload; auditExecutor = executor; lifecycle.push('audit'); };
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
    // The audit runs on the transaction connection, before the commit.
    assert.equal(auditExecutor, connection);
    assert.deepEqual(lifecycle, ['begin', 'audit', 'commit', 'release']);
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO supplier_payments')).length, 2);
    // Only the cash line (5) leaves the drawer; the transfer (10) does not.
    const drawer = calls.filter((call) => call.sql.includes('INSERT INTO shift_payments'));
    assert.equal(drawer.length, 1);
    assert.deepEqual([drawer[0].params[1], drawer[0].params[2]], ['shift-1', 5]);
    assert.ok(drawer[0].sql.includes("'expense'"));
    assert.ok(calls.some((call) => call.sql.startsWith('UPDATE cash_shifts SET expected_balance') && call.params[0] === 95));
});

test('supplier return inventory deduction handles no-op, multiple rows and insufficient stock', async () => {
    const service = new SupplierReturnService();
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id, location, quantity, reserved_quantity')) {
            // 3 of the 5 units on i2 are reserved for customer orders.
            return [[
                { id: 'i1', location: 'Devoluciones a Proveedores', quantity: 2, reserved_quantity: 0 },
                { id: 'i2', location: 'General', quantity: 5, reserved_quantity: 3 },
            ]];
        }
        if (String(sql).startsWith('UPDATE inventory')) return [{ affectedRows: 1 }];
        return [[]];
    } };
    await service.decreaseInventory(connection, { product_id: 'p', quantity: 0 }, 'r');
    await service.decreaseInventory(connection, { product_id: 'p', quantity: 4 }, 'r');
    const updates = calls.filter((call) => call.sql.startsWith('UPDATE'));
    assert.deepEqual(updates.map((call) => call.params), [[2, 'i1', 2], [2, 'i2', 2]]);
    assert.ok(updates.every((call) => call.sql.includes('quantity - reserved_quantity >= ?')));
    const movements = calls.filter((call) => call.sql.includes('INSERT INTO inventory_movements'));
    assert.deepEqual(movements.map((call) => [call.params[2], call.params[3]]), [['Devoluciones a Proveedores', 2], ['General', 2]]);
    // Only 4 unreserved units exist: 5 cannot be returned without touching reservations.
    await assert.rejects(
        () => service.decreaseInventory(connection, { product_id: 'p', quantity: 5 }, 'r'),
        (e) => e.errorCode === 'INSUFFICIENT_STOCK' && e.statusCode === 409
    );
});

test('supplier return approval rejects missing, repeated and empty returns', async (t) => {
    let mode = 'missing';
    const { lifecycle } = installConnection(t, async (sql) => {
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
    assert.equal(lifecycle.filter((event) => event === 'rollback').length, 1);
    mode = 'approved';
    await assert.rejects(() => service.approveSupplierReturn('r'), (e) => e.errorCode === 'RETURN_ALREADY_APPROVED');
    assert.equal(lifecycle.filter((event) => event === 'rollback').length, 2);
    mode = 'empty';
    await assert.rejects(() => service.approveSupplierReturn('r'), (e) => e.errorCode === 'RETURN_WITHOUT_ITEMS');
    assert.equal(lifecycle.filter((event) => event === 'rollback').length, 3);
});

test('supplier payments preserve explicit metadata and roll back database failures once', async (t) => {
    let insertCount = 0;
    const { lifecycle } = installConnection(t, async (sql, params) => {
        if (String(sql).includes('INSERT INTO supplier_payments')) {
            insertCount += 1;
            assert.equal(params[3], '2026-08-22');
            assert.equal(params[4], 'Cheque');
            assert.equal(params[5], 'CH-9');
            assert.equal(params[6], null);
        }
        if (String(sql).includes('UPDATE suppliers')) throw new Error('balance unavailable');
        return [[]];
    });
    const originalAudit = auditService.log;
    let audited = false;
    auditService.log = async () => { audited = true; };
    t.after(() => { auditService.log = originalAudit; });

    await assert.rejects(() => new SupplierPaymentService().createSupplierPayment({
        supplier_id: 's', payment_date: '2026-08-22', payments: [
            { amount: '12.50', payment_method: 'Cheque', reference_number: 'CH-9' },
            { amount: null },
        ],
    }, 'u-1'), /balance unavailable/);
    assert.equal(insertCount, 1);
    assert.equal(audited, false);
    assert.deepEqual(lifecycle, ['begin', 'rollback', 'release']);
});

test('supplier return approval updates inventory, accounting, balance and audit', async (t) => {
    const calls = [];
    installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM supplier_returns')) return [[{ id: 'r', status: 'pending', return_number: 'DR-1', supplier_id: 's' }]];
        if (statement.includes('SELECT * FROM supplier_return_items')) return [[{ product_id: 'p', quantity: 2, unit_cost: 5, reason: '' }]];
        if (statement.startsWith('SELECT id, location, quantity, reserved_quantity')) return [[{ id: 'i', location: 'General', quantity: 2, reserved_quantity: 0 }]];
        if (statement.startsWith('UPDATE inventory')) return [{ affectedRows: 1 }];
        // The supplier's last posted invoice: Factura A with 21 % VAT.
        if (statement.includes('FROM supplier_invoices si')) return [[{ net_amount: 100, vat_amount: 21 }]];
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
    // Mirror of the purchase (ADR-011): Proveedores 12.10 / Mercadería 10.00 + IVA CF 2.10.
    assert.deepEqual(journal.lines.map((line) => [line.account_code, line.debit, line.credit]), [
        ['2.1.01.01', 12.1, 0],
        ['1.1.04.01', 0, 10],
        ['1.1.05.02', 0, 2.1],
    ]);
    const balance = calls.find((call) => call.sql.includes('UPDATE suppliers'));
    assert.deepEqual(balance.params, [12.1, 's']);
    assert.equal(balance.sql.includes('GREATEST'), false, 'a balance in our favour is not clamped to zero');
    const transaction = calls.find((call) => call.sql.includes('INSERT INTO transactions'));
    assert.match(transaction.sql, /'adjustment'/);
});

test('supplier return before any posted supplier invoice only moves stock (goods were never booked)', async (t) => {
    const calls = [];
    installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM supplier_returns')) return [[{ id: 'r2', status: 'draft', return_number: 'DR-2', supplier_id: 's' }]];
        if (statement.includes('SELECT * FROM supplier_return_items')) return [[{ product_id: 'p', quantity: 1, unit_cost: 50, reason: '' }]];
        if (statement.startsWith('SELECT id, location, quantity, reserved_quantity')) return [[{ id: 'i', location: 'General', quantity: 1, reserved_quantity: 0 }]];
        if (statement.startsWith('UPDATE inventory')) return [{ affectedRows: 1 }];
        if (statement.includes('FROM supplier_invoices si')) return [[]];
        return [[]];
    });
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntry };
    let journalCalls = 0;
    let audited;
    auditService.log = async (payload) => { audited = payload; };
    accountingService.createJournalEntry = async () => { journalCalls += 1; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });
    await new SupplierReturnService().approveSupplierReturn('r2', null);
    assert.equal(journalCalls, 0);
    assert.equal(calls.some((call) => call.sql.includes('UPDATE suppliers')), false);
    assert.match(String(audited.new_values.accounting), /not_posted/);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO inventory_movements')));
});

test('supplier return approval accepts missing historical cost without creating zero-value accounting', async (t) => {
    const calls = [];
    const { lifecycle } = installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM supplier_returns')) {
            return [[{ id: 'r-zero', status: 'pending', return_number: 'DR-ZERO', supplier_id: 's' }]];
        }
        if (statement.includes('SELECT * FROM supplier_return_items')) {
            return [[{ product_id: 'p', quantity: 1, unit_cost: null, reason: 'Sin costo histórico' }]];
        }
        if (statement.startsWith('SELECT id, location, quantity, reserved_quantity')) return [[{ id: 'i', location: 'General', quantity: 1, reserved_quantity: 0 }]];
        if (statement.startsWith('UPDATE inventory')) return [{ affectedRows: 1 }];
        return [[]];
    });
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntry };
    let audited;
    let journalCalls = 0;
    auditService.log = async (payload) => { audited = payload; };
    accountingService.createJournalEntry = async () => { journalCalls += 1; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });

    const result = await new SupplierReturnService().approveSupplierReturn('r-zero', 'u-1', '127.0.0.1');
    assert.equal(result.success, true);
    assert.equal(journalCalls, 0);
    assert.equal(audited.new_values.total_amount, 0);
    assert.equal(audited.user_id, 'u-1');
    assert.equal(audited.ip_address, '127.0.0.1');
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO transactions')), false);
    assert.equal(calls.some(({ sql }) => sql.includes('UPDATE suppliers')), false);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
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
    let journalCalls = 0;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async () => { journalCalls += 1; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });
    const result = await new GoodsReceptionService().processReceptionApproval('r', { actorUserId: 'u', approvedBy: 'Admin' });
    assert.equal(result.success, true);
    // Reception approval must NOT post to the ledger; the supplier invoice does (see H5).
    assert.equal(journalCalls, 0);
    assert.ok(calls.some((call) => call.params?.[0] === 'partial' && call.params?.[1] === 'po'));
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO product_batches')).length, 2);
});

test('goods reception accepts zero-cost stock without PO, batch, quarantine or accounting entry', async (t) => {
    const calls = [];
    const { lifecycle } = installConnection(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM receptions')) return [[{
            id: 'r-free', status: 'pending', supplier_id: 's', reception_number: 'REC-FREE',
        }]];
        if (statement.includes('SELECT * FROM reception_items')) return [[{
            id: 'ri-free', product_id: 'gift', quantity_received: 2, unit_cost: 0,
            location_assigned: '', batch_number: null, po_item_id: null,
        }]];
        if (statement.includes('FROM quality_checks')) return [[{
            quantity_checked: 2, quantity_passed: 2, quantity_failed: 0, defect_description: null,
        }]];
        if (statement.includes('SELECT id FROM inventory')) return [[{ id: 'inventory-general' }]];
        return [[]];
    });
    const originals = { audit: auditService.log, journal: accountingService.createJournalEntry };
    let journalCalls = 0;
    auditService.log = async () => {};
    accountingService.createJournalEntry = async () => { journalCalls += 1; };
    t.after(() => {
        auditService.log = originals.audit;
        accountingService.createJournalEntry = originals.journal;
    });

    assert.deepEqual(await new GoodsReceptionService().processReceptionApproval('r-free'), { success: true });
    assert.equal(journalCalls, 0);
    assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO inventory_movements')).length, 1);
    assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO product_batches')).length, 0);
    assert.equal(calls.some(({ sql }) => sql.includes('UPDATE purchase_orders')), false);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
});
