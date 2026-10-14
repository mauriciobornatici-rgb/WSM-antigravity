import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool } from './helpers/qaDb.js';
import afipService from '../services/afip.service.js';
import { ArcaAuthorizationService } from '../domains/fiscal/ArcaAuthorizationService.js';
import { invoiceArcaAdapter, creditNoteArcaAdapter } from '../domains/fiscal/arcaAdapters.js';


/**
 * An in-memory ARCA: vouchers per point of sale and type. Each test gets its own point of
 * sale (billing_pos is read from company_settings, so the tests set it), so numbers start at 0.
 */
function fakeArca() {
    const vouchers = new Map();
    const key = (request) => `${request.pos}:${request.voucherType}`;
    const list = (request) => vouchers.get(key(request)) || vouchers.set(key(request), []).get(key(request));
    const arca = Object.create(afipService);
    arca.mode = 'ok';
    arca.calls = [];
    arca.lastVoucherNumber = async (request) => {
        if (arca.mode === 'unreachable') throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
        return list(request).length;
    };
    arca.voucherAt = async (request, number) => {
        if (arca.mode === 'down') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        return list(request)[number - 1] || null;
    };
    arca.requestCae = async (request, number, requestDate) => {
        arca.calls.push(number);
        if (arca.mode === 'reject') throw Object.assign(new Error('(10016) El numero no es el siguiente'), { code: 10016 });
        // 'late': ARCA refuses this attempt but an earlier, duplicated delivery already issued it.
        if (arca.mode === 'late') {
            arca.mode = 'ok';
            await arca.requestCae(request, number, requestDate);
            throw Object.assign(new Error('(10016) duplicado'), { code: 10016 });
        }
        if (arca.mode === 'down') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        if (number !== list(request).length + 1) throw Object.assign(new Error('(10016) correlatividad'), { code: 10016 });
        const cae = String(70000000000000 + number + request.pos * 1000);
        list(request).push({
            CbteTipo: request.voucherType, PtoVta: request.pos, CbteDesde: number, CbteFch: String(requestDate),
            ImpTotal: request.amounts.roundedTotal, DocTipo: request.docType, DocNro: request.docNumber,
            CodAutorizacion: cae, FchVto: '20261231',
            ...(request.associated ? { CbtesAsoc: { CbteAsoc: [{ PtoVta: request.associated.point_of_sale, Nro: request.associated.invoice_number }] } } : {}),
        });
        // 'lost': ARCA issued it, but the answer never arrives.
        if (arca.mode === 'lost') throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        return { cae, cae_expiration_date: '2026-12-31', number };
    };
    arca.issued = (request) => list(request);
    return arca;
}

let pos;
let previousPos;
let createdSettings = false;
test.before(async () => {
    // Earlier runs leave documents in alert on their test points of sale (>= 9000): out of the
    // way, so the alert list (capped at 100) shows what this run creates.
    await pool.query(
        `UPDATE invoices SET deleted_at = NOW()
         WHERE point_of_sale >= 9000 AND deleted_at IS NULL AND cae IS NULL AND status IN ('arca_conflict', 'authorizing', 'issued')`
    );
    await pool.query(
        `UPDATE invoices SET deleted_at = NOW()
         WHERE point_of_sale >= 9000 AND deleted_at IS NULL AND status = 'arca_conflict'`
    );
    const [rows] = await pool.query('SELECT billing_pos FROM company_settings LIMIT 1');
    previousPos = rows[0]?.billing_pos ?? null;
    if (rows.length === 0) {
        // The QA database may have no company row: the flow reads the point of sale from it.
        await pool.query('INSERT INTO company_settings (id) VALUES (1)');
        createdSettings = true;
    }
});
test.after(async () => {
    if (createdSettings) await pool.query('DELETE FROM company_settings WHERE id = 1');
    else await pool.query('UPDATE company_settings SET billing_pos = ?', [previousPos]);
    await closePool();
});

