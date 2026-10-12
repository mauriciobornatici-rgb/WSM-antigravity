import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';
import treasuryService from '../services/treasury.service.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';

test.after(async () => {
    await closePool();
});

async function seedSupplier(balance = 1000) {
    const id = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name, account_balance) VALUES (?, ?, ?)', [id, `Proveedor QA ${id.slice(0, 8)}`, balance]);
    return id;
}

test('ADR-015: a double click on a supplier payment pays once, even when both arrive together', async () => {
    const supplierId = await seedSupplier(1000);
    const body = { idempotency_key: crypto.randomUUID(), supplier_id: supplierId, payments: [{ amount: 300, payment_method: 'transfer' }] };

    const results = await Promise.all([
        supplierPaymentService.createSupplierPayment(body, null),
        supplierPaymentService.createSupplierPayment(body, null),
    ]);

    assert.deepEqual(results[0].ids, results[1].ids);
    assert.equal(results.filter((r) => r.idempotent_replay).length, 1);
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), 700);
    const [payments] = await pool.query('SELECT id FROM supplier_payments WHERE supplier_id = ?', [supplierId]);
    assert.equal(payments.length, 1);
});

test('ADR-015: the same key with another amount is refused, not replayed', async () => {
    const supplierId = await seedSupplier(1000);
    const key = crypto.randomUUID();
    await supplierPaymentService.createSupplierPayment({ idempotency_key: key, supplier_id: supplierId, payments: [{ amount: 100, payment_method: 'transfer' }] }, null);
    await assert.rejects(
        () => supplierPaymentService.createSupplierPayment({ idempotency_key: key, supplier_id: supplierId, payments: [{ amount: 200, payment_method: 'transfer' }] }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'idempotency_key_reused'
    );
});

test('ADR-015: Caja 2 pays suppliers only with the cash it holds, and two payments cannot spend it twice', async () => {
    const before = (await treasuryService.getSummary()).balance;
    await treasuryService.transfer({ from: 'initial', to: 'treasury', amount: 500, idempotency_key: crypto.randomUUID() }, null, null);
    const supplierId = await seedSupplier(2000);
    const available = (await treasuryService.getSummary()).balance;
    assert.equal(Math.round((available - before) * 100) / 100, 500);

    // Two concurrent payments that each fit, but not both.
    const amount = Math.floor(available / 2) + 1;
    const results = await Promise.allSettled([
        supplierPaymentService.createSupplierPayment({ supplier_id: supplierId, payments: [{ amount, payment_method: 'Caja 2' }] }, null),
        supplierPaymentService.createSupplierPayment({ supplier_id: supplierId, payments: [{ amount, payment_method: 'Caja 2' }] }, null),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.responseBody.error, 'insufficient_treasury_cash');
    assert.ok((await treasuryService.getSummary()).balance >= 0, 'Caja 2 never goes negative');
});

test('ADR-015: the counter sells from the sales floor, an order reserves from the warehouse', async () => {
    const floor = `QA-SAL-${crypto.randomUUID().slice(0, 8)}`;
    const back = `QA-DEP-${crypto.randomUUID().slice(0, 8)}`;
    await pool.query('INSERT INTO warehouse_locations (id, code, name, active, is_sales_floor) VALUES (?, ?, ?, 1, 1)', [crypto.randomUUID(), floor, floor]);
    await pool.query('INSERT INTO warehouse_locations (id, code, name, active, is_sales_floor) VALUES (?, ?, ?, 1, 0)', [crypto.randomUUID(), back, back]);
    // The warehouse holds more: without the rule both would take from it.
    const productId = await seedProduct({ stock: [{ location: floor, quantity: 3 }, { location: back, quantity: 10 }] });
    const useCase = new CreateOrderUseCase({ onStockChanged: async () => {} });

    const sale = await useCase.execute({ external_source: 'pos', external_id: crypto.randomUUID(), items: [{ product_id: productId, quantity: 1 }] }, null);
    const [saleMoves] = await pool.query("SELECT from_location FROM inventory_movements WHERE reference_id = ? AND type = 'sale'", [sale.id]);
    assert.deepEqual(saleMoves.map((m) => m.from_location), [floor]);

    await useCase.execute({ items: [{ product_id: productId, quantity: 2 }] }, null);
    const [rows] = await pool.query('SELECT location, reserved_quantity FROM inventory WHERE product_id = ?', [productId]);
    const reserved = Object.fromEntries(rows.map((r) => [r.location, Number(r.reserved_quantity)]));
    assert.equal(reserved[back], 2);
    assert.equal(reserved[floor] || 0, 0);
});
