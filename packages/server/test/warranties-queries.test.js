import test from 'node:test';
import assert from 'node:assert/strict';

import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import auditService from '../services/audit.service.js';
import afipService from '../services/afip.service.js';
import accountingService from '../services/accounting.service.js';
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

test('warranty creation preserves an explicit id and listing supports no filters', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('INSERT INTO warranty_claims')) return [{ affectedRows: 1 }];
        return [[]];
    });
    assert.deepEqual(await warrantiesService.getWarranties(), []);
    const created = await warrantiesService.createWarranty({ id: 'w-explicit', issue_description: 'Falla' });
    assert.equal(created.id, 'w-explicit');
    assert.equal(calls[0].params.length, 0);
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

test('createReturn persists item defaults and computed totals, pricing from the order not the client', async (t) => {
    const calls = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id FROM orders')) return [[{ id: 'o' }]];
        if (statement.includes('FROM order_items WHERE order_id')) {
            // Sold prices differ from whatever the client sends, to prove they win.
            return [[
                { product_id: 'p', quantity: 5, unit_price: 20 },
                { product_id: 'p2', quantity: 5, unit_price: 999 },
            ]];
        }
        if (statement.includes('FROM client_return_items ri')) return [[]];
        if (statement.includes('SELECT COALESCE(SUM')) return [[{ total: '30.50' }]];
        return [[]];
    });
    let committed = false;
    connection.commit = async () => { committed = true; };
    const result = await returnsService.createReturn({
        client_id: 'c', order_id: 'o', reason: 'Talle', items: [
            { product_id: 'p', quantity: 1 },
            { product_id: 'p2', quantity: 2, condition_status: 'loss', unit_price: 15.25 },
        ],
    });
    assert.ok(result.id);
    assert.equal(committed, true);
    const itemInsert = calls.find(({ sql }) => sql.includes('INSERT INTO client_return_items'));
    assert.equal(itemInsert.params[0][0][4], 'sellable');
    assert.equal(itemInsert.params[0][0][5], 20, 'unit_price for p must come from order_items');
    assert.equal(itemInsert.params[0][1][4], 'loss');
    assert.equal(itemInsert.params[0][1][5], 999, 'unit_price for p2 must come from order_items, ignoring the client-sent 15.25');
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE client_returns SET total_amount') && params[0] === '30.50'));
});

test('createReturn rejects with RETURN_EXCEEDS_SOLD when the requested quantity exceeds what remains to return', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id FROM orders')) return [[{ id: 'o' }]];
        if (statement.includes('FROM order_items WHERE order_id')) {
            return [[{ product_id: 'p', quantity: 2, unit_price: 50 }]];
        }
        if (statement.includes('FROM client_return_items ri')) {
            // One unit was already returned on a prior, still-valid return.
            return [[{ product_id: 'p', quantity: 1 }]];
        }
        return [[]];
    });

    await assert.rejects(
        () => returnsService.createReturn({
            order_id: 'o', reason: 'Talle', items: [{ product_id: 'p', quantity: 2 }],
        }),
        (error) => error.errorCode === 'RETURN_EXCEEDS_SOLD' && error.statusCode === 409
    );
});

test('createReturn uses the catalog sale_price when no order_id is given', async (t) => {
    const calls = [];
    const connection = mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id, sale_price FROM products')) {
            return [[{ id: 'p', sale_price: 88.5 }]];
        }
        if (statement.includes('SELECT COALESCE(SUM')) return [[{ total: '88.50' }]];
        return [[]];
    });
    connection.commit = async () => {};
    await returnsService.createReturn({
        customer_name: 'Sin pedido', reason: 'Cambio de opinion',
        // No order_id: client-sent unit_price must still be ignored in favor of the catalog price.
        items: [{ product_id: 'p', quantity: 1, unit_price: 1 }],
    });
    const itemInsert = calls.find(({ sql }) => sql.includes('INSERT INTO client_return_items'));
    assert.equal(itemInsert.params[0][0][5], 88.5, 'unit_price must come from products.sale_price, not the client');
});

test('createReturn throws PRODUCT_NOT_FOUND when the catalog has no matching product and no order_id was given', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id, sale_price FROM products')) return [[]];
        return [[]];
    });
    await assert.rejects(
        () => returnsService.createReturn({ reason: 'x', items: [{ product_id: 'ghost', quantity: 1 }] }),
        (error) => error.errorCode === 'PRODUCT_NOT_FOUND' && error.statusCode === 404
    );
});