// A point of sale no document has used yet (earlier runs leave theirs in the QA database).
async function freshPointOfSale() {
    const [[row]] = await pool.query(
        `SELECT GREATEST(9000, COALESCE((SELECT MAX(point_of_sale) FROM invoices), 0),
                COALESCE((SELECT MAX(point_of_sale) FROM credit_notes), 0)) + 1 AS next_pos`
    );
    pos = Number(row.next_pos);
    await pool.query('UPDATE company_settings SET billing_pos = ?', [pos]);
    return pos;
}

async function seedInvoice({ total = 121, provisional = null, type = 'B' } = {}) {
    const id = crypto.randomUUID();
    const number = provisional ?? 100000 + Math.floor(Math.random() * 800000);
    await pool.query(
        `INSERT INTO invoices (id, client_name, invoice_type, point_of_sale, invoice_number, net_amount, vat_amount, total_amount, status)
         VALUES (?, 'Consumidor Final', ?, ?, ?, ?, ?, ?, 'issued')`,
        [id, type, pos, number, Math.round(total / 1.21 * 100) / 100, Math.round((total - total / 1.21) * 100) / 100, total]
    );
    await pool.query(
        `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, vat_rate, vat_amount, total_line)
         VALUES (?, ?, 'Producto QA', 1, ?, 21, ?, ?)`,
        [crypto.randomUUID(), id, Math.round(total / 1.21 * 10000) / 10000, Math.round((total - total / 1.21) * 100) / 100, total]
    );
    return id;
}

async function invoiceRow(id) {
    const [[row]] = await pool.query('SELECT status, cae, invoice_number, arca_expected_number, arca_last_error FROM invoices WHERE id = ?', [id]);
    return row;
}

test('ARCA: an invoice is authorized with the next number and its CAE', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice();
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.equal(invoice.status, 'authorized');
    assert.equal(invoice.invoice_number, 1);
    assert.ok(invoice.cae);
    // Authorizing again does not ask ARCA again.
    await service.authorize(invoiceArcaAdapter, id, null);
    assert.deepEqual(arca.calls, [1]);
});

test('ARCA: a lost answer is recovered from ARCA, never issued twice', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice({ total: 242 });
    arca.mode = 'lost';
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.equal(invoice.status, 'authorized', 'adopted right away by asking ARCA about the number');
    assert.equal(invoice.invoice_number, 1);
    assert.equal(arca.issued({ pos, voucherType: 6 }).length, 1);
});

test('ARCA down: the invoice waits in verification and the worker settles it when ARCA returns', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const issuedButUnknown = await seedInvoice({ total: 363 });
    const neverArrived = await seedInvoice({ total: 484 });

    // The first one reached ARCA, but ARCA went down before answering or being asked.
    arca.mode = 'lost';
    const realVoucherAt = arca.voucherAt;
    arca.voucherAt = async () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); };
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, issuedButUnknown, null), (err) => err.statusCode === 503);
    assert.equal((await invoiceRow(issuedButUnknown)).status, 'authorizing');

    // The second one: ARCA down from the start, the request never arrived.
    arca.mode = 'down';
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, neverArrived, null), (err) => err.statusCode === 503);
    assert.equal((await invoiceRow(neverArrived)).status, 'authorizing');

    // ARCA is back: the worker adopts the issued one and releases the other, without creating anything.
    arca.mode = 'ok';
    arca.voucherAt = realVoucherAt;
    await pool.query('UPDATE invoices SET arca_requested_at = NOW() - INTERVAL 5 MINUTE WHERE id IN (?, ?)', [issuedButUnknown, neverArrived]);
    const callsBefore = arca.calls.length;
    await service.recoverPending([invoiceArcaAdapter]);
    assert.equal(arca.calls.length, callsBefore, 'the worker never asks for a new CAE');
    const adopted = await invoiceRow(issuedButUnknown);
    assert.deepEqual([adopted.status, adopted.invoice_number], ['authorized', 1]);
    const released = await invoiceRow(neverArrived);
    assert.equal(released.status, 'issued');
    assert.equal(released.arca_expected_number, null);
    // Authorizing it again now gets number 2.
    assert.equal((await service.authorize(invoiceArcaAdapter, neverArrived, null)).invoice_number, 2);
});

