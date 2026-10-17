import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import { SupplierInvoiceService } from '../domains/procurement/SupplierInvoiceService.js';
import { PosExceptionsService } from '../domains/sales/PosExceptionsService.js';
import tiendanubeService from '../services/tiendanube.service.js';

const createOrder = new CreateOrderUseCase({ onStockChanged: async () => {} });

test.after(async () => {
    await closePool();
});

async function seedReception(supplierId, productId, quantity, unitCost) {
    const id = crypto.randomUUID();
    await pool.query(
        "INSERT INTO receptions (id, reception_number, supplier_id, remito_number, status) VALUES (?, ?, ?, ?, 'approved')",
        [id, `REC-QA-${id.slice(0, 8)}`, supplierId, `R-${id.slice(0, 6)}`]
    );
    await pool.query(
        'INSERT INTO reception_items (id, reception_id, product_id, quantity_received, unit_cost) VALUES (?, ?, ?, ?, ?)',
        [crypto.randomUUID(), id, productId, quantity, unitCost]
    );
    return id;
}

test('ADR-019: one purchase invoice covers several delivery notes, and a delivery note is invoiced once', async () => {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const productId = await seedProduct({ salePrice: 100 });
    const first = await seedReception(supplierId, productId, 5, 100);
    const second = await seedReception(supplierId, productId, 3, 100);
    const service = new SupplierInvoiceService();

    const invoice = await service.createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-12',
        reception_ids: [first, second], net_amount: 820, vat_amount: 172.2, vat_rate: 21, total_amount: 992.2,
    }, null);
    assert.deepEqual(invoice.reception_ids.sort(), [first, second].sort());
    assert.equal(invoice.receptions_net, 800);
    assert.equal(invoice.receptions_difference, 20, 'the invoice is 20 above what was received: shown, not blocked');
    const [links] = await pool.query('SELECT reception_id FROM supplier_invoice_receptions WHERE supplier_invoice_id = ?', [invoice.id]);
    assert.equal(links.length, 2);

    await assert.rejects(
        () => service.createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-12',
            reception_ids: [second], net_amount: 300, vat_amount: 63, vat_rate: 21, total_amount: 363,
        }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'reception_already_invoiced'
    );
    const otherSupplier = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [otherSupplier, `Proveedor QA ${otherSupplier.slice(0, 8)}`]);
    const foreign = await seedReception(supplierId, productId, 1, 100);
    await assert.rejects(
        () => service.createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: otherSupplier, issue_date: '2026-10-12',
            reception_ids: [foreign], net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121,
        }, null),
        (err) => err.statusCode === 400 && err.responseBody.error === 'invalid_reception'
    );
});

test('ADR-019: the online store sees what can still be sold (reserved units are not offered)', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 5 }] });
    // A local order reserves 2 of the 5.
    await createOrder.execute({ items: [{ product_id: productId, quantity: 2 }] }, null);
    const available = await tiendanubeService.availableStock([productId]);
    assert.equal(available.get(productId), 3);
});

test('ADR-019: an online order without enough stock is recorded, reserves what there is and waits for a manager', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 1 }] });
    const order = await createOrder.execute({
        external_source: 'tiendanube',
        external_id: crypto.randomUUID(),
        external_total_amount: 363,
        items: [{ product_id: productId, quantity: 3, unit_price: 100 }],
    }, null);
    const [[stock]] = await pool.query('SELECT SUM(quantity) AS quantity, SUM(reserved_quantity) AS reserved FROM inventory WHERE product_id = ?', [productId]);
    assert.deepEqual([Number(stock.quantity), Number(stock.reserved)], [1, 1], 'never negative, never over-reserved');
    const pending = await new PosExceptionsService().list({ status: 'pending', limit: 500 });
    const exception = pending.find((row) => row.order_id === order.id);
    assert.equal(exception?.type, 'channel_stock_shortage');
    assert.deepEqual(exception.details.lines.map((line) => [line.requested, line.shortage]), [[3, 2]]);
});

async function stockOfProduct(productId) {
    const [[row]] = await pool.query('SELECT SUM(quantity) AS quantity, SUM(reserved_quantity) AS reserved FROM inventory WHERE product_id = ?', [productId]);
    return [Number(row.quantity), Number(row.reserved)];
}

test('AUD-007: cancelling an online order that could reserve nothing never frees another order\'s reservation', async () => {
    const { default: salesService } = await import('../services/sales.service.js');
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 2 }] });
    const local = await createOrder.execute({ items: [{ product_id: productId, quantity: 2 }] }, null);
    const online = await createOrder.execute({
        external_source: 'tiendanube', external_id: crypto.randomUUID(), external_total_amount: 242,
        items: [{ product_id: productId, quantity: 2, unit_price: 100 }],
    }, null);
    assert.deepEqual(await stockOfProduct(productId), [2, 2]);
    await salesService.transitionOrderStatus(online.id, 'cancelled', null);
    assert.deepEqual(await stockOfProduct(productId), [2, 2], 'the local order keeps its 2 reserved units');
    const [[allocation]] = await pool.query("SELECT SUM(reserved_quantity) AS reserved FROM order_item_allocations WHERE order_id = ? AND status = 'reserved'", [local.id]);
    assert.equal(Number(allocation.reserved), 2);
});