test('createReturn throws INVALID_QUANTITY for a zero, negative or non-integer quantity', async (t) => {
    mockPool(t, async () => [[]]);
    for (const quantity of [0, -1, 1.5, 'abc']) {
        await assert.rejects(
            () => returnsService.createReturn({ reason: 'x', items: [{ product_id: 'p', quantity }] }),
            (error) => error.errorCode === 'INVALID_QUANTITY' && error.statusCode === 400,
            `quantity ${quantity} should be rejected`
        );
    }
});

test('createReturn throws ORDER_NOT_FOUND when the referenced order does not exist', async (t) => {
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT id FROM orders')) return [[]];
        return [[]];
    });
    await assert.rejects(
        () => returnsService.createReturn({ order_id: 'missing-order', reason: 'x', items: [{ product_id: 'p', quantity: 1 }] }),
        (error) => error.errorCode === 'ORDER_NOT_FOUND' && error.statusCode === 404
    );
});

test('approveReturn omits the VAT journal line for a 0% VAT product', async (t) => {
    const originals = { impact: returnsService._increaseInventoryForReturn, number: returnsService._nextCreditNoteNumber, journal: accountingService.createJournalEntry, audit: auditService.log };
    let journal;
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM client_returns')) return [[{ id: 'r', status: 'pending', client_id: null }]];
        if (statement.includes('SELECT * FROM client_return_items')) return [[
            { product_id: 'exempt', quantity: 1, unit_price: 50, condition_status: 'sellable' },
        ]];
        if (statement.includes('SELECT id, vat_rate FROM products')) return [[{ id: 'exempt', vat_rate: 0 }]];
        return [[]];
    });
    returnsService._increaseInventoryForReturn = async () => ({ restocked: 1, discarded: 0 });
    returnsService._nextCreditNoteNumber = async () => 'NC-2026-0002';
    accountingService.createJournalEntry = async (_connection, entry) => { journal = entry; };
    auditService.log = async () => {};
    t.after(() => {
        returnsService._increaseInventoryForReturn = originals.impact;
        returnsService._nextCreditNoteNumber = originals.number;
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });

    const result = await returnsService.approveReturn('r', 'u');
    assert.equal(result.total_amount, 50, 'no VAT is added for a 0% product');
    assert.equal(journal.lines.length, 2, 'no 2.1.02.02 VAT line when VAT is 0');
    assert.ok(!journal.lines.some((l) => l.account_code === '2.1.02.02'));
    const totalDebit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = journal.lines.reduce((sum, l) => sum + l.credit, 0);
    assert.equal(totalDebit, totalCredit, 'journal entry must balance');
});

test('createReturn rolls back and releases its connection on insert failure', async (t) => {
    const connection = mockPool(t, async () => { throw new Error('return insert failed'); });
    let rolledBack = 0;
    let released = 0;
    connection.rollback = async () => { rolledBack += 1; };
    connection.release = () => { released += 1; };
    await assert.rejects(() => returnsService.createReturn({}), /return insert failed/);
    assert.equal(rolledBack, 1);
    assert.equal(released, 1);
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

test('sellable return inventory reuses its location and traces actor and cost', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).startsWith('SELECT id FROM inventory')) return [[{ id: 'inv-general' }]];
        return [[]];
    } };
    const result = await returnsService._increaseInventoryForReturn(connection, {
        returnId: 'r', actorUserId: 'u',
        item: { product_id: 'p', quantity: 2, condition_status: 'SELLABLE', unit_price: 12.5 },
    });
    assert.deepEqual(result, { restocked: 2, discarded: 0 });
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE inventory') && params[1] === 'inv-general'));
    const movement = calls.find(({ sql }) => sql.includes('INSERT INTO inventory_movements'));
    assert.equal(movement.params[5], 12.5);
    assert.equal(movement.params.at(-1), 'u');
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

test('approveReturn validates missing, replayed and itemless returns', async (t) => {
    let mode = 'missing';
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.includes('SELECT * FROM client_returns')) {
            if (mode === 'missing') return [[]];
            if (mode === 'approved') return [[{ id: 'r', status: 'approved' }]];
            return [[{ id: 'r', status: 'pending' }]];
        }
        if (statement.includes('client_return_items')) return [[]];
        return [[]];
    });
    await assert.rejects(() => returnsService.approveReturn('r'), (e) => e.errorCode === 'RETURN_NOT_FOUND' && e.statusCode === 404);
    mode = 'approved';
    await assert.rejects(() => returnsService.approveReturn('r'), (e) => e.errorCode === 'RETURN_ALREADY_APPROVED' && e.statusCode === 409);
    mode = 'empty';
    await assert.rejects(() => returnsService.approveReturn('r'), (e) => e.errorCode === 'RETURN_WITHOUT_ITEMS');
});