test('ARCA: a rejection releases the invoice with the reason (the number was not used)', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice();
    arca.mode = 'reject';
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 422 && err.responseBody.error === 'arca_rejected');
    const row = await invoiceRow(id);
    assert.equal(row.status, 'issued');
    assert.match(row.arca_last_error, /rechazó/);
});

test('ARCA: two identical tickets never share a CAE', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const first = await seedInvoice({ total: 1000 });
    const second = await seedInvoice({ total: 1000 });
    // The first saved number 1 and crashed before reaching ARCA.
    await pool.query("UPDATE invoices SET status = 'authorizing', arca_expected_number = 1, arca_request_date = ?, arca_requested_at = NOW() - INTERVAL 5 MINUTE WHERE id = ?",
        [Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).replace(/-/g, '')), first]);
    // The second (same amount, same consumer, same day) gets number 1 from ARCA.
    const secondInvoice = await service.authorize(invoiceArcaAdapter, second, null);
    assert.equal(secondInvoice.invoice_number, 1);
    // The first one's recovery finds number 1 identical to what it asked for, but it belongs to the second.
    await service.recoverPending([invoiceArcaAdapter]);
    const firstRow = await invoiceRow(first);
    assert.equal(firstRow.status, 'issued', 'not adopted: that voucher is the other ticket');
    const firstInvoice = await service.authorize(invoiceArcaAdapter, first, null);
    assert.equal(firstInvoice.invoice_number, 2);
    assert.notEqual(firstInvoice.cae, secondInvoice.cae);
});

test('ARCA: the number ARCA gives moves a pending invoice off it, and new provisional numbers follow ARCA', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const pendingWithOne = await seedInvoice({ provisional: 1 });
    const id = await seedInvoice({ provisional: 50 });
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.equal(invoice.invoice_number, 1);
    const moved = await invoiceRow(pendingWithOne);
    assert.equal(moved.status, 'issued');
    assert.ok(moved.invoice_number > 50, 'moved to a fresh provisional number');
});

