import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, saleMovementsOf, seedProduct, stockOf } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import { PosCheckoutUseCase } from '../domains/sales/PosCheckoutUseCase.js';
import salesService from '../services/sales.service.js';

const createOrderUseCase = new CreateOrderUseCase({ onStockChanged: async () => {} });
const checkout = new PosCheckoutUseCase({ createOrderUseCase });

test.after(async () => {
    await closePool();
});

async function seedShift({ status = 'open', registerId = crypto.randomUUID() } = {}) {
    const [registers] = await pool.query('SELECT id FROM cash_registers WHERE id = ?', [registerId]);
    if (registers.length === 0) {
        await pool.query('INSERT INTO cash_registers (id, name) VALUES (?, ?)', [registerId, `Caja QA ${registerId.slice(0, 8)}`]);
    }
    const shiftId = crypto.randomUUID();
    await pool.query(
        'INSERT INTO cash_shifts (id, cash_register_id, status, opening_balance, expected_balance, opened_at) VALUES (?, ?, ?, 1000, 1000, NOW() - INTERVAL 1 HOUR)',
        [shiftId, registerId, status]
    );
    return { shiftId, registerId };
}

async function shiftPayments(orderId) {
    const [rows] = await pool.query(
        'SELECT shift_id, payment_method, amount FROM shift_payments WHERE order_id = ? ORDER BY payment_method',
        [orderId]
    );
    return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

function payload(productId, shiftId, extra = {}) {
    return {
        idempotency_key: crypto.randomUUID(),
        shift_id: shiftId,
        customer_name: 'Consumidor final',
        items: [{ product_id: productId, quantity: 2, unit_price: 100 }],
        // 2 × 100 net + 21 % = 242, paid in two cash lines and one card line.
        payments: [{ method: 'cash', amount: 100 }, { method: 'cash', amount: 42 }, { method: 'card', amount: 100 }],
        emit_invoice: true,
        invoice_type: 'B',
        point_of_sale: 99,
        ...extra,
    };
}

test('one call records the sale, deducts stock, invoices and consolidates cash payments', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const { shiftId } = await seedShift();

    const result = await checkout.execute(payload(productId, shiftId), null, { role: 'cashier' });

    assert.equal(result.total_amount, 242);
    assert.ok(result.invoice?.id);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.equal((await saleMovementsOf(productId)).length, 1);
    assert.deepEqual(await shiftPayments(result.order_id), [
        { shift_id: shiftId, payment_method: 'card', amount: 100 },
        { shift_id: shiftId, payment_method: 'cash', amount: 142 },
    ]);
    assert.equal(result.expected_balance, 1142);
    const [[order]] = await pool.query('SELECT status, invoice_id FROM orders WHERE id = ?', [result.order_id]);
    assert.deepEqual([order.status, order.invoice_id], ['completed', result.invoice.id]);
});

test('a failure while invoicing rolls back the whole checkout: no sale, no stock change, no cash', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const { shiftId } = await seedShift();
    const failing = new PosCheckoutUseCase({
        createOrderUseCase,
        salesService: { createInvoice: async () => { throw new Error('ARCA caído'); } },
    });
    const request = payload(productId, shiftId);

    await assert.rejects(() => failing.execute(request, null, { role: 'cashier' }), /ARCA caído/);

    assert.deepEqual(await stockOf(productId), { quantity: 5, reserved: 0 });
    const [orders] = await pool.query("SELECT id FROM orders WHERE external_source = 'pos' AND external_id = ?", [request.idempotency_key]);
    assert.equal(orders.length, 0);
    assert.equal((await saleMovementsOf(productId)).length, 0);
});

test('a replay completes what an interrupted legacy checkout left missing, without duplicating anything', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const { shiftId } = await seedShift();
    const request = payload(productId, shiftId);
    // Old client flow: the order call succeeded, the invoice and cash calls never arrived.
    await createOrderUseCase.execute({
        external_source: 'pos', external_id: request.idempotency_key, items: request.items, payments: request.payments,
    }, null, { role: 'cashier' });

    const first = await checkout.execute(request, null, { role: 'cashier' });
    const second = await checkout.execute(request, null, { role: 'cashier' });

    assert.equal(first.idempotent_replay, true);
    assert.equal(second.order_id, first.order_id);
    assert.equal(second.invoice.id, first.invoice.id);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.equal((await shiftPayments(first.order_id)).length, 2);
    const [invoices] = await pool.query('SELECT id FROM invoices WHERE order_id = ?', [first.order_id]);
    assert.equal(invoices.length, 1);
});

test('a closed shift rejects an online sale but takes an offline one into the open shift of the same register', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const closed = await seedShift({ status: 'closed' });
    const open = await seedShift({ registerId: closed.registerId });

    await assert.rejects(
        () => checkout.execute(payload(productId, closed.shiftId, { emit_invoice: false }), null, { role: 'cashier' }),
        (err) => err.errorCode === 'CASH_SHIFT_NOT_OPEN' && err.statusCode === 409
    );

    const offline = payload(productId, closed.shiftId, {
        emit_invoice: false,
        offline_captured_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const result = await checkout.execute(offline, null, { role: 'cashier' });
    assert.equal(result.shift_id, open.shiftId);
    const [[audit]] = await pool.query(
        "SELECT new_values FROM audit_logs WHERE action = 'POS_CHECKOUT' AND entity_id = ?",
        [result.order_id]
    );
    const values = typeof audit.new_values === 'string' ? JSON.parse(audit.new_values) : audit.new_values;
    assert.equal(values.original_shift_id, closed.shiftId);
});

test('a double click with the same key produces exactly one sale', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const { shiftId } = await seedShift();
    const request = payload(productId, shiftId, { emit_invoice: false });

    const results = await Promise.all([
        checkout.execute(request, null, { role: 'cashier' }),
        checkout.execute(request, null, { role: 'cashier' }),
    ]);

    assert.equal(results[0].order_id, results[1].order_id);
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
    assert.equal((await shiftPayments(results[0].order_id)).length, 2);
});

test('the sales service stays the only invoice writer used by the checkout', () => {
    // Guards the default wiring: the checkout must reuse createInvoice (with its fiscal rules).
    assert.equal(new PosCheckoutUseCase().salesService, salesService);
});

test('a lost response replayed offline after the shift closed does not count the cash twice', async () => {
    const productId = await seedProduct({ stock: [{ location: 'QA-A', quantity: 5 }] });
    const shiftA = await seedShift();
    const request = payload(productId, shiftA.shiftId, { emit_invoice: false });

    // 1. The checkout commits in shift A but the browser never gets the answer.
    const first = await checkout.execute(request, null, { role: 'cashier' });
    // 2. The cashier closes A and opens B on the same register.
    await pool.query("UPDATE cash_shifts SET status = 'closed' WHERE id = ?", [shiftA.shiftId]);
    const shiftB = await seedShift({ registerId: shiftA.registerId });
    // 3. The offline queue replays the same sale (same key, original shift A).
    const replay = await checkout.execute({
        ...request, offline_captured_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }, null, { role: 'cashier' });

    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.order_id, first.order_id);
    const payments = await shiftPayments(first.order_id);
    assert.deepEqual(payments.map((row) => row.shift_id), [shiftA.shiftId, shiftA.shiftId], 'cash stays in shift A only');
    const [[shiftBRow]] = await pool.query('SELECT expected_balance FROM cash_shifts WHERE id = ?', [shiftB.shiftId]);
    assert.equal(Number(shiftBRow.expected_balance), 1000, 'shift B is not inflated');
    assert.deepEqual(await stockOf(productId), { quantity: 3, reserved: 0 });
});