test('AUD-007: goods that arrive are reserved for the online order that was waiting, and what it still owes is not offered online', async () => {
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 1 }] });
    const online = await createOrder.execute({
        external_source: 'tiendanube', external_id: crypto.randomUUID(), external_total_amount: 363,
        items: [{ product_id: productId, quantity: 3, unit_price: 100 }],
    }, null);
    // 1 reserved, 2 owed: nothing to offer online.
    assert.equal((await tiendanubeService.availableStock([productId])).get(productId), 0);
    // 5 units arrive.
    await pool.query("UPDATE inventory SET quantity = quantity + 5 WHERE product_id = ? AND location = 'QA-A'", [productId]);
    assert.equal((await tiendanubeService.availableStock([productId])).get(productId), 3, '6 − 1 reserved − 2 owed');
    const reserved = await createOrder.reserveOpenShortages([productId]);
    assert.deepEqual(reserved.map((row) => [row.order_id, row.reserved, row.still_missing]), [[online.id, 2, 0]]);
    assert.deepEqual(await stockOfProduct(productId), [6, 3]);
    assert.equal((await tiendanubeService.availableStock([productId])).get(productId), 3);
});

test('AUD-007: units picked beyond the reservation leave stock when the order is packed', async () => {
    const { default: salesService } = await import('../services/sales.service.js');
    const productId = await seedProduct({ salePrice: 100, stock: [{ location: 'QA-A', quantity: 1 }] });
    const online = await createOrder.execute({
        external_source: 'tiendanube', external_id: crypto.randomUUID(), external_total_amount: 242,
        items: [{ product_id: productId, quantity: 2, unit_price: 100 }],
    }, null);
    // One more unit arrives but the picker is faster than the automatic reservation.
    await pool.query("UPDATE inventory SET quantity = quantity + 1 WHERE product_id = ? AND location = 'QA-A'", [productId]);
    const [[item]] = await pool.query('SELECT id FROM order_items WHERE order_id = ?', [online.id]);
    await salesService.transitionOrderStatus(online.id, 'picking', null);
    await salesService.pickOrderItem(item.id, 2, null);
    await salesService.transitionOrderStatus(online.id, 'packed', null);
    assert.deepEqual(await stockOfProduct(productId), [0, 0], 'both units left: the reserved one and the extra one');
});

test('ADR-019: a delivery note still in quality control cannot be invoiced', async () => {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    const productId = await seedProduct({ salePrice: 100 });
    const receptionId = await seedReception(supplierId, productId, 2, 100);
    await pool.query("UPDATE receptions SET status = 'pending_qc' WHERE id = ?", [receptionId]);
    await assert.rejects(
        () => new SupplierInvoiceService().createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-13',
            reception_ids: [receptionId], net_amount: 200, vat_amount: 42, vat_rate: 21, total_amount: 242,
        }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'reception_not_approved'
    );
});

test('Bajos: a location code with stock cannot be renamed, and a deleted supplier gets no invoices', async () => {
    const { default: locationsService } = await import('../services/inventoryLocations.service.js');
    const { default: supplierService } = await import('../domains/procurement/SupplierService.js');
    const code = `QA-REN-${crypto.randomUUID().slice(0, 8)}`;
    const locationId = crypto.randomUUID();
    await pool.query('INSERT INTO warehouse_locations (id, code, name, active) VALUES (?, ?, ?, 1)', [locationId, code, code]);
    await seedProduct({ stock: [{ location: code, quantity: 1 }] });
    await assert.rejects(() => locationsService.updateLocation(locationId, { code: `${code}-X` }, null, null),
        (err) => err.responseBody?.error === 'location_in_use');
    const renamed = await locationsService.updateLocation(locationId, { name: 'Nuevo nombre' }, null, null);
    assert.equal(renamed.name, 'Nuevo nombre');

    const supplier = await supplierService.createSupplier({ name: 'Proveedor a borrar', tax_id: `20-${Date.now()}-1` }, null);
    await assert.rejects(() => supplierService.createSupplier({ name: 'Otro', tax_id: supplier.tax_id }, null),
        (err) => err.responseBody?.error === 'duplicate_tax_id');
    await supplierService.deleteSupplier(supplier.id, null);
    await assert.rejects(
        () => new SupplierInvoiceService().createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplier.id, issue_date: '2026-10-13',
            net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121, purchase_kind: 'expense',
        }, null),
        (err) => err.statusCode === 404 && err.responseBody.error === 'supplier_not_found'
    );
});
