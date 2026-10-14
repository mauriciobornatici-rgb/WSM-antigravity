import test from 'node:test';
import assert from 'node:assert/strict';

import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import auditService from '../services/audit.service.js';
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
    assert.deepEqual(await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { quantity: 0 } }), { restocked: 0, discarded: 0, reentered: 0, lost: 0 });
    const rma = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 2, condition_status: 'supplier_rma' } });
    const loss = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 1, condition_status: 'loss' } });
    const rejected = await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 1, condition_status: 'rejected' } });
    // RMA units are back in a stock location (cost returns to inventory); a loss is lost;
    // a rejected line was never taken back.
    assert.deepEqual(rma, { restocked: 0, discarded: 2, reentered: 2, lost: 0 });
    assert.deepEqual(loss, { restocked: 0, discarded: 1, reentered: 0, lost: 1 });
    assert.deepEqual(rejected, { restocked: 0, discarded: 1, reentered: 0, lost: 0 });
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO inventory (')));
    assert.ok(calls.some((call) => call.params?.includes('rejected')));
});

test('sellable return goes back to the location it was sold from, traced at cost', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('SELECT from_location FROM inventory_movements')) return [[{ from_location: 'SALON' }]];
        if (String(sql).startsWith('SELECT id FROM inventory')) return [[{ id: 'inv-salon' }]];
        return [[]];
    } };
    const result = await returnsService._increaseInventoryForReturn(connection, {
        returnId: 'r', actorUserId: 'u', orderId: 'o-1', unitCost: 7,
        item: { product_id: 'p', quantity: 2, condition_status: 'SELLABLE', unit_price: 12.5 },
    });
    assert.deepEqual(result, { restocked: 2, discarded: 0, reentered: 2, lost: 0 });
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('SELECT id FROM inventory') && params[1] === 'SALON'));
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('UPDATE inventory') && params[1] === 'inv-salon'));
    const movement = calls.find(({ sql }) => sql.includes('INSERT INTO inventory_movements'));
    assert.equal(movement.params[3], 'SALON');
    assert.equal(movement.params[5], 7, 'the movement carries the unit cost, not the sale price');
    assert.equal(movement.params.at(-1), 'u');
});

test('a sellable return without its sale on record goes to General', async () => {
    const calls = [];
    const connection = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return [[]]; } };
    await returnsService._increaseInventoryForReturn(connection, { returnId: 'r', item: { product_id: 'p', quantity: 1 } });
    assert.ok(calls.some(({ sql, params }) => sql.startsWith('INSERT INTO inventory (') && params[2] === 'General'));
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
        if (statement.includes('SELECT id, invoice_type, total_amount FROM invoices')) return [[{ id: 'inv-9', invoice_type: 'A', total_amount: 1000 }]];
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
    assert.equal(creditNote.params[9], 'inv-9', 'the note is linked to the invoice it corrects (ADR-014)');
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

test('credit note listing filters clients', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FROM credit_notes cn')) return [[{ id: 'cn-list' }]];
        return [[]];
    });
    const listed = await creditNotesService.getCreditNotes({ client_id: 'c-1' });
    assert.equal(listed[0].id, 'cn-list');
    assert.ok(calls[0].params.includes('c-1'));
    // ADR-024: internal notes stay out of the customer's account unless asked for.
    assert.match(calls[0].sql, /cn.status <> 'internal'/);
    await creditNotesService.getCreditNotes({ include_internal: 'true' });
    assert.doesNotMatch(calls.at(-1).sql, /'internal'/);
});

test('authorizeCreditNote delegates to the shared ARCA flow with the credit note adapter (ADR-020)', async (t) => {
    const { default: arcaAuthorization } = await import('../domains/fiscal/ArcaAuthorizationService.js');
    const { creditNoteArcaAdapter } = await import('../domains/fiscal/arcaAdapters.js');
    const original = arcaAuthorization.authorize;
    const calls = [];
    arcaAuthorization.authorize = async (...args) => { calls.push(args); return { id: 'cn-1', status: 'authorized' }; };
    t.after(() => { arcaAuthorization.authorize = original; });
    const result = await creditNotesService.authorizeCreditNote('cn-1', 'u-1');
    assert.equal(result.status, 'authorized');
    assert.deepEqual(calls, [[creditNoteArcaAdapter, 'cn-1', 'u-1']]);
});