test('approveReturn creates a type A credit note, client credit and accounting entry with net/VAT split', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM client_returns')) return [[{
            id: 'r', status: 'pending', client_id: 'c', customer_name: 'Empresa SA', order_id: 'o',
        }]];
        // The credit note letter comes from the invoice it corrects (clients has no tax condition column).
        if (statement.includes('SELECT invoice_type FROM invoices')) return [[{ invoice_type: 'A' }]];
        if (statement.includes('SELECT * FROM client_return_items')) return [[
            { product_id: 'p', quantity: 2, unit_price: 50, condition_status: 'sellable' },
            { product_id: 'rejected', quantity: 1, unit_price: 999, condition_status: 'rejected' },
        ]];
        if (statement.includes('SELECT id, vat_rate FROM products')) return [[
            { id: 'p', vat_rate: 21 },
            { id: 'rejected', vat_rate: 21 },
        ]];
        if (statement.includes('SELECT billing_pos')) return [[{ billing_pos: '4' }]];
        if (statement.includes('tax_condition_id')) throw new Error("Unknown column 'tax_condition_id' in 'field list'");
        return [[]];
    });
    const originals = {
        impact: returnsService._increaseInventoryForReturn,
        number: returnsService._nextCreditNoteNumber,
        journal: accountingService.createJournalEntry,
        audit: auditService.log,
    };
    const impacts = [
        { restocked: 2, discarded: 0 },
        { restocked: 0, discarded: 1 },
    ];
    let journal;
    let audited;
    returnsService._increaseInventoryForReturn = async () => impacts.shift();
    returnsService._nextCreditNoteNumber = async () => 'NC-2026-0001';
    accountingService.createJournalEntry = async (_connection, entry) => { journal = entry; };
    auditService.log = async (payload) => { audited = payload; };
    t.after(() => {
        returnsService._increaseInventoryForReturn = originals.impact;
        returnsService._nextCreditNoteNumber = originals.number;
        accountingService.createJournalEntry = originals.journal;
        auditService.log = originals.audit;
    });

    const result = await returnsService.approveReturn('r', 'u', '127.0.0.1');
    // net = 2 * 50 = 100 (rejected item excluded); VAT 21% = 21; gross refund = 121.
    assert.equal(result.total_amount, 121);
    assert.equal(result.restocked_quantity, 2);
    assert.equal(result.discarded_quantity, 1);
    const creditNote = calls.find(({ sql }) => sql.includes('INSERT INTO credit_notes'));
    assert.equal(creditNote.params[3], 4);
    assert.equal(creditNote.params[4], 'A');
    assert.equal(creditNote.params[7], 121, 'credit_notes.amount must be the gross total');
    assert.ok(calls.some(({ sql, params }) => sql.includes('UPDATE clients') && params[0] === 121));
    assert.equal(journal.lines.length, 3);
    assert.equal(journal.lines[0].account_code, '4.1.01.01');
    assert.equal(journal.lines[0].debit, 100);
    assert.equal(journal.lines[1].account_code, '2.1.02.02');
    assert.equal(journal.lines[1].debit, 21);
    assert.equal(journal.lines[2].account_code, '1.1.03.01');
    assert.equal(journal.lines[2].credit, 121);
    const totalDebit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = journal.lines.reduce((sum, l) => sum + l.credit, 0);
    assert.equal(totalDebit, totalCredit, 'journal entry must balance');
    assert.equal(audited.ip_address, '127.0.0.1');
});

test('approveReturn handles rejected-only documents without monetary credit', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('SELECT * FROM client_returns')) return [[{ id: 'r', status: 'pending', client_id: null }]];
        if (String(sql).includes('SELECT * FROM client_return_items')) return [[{
            product_id: 'p', quantity: 1, unit_price: 20, condition_status: 'rejected',
        }]];
        return [[]];
    });
    const originals = { impact: returnsService._increaseInventoryForReturn, audit: auditService.log };
    returnsService._increaseInventoryForReturn = async () => ({ restocked: 0, discarded: 1 });
    auditService.log = async () => {};
    t.after(() => {
        returnsService._increaseInventoryForReturn = originals.impact;
        auditService.log = originals.audit;
    });
    const result = await returnsService.approveReturn('r');
    assert.equal(result.total_amount, 0);
    assert.equal(result.credit_note_id, null);
    assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO credit_notes')), false);
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
        if (statement.startsWith("UPDATE credit_notes SET status = 'authorizing'")) return [{ affectedRows: 1 }];
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
        if (statement.startsWith("UPDATE credit_notes SET status = 'authorizing'")) return [{ affectedRows: 1 }];
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