test('ARCA: a credit note keeps the voucher number ARCA gave it and names its invoice', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const invoiceId = await seedInvoice({ total: 605 });
    await service.authorize(invoiceArcaAdapter, invoiceId, null);
    const noteId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO credit_notes (id, number, reference_type, amount, status, invoice_id, credit_note_type, point_of_sale)
         VALUES (?, ?, 'manual', 121, 'issued', ?, 'B', ?)`,
        [noteId, `NC-QA-${noteId.slice(0, 8)}`, invoiceId, pos]
    );
    const note = await service.authorize(creditNoteArcaAdapter, noteId, null);
    assert.equal(note.status, 'authorized');
    assert.equal(note.arca_voucher_number, 1);
    const [voucher] = arca.issued({ pos, voucherType: 8 });
    assert.equal(voucher.CbtesAsoc.CbteAsoc[0].Nro, 1);
});

test('ARCA: a Factura A without the customer CUIT is refused before asking ARCA', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice({ type: 'A' });
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 400 && err.errorCode === 'ARCA_CUIT_REQUIRED');
    assert.equal((await invoiceRow(id)).status, 'issued');
    assert.deepEqual(arca.calls, []);
});

// ---- AUD-008 ----

const argentinaToday = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).replace(/-/g, ''));

test('AUD-008: a number ARCA may still be processing is not given up before the cool-down', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice();
    await pool.query("UPDATE invoices SET status = 'authorizing', arca_expected_number = 1, arca_request_date = ?, arca_requested_at = NOW() WHERE id = ?", [argentinaToday(), id]);
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 409 && err.responseBody.error === 'arca_verifying');
    assert.deepEqual(arca.calls, [], 'no new number while the first may still arrive');
    assert.equal((await invoiceRow(id)).arca_expected_number, 1);
});

test('AUD-008: a busy point of sale leaves the document untouched', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice();
    await pool.query("UPDATE invoices SET status = 'authorizing', arca_expected_number = 7, arca_request_date = 20260101, arca_requested_at = NOW() - INTERVAL 1 HOUR WHERE id = ?", [id]);
    const holder = await pool.getConnection();
    try {
        await holder.query('SELECT GET_LOCK(?, 0)', [`arca:${pos}:6`]);
        await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null, { lockTimeout: 0 }), (err) => err.statusCode === 409 && err.responseBody.error === 'arca_busy');
    } finally {
        await holder.query('SELECT RELEASE_LOCK(?)', [`arca:${pos}:6`]);
        holder.release();
    }
    const row = await invoiceRow(id);
    assert.deepEqual([row.status, row.arca_expected_number], ['authorizing', 7], 'the pending number is kept');
});

test('AUD-008: a refusal is checked first: a voucher that did get issued is adopted, not asked again', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice({ total: 777 });
    arca.mode = 'late';
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.deepEqual([invoice.status, invoice.invoice_number], ['authorized', 1]);
    assert.equal(arca.issued({ pos, voucherType: 6 }).length, 1);
});

test('AUD-008: a voucher issued with a number another local document holds is kept in conflict, never asked again', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice({ total: 888 });
    // An old local invoice already says it is number 1 of this point of sale, with another CAE.
    const stale = await seedInvoice({ provisional: 1 });
    await pool.query("UPDATE invoices SET status = 'authorized', cae = '99999999999999' WHERE id = ?", [stale]);
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 409 && err.responseBody.error === 'arca_conflict');
    const [[row]] = await pool.query('SELECT status, cae FROM invoices WHERE id = ?', [id]);
    assert.equal(row.status, 'arca_conflict');
    assert.ok(row.cae, 'the CAE ARCA issued is kept');
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.responseBody?.error === 'arca_conflict');
    assert.equal(arca.issued({ pos, voucherType: 6 }).length, 1, 'never a second voucher');
});

test('AUD-008: a pending number is checked at the point of sale it was asked for, even after a change', async () => {
    const firstPos = await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice({ total: 999 });
    arca.mode = 'lost';
    const realVoucherAt = arca.voucherAt;
    arca.voucherAt = async () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); };
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 503);
    // The company changes its point of sale while the voucher is in verification.
    await freshPointOfSale();
    arca.mode = 'ok';
    arca.voucherAt = realVoucherAt;
    await pool.query('UPDATE invoices SET arca_requested_at = NOW() - INTERVAL 5 MINUTE WHERE id = ?', [id]);
    await service.recoverPending([invoiceArcaAdapter]);
    const [[row]] = await pool.query('SELECT status, point_of_sale, invoice_number FROM invoices WHERE id = ?', [id]);
    assert.deepEqual([row.status, Number(row.point_of_sale), row.invoice_number], ['authorized', firstPos, 1]);
});

test('AUD-008: if ARCA cannot be reached before asking, the document stays pending (nothing was requested)', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const service = new ArcaAuthorizationService({ afipService: arca });
    const id = await seedInvoice();
    arca.mode = 'unreachable';
    await assert.rejects(() => service.authorize(invoiceArcaAdapter, id, null), (err) => err.statusCode === 503 && err.responseBody.error === 'arca_unreachable');
    const row = await invoiceRow(id);
    assert.deepEqual([row.status, row.arca_expected_number], ['issued', null]);
});

test('ADR-021: the alerts list conflicts and verifications ARCA did not settle in time, not fresh ones', async () => {
    await freshPointOfSale();
    const service = new ArcaAuthorizationService({ afipService: fakeArca() });
    const conflict = await seedInvoice({ total: 111 });
    const stuck = await seedInvoice({ total: 222 });
    const fresh = await seedInvoice({ total: 333 });
    await pool.query("UPDATE invoices SET status = 'arca_conflict', arca_requested_at = NOW() WHERE id = ?", [conflict]);
    await pool.query("UPDATE invoices SET status = 'authorizing', arca_requested_at = NOW() - INTERVAL 30 MINUTE WHERE id = ?", [stuck]);
    await pool.query("UPDATE invoices SET status = 'authorizing', arca_requested_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [fresh]);
    const alerts = await service.listAlerts();
    const byId = new Map(alerts.items.map((item) => [item.id, item]));
    assert.equal(byId.get(conflict)?.status, 'arca_conflict');
    assert.equal(byId.get(stuck)?.status, 'authorizing');
    assert.equal(byId.get(stuck)?.amount, 222);
    assert.equal(byId.has(fresh), false, 'still within the recovery window');
    assert.ok(alerts.conflicts >= 1 && alerts.stuck >= 1);
    // Settled documents leave the list.
    await pool.query("UPDATE invoices SET status = 'issued', arca_requested_at = NULL WHERE id IN (?, ?, ?)", [conflict, stuck, fresh]);
    const after = await service.listAlerts();
    assert.equal(after.items.some((item) => [conflict, stuck].includes(item.id)), false);
});

test('ADR-021: ARCA receives the receiver VAT condition copied from the customer', async () => {
    await freshPointOfSale();
    const arca = fakeArca();
    const seen = [];
    const realRequestCae = arca.requestCae;
    arca.requestCae = async (request, number, requestDate) => {
        seen.push(request.receiverVatCondition);
        return realRequestCae(request, number, requestDate);
    };
    const service = new ArcaAuthorizationService({ afipService: arca });
    // A Monotributista receives a B (ADR-022) and ARCA gets its real code.
    const id = await seedInvoice({ total: 1210, type: 'B' });
    await pool.query("UPDATE invoices SET client_tax_id = '20123456786', client_tax_condition = 'Monotributista' WHERE id = ?", [id]);
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.equal(invoice.status, 'authorized');
    // A Responsable Inscripto with an A.
    const company = await seedInvoice({ total: 2420, type: 'A' });
    await pool.query("UPDATE invoices SET client_tax_id = '30712345674', client_tax_condition = 'Responsable Inscripto' WHERE id = ?", [company]);
    assert.equal((await service.authorize(invoiceArcaAdapter, company, null)).status, 'authorized');
    assert.deepEqual(seen, [6, 1]);
});

test('AUD-009: a rejection with no CAE is an alert, shown with the number asked of ARCA', async () => {
    await freshPointOfSale();
    const service = new ArcaAuthorizationService({ afipService: fakeArca() });
    const rejected = await seedInvoice({ total: 444 });
    const ticket = await seedInvoice({ total: 555 });
    await pool.query("UPDATE invoices SET arca_last_error = '(10243) Condición IVA del receptor inválida', arca_expected_number = 7, arca_pos = ? WHERE id = ?", [pos, rejected]);
    await pool.query("UPDATE invoices SET cae = '123', arca_last_error = 'viejo' WHERE id = ?", [ticket]);
    const alerts = await service.listAlerts();
    const item = alerts.items.find((row) => row.id === rejected);
    assert.equal(item?.status, 'issued');
    assert.equal(Number(item.number), 7);
    assert.equal(Number(item.point_of_sale), pos);
    assert.equal(alerts.items.some((row) => row.id === ticket), false, 'with a CAE it is not pending');
    assert.ok(alerts.rejected >= 1);
    await pool.query("UPDATE invoices SET arca_last_error = NULL WHERE id IN (?, ?)", [rejected, ticket]);
});

test('ADR-021: the customer VAT condition column exists without a foreign key (AUD-009)', async () => {
    const [[column]] = await pool.query("SHOW COLUMNS FROM clients LIKE 'tax_condition_id'");
    assert.equal(column.Null, 'YES');
    const [fks] = await pool.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'tax_condition_id' AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    assert.equal(fks.length, 0);
});
test('ADR-022: with ARCA configured, an electronic invoice a day old without any attempt is an alert; a ticket is not', async () => {
    await freshPointOfSale();
    const [[previous]] = await pool.query('SELECT billing_afip_crt AS crt, billing_afip_key AS k, arca_configured_at AS at FROM company_settings LIMIT 1');
    const service = new ArcaAuthorizationService({ afipService: fakeArca() });
    const forgotten = await seedInvoice({ total: 666 });
    const recent = await seedInvoice({ total: 777 });
    const ticket = await seedInvoice({ total: 888, type: 'TK' });
    const beforeArca = await seedInvoice({ total: 999 });
    await pool.query('UPDATE invoices SET created_at = NOW() - INTERVAL 30 HOUR WHERE id IN (?, ?)', [forgotten, ticket]);
    await pool.query('UPDATE invoices SET created_at = NOW() - INTERVAL 50 HOUR WHERE id = ?', [beforeArca]);
    try {
        await pool.query('UPDATE company_settings SET billing_afip_crt = NULL, billing_afip_key = NULL, arca_configured_at = NULL');
        const notConfigured = await service.listAlerts();
        assert.equal(notConfigured.items.some((item) => item.id === forgotten), false, 'before ARCA is configured nothing is "unauthorized"');

        // Configured 40 h ago: only what was issued since then counts (user decision).
        await pool.query("UPDATE company_settings SET billing_afip_crt = 'crt-qa', billing_afip_key = 'key-qa', arca_configured_at = NOW() - INTERVAL 40 HOUR");
        const alerts = await service.listAlerts();
        const byId = new Map(alerts.items.map((item) => [item.id, item]));
        assert.equal(byId.get(forgotten)?.alert, 'unauthorized');
        assert.equal(byId.has(recent), false);
        assert.equal(byId.has(ticket), false);
        assert.equal(byId.has(beforeArca), false, 'issued before ARCA was configured');
        assert.ok(alerts.unauthorized >= 1);
    } finally {
        await pool.query('UPDATE company_settings SET billing_afip_crt = ?, billing_afip_key = ?, arca_configured_at = ?', [previous?.crt ?? null, previous?.k ?? null, previous?.at ?? null]);
        await pool.query("UPDATE invoices SET status = 'cancelled', deleted_at = NOW() WHERE id IN (?, ?, ?, ?)", [forgotten, recent, ticket, beforeArca]);
    }
});
test('AUD-010: the label of an annulled invoice stays as it was when ARCA moves its provisional number', async () => {
    const posUsed = await freshPointOfSale();
    const service = new ArcaAuthorizationService({ afipService: fakeArca() });
    const annulled = await seedInvoice({ provisional: 1 });
    const label = `B-${String(posUsed).padStart(4, '0')}-00000001`;
    await pool.query("UPDATE invoices SET status = 'cancelled', deleted_at = NOW(), annulled_label = ? WHERE id = ?", [label, annulled]);
    const id = await seedInvoice({ total: 999, provisional: 2 });
    await pool.query('UPDATE invoices SET replaces_invoice_id = ? WHERE id = ?', [annulled, id]);
    const invoice = await service.authorize(invoiceArcaAdapter, id, null);
    assert.deepEqual([invoice.status, invoice.invoice_number], ['authorized', 1]);
    const [[row]] = await pool.query('SELECT invoice_number FROM invoices WHERE id = ?', [annulled]);
    assert.notEqual(row.invoice_number, 1, 'the number is unique: the annulled one moves');
    const { default: salesService } = await import('../services/sales.service.js');
    assert.equal((await salesService.getInvoiceById(id)).replaces_label, label, 'the trace keeps the label it had');
});