test('authorizeCreditNote authorizes non-fiscal legacy notes without a CAE', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) {
            return [[{ id: 'cn-legacy', status: 'issued', reference_type: 'manual', amount: 10 }]];
        }
        if (statement.startsWith("UPDATE credit_notes SET status = 'authorizing'")) return [{ affectedRows: 1 }];
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ?')) {
            return [[{ id: 'cn-legacy', status: 'authorized', cae: null }]];
        }
        return [[]];
    });
    const originalAudit = auditService.log;
    auditService.log = async () => {};
    t.after(() => { auditService.log = originalAudit; });
    const result = await creditNotesService.authorizeCreditNote('cn-legacy', 'u');
    assert.equal(result.status, 'authorized');
    assert.equal(result.cae, null);
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE credit_notes') && params[0] === null && params[1] === null));
});

test('authorizeCreditNote claims atomically so a concurrent second call is rejected with 409 and AFIP is called once', async (t) => {
    let claimAttempts = 0;
    let afipCalls = 0;
    mockPool(t, async (sql) => {
        const statement = String(sql);
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) {
            return [[{
                id: 'cn-race', status: 'issued', reference_type: 'return', reference_id: 'r-1',
                credit_note_type: 'B', amount: 50, number: 'NC-2'
            }]];
        }
        if (statement.startsWith("UPDATE credit_notes SET status = 'authorizing'")) {
            claimAttempts += 1;
            // Only the first claim to reach the database succeeds, mirroring the
            // atomic `WHERE status NOT IN (...)` guard against a real DB.
            return [{ affectedRows: claimAttempts === 1 ? 1 : 0 }];
        }
        if (statement.includes('SELECT order_id FROM client_returns')) return [[{ order_id: 'o-1' }]];
        if (statement.includes('SELECT * FROM invoices WHERE order_id')) return [[{ client_tax_id: '20111111112' }]];
        if (statement.includes('SELECT * FROM company_settings')) return [[{}]];
        if (statement.includes('FROM client_return_items ri')) return [[]];
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ?')) return [[{ id: 'cn-race', status: 'authorized', cae: '999' }]];
        return [[]];
    });
    const originalAfip = afipService.authorizeVoucher;
    const originalAudit = auditService.log;
    afipService.authorizeVoucher = async () => {
        afipCalls += 1;
        return { cae: '999', cae_expiration_date: '2026-09-01' };
    };
    auditService.log = async () => {};
    t.after(() => {
        afipService.authorizeVoucher = originalAfip;
        auditService.log = originalAudit;
    });

    const results = await Promise.allSettled([
        creditNotesService.authorizeCreditNote('cn-race', 'u1'),
        creditNotesService.authorizeCreditNote('cn-race', 'u2'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.errorCode, 'CREDIT_NOTE_ALREADY_AUTHORIZING');
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.equal(afipCalls, 1);
});

test('authorizeCreditNote reverts status to the previous value when AFIP rejects the request', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.startsWith('SELECT * FROM credit_notes WHERE id = ? AND')) return [[{
            id: 'cn-fail', status: 'issued', reference_type: 'return', reference_id: 'r-1', amount: 10, number: 'NC-3'
        }]];
        if (statement.startsWith("UPDATE credit_notes SET status = 'authorizing'")) return [{ affectedRows: 1 }];
        if (statement.includes('SELECT order_id FROM client_returns')) return [[{ order_id: 'o-1' }]];
        if (statement.includes('SELECT * FROM invoices WHERE order_id')) return [[{ id: 'i-1' }]];
        if (statement.includes('SELECT * FROM company_settings')) return [[]];
        if (statement.includes('FROM client_return_items ri')) return [[{ quantity: 1, unit_price: 10, vat_rate: 21 }]];
        return [[]];
    });
    const originalAfip = afipService.authorizeVoucher;
    afipService.authorizeVoucher = async () => { throw new Error('rechazo QA'); };
    t.after(() => { afipService.authorizeVoucher = originalAfip; });

    await assert.rejects(() => creditNotesService.authorizeCreditNote('cn-fail', 'u'), /AFIP rechazó.*rechazo QA/);
    const revert = calls.find(({ sql, params }) => sql.startsWith('UPDATE credit_notes SET status = ?') && params?.[1] === 'cn-fail');
    assert.ok(revert, 'expected the credit note status to be reverted after an AFIP failure');
    assert.equal(revert.params[0], 'issued');
});
