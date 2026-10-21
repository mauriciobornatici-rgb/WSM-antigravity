import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool, seedProduct } from './helpers/qaDb.js';
import { CreateOrderUseCase } from '../domains/sales/CreateOrderUseCase.js';
import accountingService from '../services/accounting.service.js';
import inventoryService from '../services/inventory.service.js';
import salesService from '../services/sales.service.js';

// ADR-027 (opción a): goods valued at the last purchase cost. The cost of goods sold is posted
// when the goods leave, at the cost read under lock, and a new cost revalues the stock.
const useCase = new CreateOrderUseCase({ onStockChanged: async () => {} });

function counterSale(items, extra = {}) {
    return useCase.execute({ external_source: 'pos', external_id: crypto.randomUUID(), items, ...extra }, null);
}

async function ledgerOf(referenceType, referenceId) {
    const [rows] = await pool.query(
        `SELECT je.id, jel.account_code, jel.debit, jel.credit
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.reference_type = ? AND je.reference_id = ?
         ORDER BY jel.account_code, jel.debit, jel.credit`,
        [referenceType, referenceId]
    );
    return {
        entries: [...new Set(rows.map((row) => row.id))],
        lines: rows.map((row) => [row.account_code, Number(row.debit), Number(row.credit)]),
    };
}

async function saleMovements(orderId) {
    const [rows] = await pool.query(
        "SELECT id, quantity, unit_cost, journal_entry_id FROM inventory_movements WHERE reference_id = ? AND type = 'sale'",
        [orderId]
    );
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity), unit_cost: Number(row.unit_cost) }));
}

// Point of sale 98, the one with random numbers (others take the next number of theirs).
async function seedInvoiceFor(orderId) {
    const invoiceId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO invoices (id, order_id, client_name, invoice_type, point_of_sale, invoice_number, net_amount, vat_amount, total_amount, status, issue_date)
         VALUES (?, ?, 'Consumidor final', 'B', 98, FLOOR(RAND() * 1000000000), 100, 21, 121, 'issued', NOW())`,
        [invoiceId, orderId]
    );
    return invoiceId;
}

async function postInvoice(invoiceId) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await accountingService.postInvoiceAccountingEntries(connection, invoiceId);
        await connection.commit();
    } finally {
        connection.release();
    }
}

test.after(async () => {
    await closePool();
});

test('a counter sale posts its cost when the goods leave, linked to its movements; the invoice does not post it again', async () => {
    const productId = await seedProduct({ cost: 100, stock: [{ location: 'QA-A', quantity: 3 }, { location: 'QA-B', quantity: 2 }] });

    const order = await counterSale([{ product_id: productId, quantity: 4 }]);

    const ledger = await ledgerOf('order', order.id);
    assert.equal(ledger.entries.length, 1);
    assert.deepEqual(ledger.lines, [['1.1.04.01', 0, 400], ['5.1.01.01', 400, 0]]);
    const movements = await saleMovements(order.id);
    assert.equal(movements.reduce((sum, movement) => sum + movement.quantity, 0), 4);
    assert.ok(movements.every((movement) => movement.unit_cost === 100 && movement.journal_entry_id === ledger.entries[0]));

    const invoiceId = await seedInvoiceFor(order.id);
    await postInvoice(invoiceId);
    const invoiceLedger = await ledgerOf('invoice', invoiceId);
    assert.ok(!invoiceLedger.lines.some(([account]) => account === '5.1.01.01'), 'the invoice posts only the sale and its VAT');
});

test('an offline sale without enough stock: what existed leaves inventory, the rest goes against inventory differences', async () => {
    const productId = await seedProduct({ cost: 50, stock: [{ location: 'QA-A', quantity: 1 }] });

    const order = await counterSale([{ product_id: productId, quantity: 3 }], { offline_captured_at: new Date(Date.now() - 60_000).toISOString() });

    assert.deepEqual((await ledgerOf('order', order.id)).lines, [
        ['1.1.04.01', 0, 50],
        ['5.1.01.01', 150, 0],
        ['5.1.02.02', 0, 100],
    ]);
});

test('an invoice covers only sales recorded before the rule (movements without an entry), once; never a manual invoice', async () => {
    const productId = await seedProduct({ cost: 30 });
    const orderId = crypto.randomUUID();
    await pool.query("INSERT INTO orders (id, total_amount, status) VALUES (?, 0, 'completed')", [orderId]);
    const legacyMovement = crypto.randomUUID();
    await pool.query(
        `INSERT INTO inventory_movements (id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id)
         VALUES (?, 'sale', ?, 'QA-A', 2, 30, 'Venta anterior', 'order', ?)`,
        [legacyMovement, productId, orderId]
    );

    const invoiceId = await seedInvoiceFor(orderId);
    await postInvoice(invoiceId);
    await postInvoice(invoiceId);

    const ledger = await ledgerOf('invoice', invoiceId);
    assert.deepEqual(ledger.lines.filter(([account]) => account === '5.1.01.01' || account === '1.1.04.01'), [['1.1.04.01', 0, 60], ['5.1.01.01', 60, 0]]);
    const [[movement]] = await pool.query('SELECT journal_entry_id FROM inventory_movements WHERE id = ?', [legacyMovement]);
    assert.ok(ledger.entries.includes(movement.journal_entry_id), 'the movement keeps the entry that valued it');

    const manualInvoice = await seedInvoiceFor(null);
    await postInvoice(manualInvoice);
    assert.ok(!(await ledgerOf('invoice', manualInvoice)).lines.some(([account]) => account === '5.1.01.01'), 'no order, no goods left (D9)');
});

test('a new cost revalues the valued stock against the holding result, and the price follows it (D1); Mermas is not revalued', async () => {
    const productId = await seedProduct({ cost: 100, salePrice: 200, stock: [{ location: 'QA-A', quantity: 3 }, { location: 'Mermas', quantity: 2 }] });

    const updated = await inventoryService.updateProduct(productId, { purchase_price: 120 }, null, null, 'manager');

    assert.equal(Number(updated.purchase_price), 120);
    // 200 net at 21 % is 242 final; × 120 / 100 = 290.40 final, net 240.
    assert.equal(Number(updated.sale_price), 240);
    assert.deepEqual((await ledgerOf('stock_revaluation', productId)).lines, [['1.1.04.01', 60, 0], ['4.2.02.01', 0, 60]]);
});

test('a cost loaded on stock that had none is an opening adjustment (D6); without permission nothing changes (D5)', async () => {
    const productId = await seedProduct({ cost: 0, stock: [{ location: 'QA-A', quantity: 4 }] });

    await assert.rejects(
        () => inventoryService.updateProduct(productId, { purchase_price: 50 }, null, null, 'warehouse'),
        (error) => error.statusCode === 403 && error.errorCode === 'cost_edit_not_allowed'
    );
    const [[unchanged]] = await pool.query('SELECT purchase_price FROM products WHERE id = ?', [productId]);
    assert.equal(Number(unchanged.purchase_price), 0);

    await inventoryService.updateProduct(productId, { purchase_price: 50 }, null, null, 'admin');
    assert.deepEqual((await ledgerOf('stock_revaluation', productId)).lines, [['1.1.04.01', 200, 0], ['3.1.03.01', 0, 200]]);
});

test('a sale waiting behind a cost change posts the new cost (the cost is read under lock, after the stock)', async () => {
    const productId = await seedProduct({ cost: 100, stock: [{ location: 'QA-A', quantity: 5 }] });

    const change = await pool.getConnection();
    let order;
    try {
        await change.beginTransaction();
        await change.query('SELECT id FROM inventory WHERE product_id = ? ORDER BY id FOR UPDATE', [productId]);
        await change.query('UPDATE products SET purchase_price = 150 WHERE id = ?', [productId]);
        const sale = counterSale([{ product_id: productId, quantity: 1 }]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await change.commit();
        order = await sale;
    } finally {
        change.release();
    }

    assert.deepEqual((await ledgerOf('order', order.id)).lines, [['1.1.04.01', 0, 150], ['5.1.01.01', 150, 0]]);
});

test('sales and cost changes of the same products at the same time do not deadlock and keep the stock valued', async () => {
    const productA = await seedProduct({ cost: 10, salePrice: 50, stock: [{ location: 'QA-A', quantity: 40 }] });
    const productB = await seedProduct({ cost: 20, salePrice: 50, stock: [{ location: 'QA-A', quantity: 40 }] });

    const work = Array.from({ length: 16 }, (_, index) => {
        if (index % 4 === 3) {
            return inventoryService.updateProduct(index % 8 === 3 ? productA : productB, { purchase_price: 10 + index }, null, null, 'admin');
        }
        return counterSale(index % 2 === 0
            ? [{ product_id: productA, quantity: 1 }, { product_id: productB, quantity: 1 }]
            : [{ product_id: productB, quantity: 1 }, { product_id: productA, quantity: 1 }]);
    });
    const results = await Promise.allSettled(work);
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason.code || result.reason.message);
    assert.deepEqual(failures, []);

    // Per product: what entered at 10/20 + revaluations − cost of what left = stock × current cost.
    for (const [productId, openingCost] of [[productA, 10], [productB, 20]]) {
        const [[{ quantity, cost }]] = await pool.query(
            'SELECT SUM(i.quantity) AS quantity, MAX(p.purchase_price) AS cost FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id = ?',
            [productId]
        );
        const [[{ revalued }]] = await pool.query(
            `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS revalued FROM journal_entries je
             JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id AND jel.account_code = '1.1.04.01'
             WHERE je.reference_type = 'stock_revaluation' AND je.reference_id = ?`,
            [productId]
        );
        const [[{ left }]] = await pool.query(
            `SELECT COALESCE(SUM(m.quantity * m.unit_cost), 0) AS \`left\` FROM inventory_movements m
             WHERE m.product_id = ? AND m.type = 'sale' AND m.journal_entry_id IS NOT NULL`,
            [productId]
        );
        const valued = Math.round((40 * openingCost + Number(revalued) - Number(left)) * 100);
        assert.equal(valued, Math.round(Number(quantity) * Number(cost) * 100), `product ${productId.slice(0, 8)}`);
    }
});

async function deliveryOrder(productId, quantity) {
    // A back-office delivery order reserves stock until it is packed.
    const order = await useCase.execute({ shipping_method: 'delivery', customer_name: 'Cliente QA', items: [{ product_id: productId, quantity }] }, null);
    await pool.query('UPDATE order_items SET picked_quantity = quantity WHERE order_id = ?', [order.id]);
    await pool.query('UPDATE order_item_allocations SET picked_quantity = reserved_quantity WHERE order_id = ?', [order.id]);
    await salesService.transitionOrderStatus(order.id, 'picking', null);
    return order.id;
}

test('an order invoiced before picking posts its cost when packed, at the cost of that moment (D8)', async () => {
    const productId = await seedProduct({ cost: 100, salePrice: 300, stock: [{ location: 'QA-A', quantity: 6 }] });
    const orderId = await deliveryOrder(productId, 2);
    const invoiceId = await seedInvoiceFor(orderId);
    await postInvoice(invoiceId);
    assert.ok(!(await ledgerOf('invoice', invoiceId)).lines.some(([account]) => account === '5.1.01.01'), 'nothing left yet');

    // The reserved units are still in stock: a new cost revalues them too.
    await inventoryService.updateProduct(productId, { purchase_price: 110 }, null, null, 'admin');
    assert.deepEqual((await ledgerOf('stock_revaluation', productId)).lines, [['1.1.04.01', 60, 0], ['4.2.02.01', 0, 60]]);

    await salesService.transitionOrderStatus(orderId, 'packed', null);
    const ledger = await ledgerOf('order', orderId);
    assert.deepEqual(ledger.lines, [['1.1.04.01', 0, 220], ['5.1.01.01', 220, 0]]);
    assert.ok((await saleMovements(orderId)).every((movement) => movement.journal_entry_id === ledger.entries[0] && movement.unit_cost === 110));
});

test('cancelling a packed order brings the goods back at today\'s cost and reverses the cost they left at', async () => {
    const productId = await seedProduct({ cost: 100, salePrice: 300, stock: [{ location: 'QA-A', quantity: 5 }] });
    const orderId = await deliveryOrder(productId, 3);
    await salesService.transitionOrderStatus(orderId, 'packed', null);
    await inventoryService.updateProduct(productId, { purchase_price: 90 }, null, null, 'manager');

    await salesService.transitionOrderStatus(orderId, 'cancelled', null);

    // Exit: 3 × 100. Back: 3 × 90 into stock, 300 of cost reversed, 30 of holding loss.
    assert.deepEqual((await ledgerOf('order', orderId)).lines, [
        ['1.1.04.01', 0, 300], ['1.1.04.01', 270, 0],
        ['4.2.02.01', 30, 0],
        ['5.1.01.01', 0, 300], ['5.1.01.01', 300, 0],
    ]);
    const [[restock]] = await pool.query(
        "SELECT unit_cost, journal_entry_id FROM inventory_movements WHERE reference_id = ? AND type = 'restock'",
        [orderId]
    );
    assert.equal(Number(restock.unit_cost), 90);
    assert.ok(restock.journal_entry_id);
});

test('an order whose invoice already posted its cost (before ADR-027) is packed without posting it twice', async () => {
    const productId = await seedProduct({ cost: 100, stock: [{ location: 'QA-A', quantity: 4 }] });
    const orderId = await deliveryOrder(productId, 1);
    const invoiceId = await seedInvoiceFor(orderId);
    const legacyEntry = await accountingService.createJournalEntry(pool, {
        date: new Date(), description: 'CMV con la regla anterior', reference_type: 'invoice', reference_id: invoiceId,
        lines: [{ account_code: '5.1.01.01', debit: 100, credit: 0 }, { account_code: '1.1.04.01', debit: 0, credit: 100 }],
    });

    await salesService.transitionOrderStatus(orderId, 'packed', null);

    assert.deepEqual((await ledgerOf('order', orderId)).lines, []);
    assert.ok((await saleMovements(orderId)).every((movement) => movement.journal_entry_id === legacyEntry));
});

test('a return after a cost change comes back at today\'s cost and reverses the cost it was sold at; a lost unit goes to losses', async () => {
    const { returnsService } = await import('../services/warranties.service.js');
    const productId = await seedProduct({ cost: 100, salePrice: 300, stock: [{ location: 'QA-A', quantity: 5 }] });
    const order = await counterSale([{ product_id: productId, quantity: 3 }]);
    await inventoryService.updateProduct(productId, { purchase_price: 120 }, null, null, 'admin');

    const created = await returnsService.createReturn({
        order_id: order.id,
        customer_name: 'Cliente QA',
        reason: 'Cambio',
        items: [
            { product_id: productId, quantity: 2, condition_status: 'sellable' },
            { product_id: productId, quantity: 1, condition_status: 'loss' },
        ],
    });
    await returnsService.approveReturn(created.id, null, null);

    // 2 back at 120 (240), 3 × 100 of cost reversed, 1 × 100 lost, 40 of holding gain.
    assert.deepEqual((await ledgerOf('client_return', created.id)).lines.filter(([account]) => ['1.1.04.01', '5.1.01.01', '5.1.02.02', '4.2.02.01'].includes(account)), [
        ['1.1.04.01', 240, 0],
        ['4.2.02.01', 0, 40],
        ['5.1.01.01', 0, 300],
        ['5.1.02.02', 100, 0],
    ]);
    const [[back]] = await pool.query(
        "SELECT unit_cost, journal_entry_id FROM inventory_movements WHERE reference_id = ? AND type = 'return'",
        [created.id]
    );
    assert.equal(Number(back.unit_cost), 120);
    assert.ok(back.journal_entry_id);
});

test('a count posts its variance at today\'s cost and runs next to sales of the same product without deadlocks', async () => {
    const { default: stockAuditService } = await import('../services/stockAudit.service.js');
    const location = `QA-CNT-${crypto.randomUUID().slice(0, 8)}`;
    await pool.query('INSERT INTO warehouse_locations (id, code, name, active) VALUES (?, ?, ?, 1)', [crypto.randomUUID(), location, location]);
    const productId = await seedProduct({ cost: 40, stock: [{ location, quantity: 5 }, { location: 'QA-A', quantity: 30 }] });
    const [[{ sku }]] = await pool.query('SELECT sku FROM products WHERE id = ?', [productId]);

    const session = await stockAuditService.createSession({ location_code: location, abc_class: 'ALL' }, null);
    await stockAuditService.countItem(session.id, { code: sku, quantity: 3 }, null);
    await stockAuditService.completeSession(session.id, null);

    const results = await Promise.allSettled([
        stockAuditService.applyAdjustments(session.id, null),
        ...Array.from({ length: 4 }, () => counterSale([{ product_id: productId, quantity: 1 }])),
    ]);
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason.code || result.reason.errorCode || result.reason.message);
    // A sale may take a unit from the counted location first: then the count is stale (409), never a deadlock.
    assert.ok(failures.every((failure) => failure === 'STOCK_AUDIT_STALE_SNAPSHOT'), failures.join(', '));
    if (failures.length === 0) {
        assert.deepEqual((await ledgerOf('stock_audit', session.id)).lines, [['1.1.04.01', 0, 80], ['5.1.02.02', 80, 0]]);
    }
});

test('moving goods to Mermas is a loss, bringing them back a recovery; opening stock never goes to Mermas (D3)', async () => {
    const productId = await seedProduct({ cost: 15, stock: [{ location: 'QA-A', quantity: 6 }] });

    const out = await inventoryService.transferStock(productId, 'QA-A', 'Mermas', 4, null);
    const back = await inventoryService.transferStock(productId, 'Mermas', 'QA-A', 1, null);

    assert.deepEqual((await ledgerOf('transfer', out.movementId)).lines, [['1.1.04.01', 0, 60], ['5.1.02.02', 60, 0]]);
    assert.deepEqual((await ledgerOf('transfer', back.movementId)).lines, [['1.1.04.01', 15, 0], ['5.1.02.02', 0, 15]]);
    // A new cost revalues only what carries value: 3 units, not the 3 in Mermas.
    await inventoryService.updateProduct(productId, { purchase_price: 20 }, null, null, 'admin');
    assert.deepEqual((await ledgerOf('stock_revaluation', productId)).lines, [['1.1.04.01', 15, 0], ['4.2.02.01', 0, 15]]);

    await assert.rejects(
        () => inventoryService.createProduct({ sku: `QA-${crypto.randomUUID().slice(0, 8)}`, name: 'Merma QA', sale_price: 10, purchase_price: 5, stock_initial: 2, location: 'Mermas' }, null),
        (error) => error.statusCode === 400 && error.errorCode === 'initial_stock_location'
    );
});

// ---- I5: purchases go through 2.1.01.02 "Mercadería recibida a facturar" (D1, D2) ----

async function receiveWithoutOrder(supplierId, productId, quantity, unitCost, { failed = 0 } = {}) {
    const { default: receptionService } = await import('../domains/procurement/ReceptionService.js');
    const { QualityCheckService } = await import('../domains/procurement/QualityCheckService.js');
    const { default: goodsReceptionService } = await import('../domains/procurement/GoodsReceptionService.js');
    // Typed by a manager: a cost other than the product's needs PRODUCTS_COST_EDIT (D5).
    const reception = await receptionService.createReception({
        supplier_id: supplierId, remito_number: `R-${crypto.randomUUID().slice(0, 8)}`,
        items: [{ product_id: productId, quantity_received: quantity, unit_cost: unitCost, location_assigned: 'QA-A' }],
    }, null, null, { canEditCost: true });
    await new QualityCheckService().createQualityCheck({
        reception_id: reception.id, product_id: productId, result: failed ? 'partial' : 'passed',
        quantity_checked: quantity, quantity_passed: quantity - failed, quantity_failed: failed,
    }, null);
    await goodsReceptionService.processReceptionApproval(reception.id, {});
    return reception.id;
}

async function seedSupplier() {
    const supplierId = crypto.randomUUID();
    await pool.query('INSERT INTO suppliers (id, name) VALUES (?, ?)', [supplierId, `Proveedor QA ${supplierId.slice(0, 8)}`]);
    return supplierId;
}

test('a purchase enters the ledger with its delivery note and the invoice clears it; the difference corrects the cost (D1)', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 100, salePrice: 200, stock: [{ location: 'QA-A', quantity: 3 }] });

    // 4 units at 120 (no purchase order): the 3 in stock go to 120 (+60) and the 4 enter at 120.
    const receptionId = await receiveWithoutOrder(supplierId, productId, 4, 120);
    assert.deepEqual((await ledgerOf('goods_received', receptionId)).lines, [['1.1.04.01', 480, 0], ['2.1.01.02', 0, 480]]);
    const [[afterReception]] = await pool.query('SELECT purchase_price, sale_price FROM products WHERE id = ?', [productId]);
    assert.deepEqual([Number(afterReception.purchase_price), Number(afterReception.sale_price)], [120, 240]);

    // The invoice says 520 net (+21 % VAT): 480 clear 2.1.01.02, 40 more is holding result, and the
    // cost becomes 130 (520 / 4), revaluing the 7 units in stock by 70.
    const invoice = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-17',
        reception_ids: [receptionId], net_amount: 520, vat_amount: 109.2, vat_rate: 21, total_amount: 629.2,
    }, null);
    assert.deepEqual((await ledgerOf('supplier_invoice', invoice.id)).lines, [
        ['1.1.05.02', 109.2, 0], ['2.1.01.01', 0, 629.2], ['2.1.01.02', 480, 0], ['4.2.02.01', 40, 0],
    ]);
    assert.deepEqual(invoice.cost_updates.map((update) => [update.old_cost, update.new_cost]), [[120, 130]]);
    assert.deepEqual((await ledgerOf('stock_revaluation', productId)).lines, [
        ['1.1.04.01', 60, 0], ['1.1.04.01', 70, 0], ['4.2.02.01', 0, 60], ['4.2.02.01', 0, 70],
    ]);
    const [[link]] = await pool.query('SELECT cleared_amount FROM supplier_invoice_receptions WHERE reception_id = ?', [receptionId]);
    assert.equal(Number(link.cleared_amount), 480);
    // What this delivery note left in 2.1.01.02 is now cleared.
    const [[bridge]] = await pool.query(
        `SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS balance FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id AND jel.account_code = '2.1.01.02'
         WHERE (je.reference_type = 'goods_received' AND je.reference_id = ?) OR (je.reference_type = 'supplier_invoice' AND je.reference_id = ?)`,
        [receptionId, invoice.id]
    );
    assert.equal(Number(bridge.balance), 0);
});

test('a product with a fixed cost keeps it: the reception and the invoice send the differences to holding result', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 100, stock: [{ location: 'QA-A', quantity: 2 }] });
    await pool.query('UPDATE products SET auto_update_cost = 0 WHERE id = ?', [productId]);

    const receptionId = await receiveWithoutOrder(supplierId, productId, 2, 110, { failed: 1 });
    // 1 approved and 1 in quarantine, both valued at the fixed 100; 20 paid above it.
    assert.deepEqual((await ledgerOf('goods_received', receptionId)).lines, [['1.1.04.01', 200, 0], ['2.1.01.02', 0, 220], ['4.2.02.01', 20, 0]]);

    // A Factura B: its VAT is cost. 242 against 220 received: 22 more of holding result, no cost change.
    const invoice = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `B-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'B', supplier_id: supplierId, issue_date: '2026-10-17',
        reception_ids: [receptionId], net_amount: 200, vat_amount: 42, vat_rate: 21, total_amount: 242,
    }, null);
    assert.deepEqual((await ledgerOf('supplier_invoice', invoice.id)).lines, [['2.1.01.01', 0, 242], ['2.1.01.02', 220, 0], ['4.2.02.01', 22, 0]]);
    assert.equal(invoice.cost_updates, undefined);
    const [[product]] = await pool.query('SELECT purchase_price FROM products WHERE id = ?', [productId]);
    assert.equal(Number(product.purchase_price), 100);
});

test('goods are never invoiced without their delivery note (D2), and a delivery note needs a cost', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const { default: receptionService } = await import('../domains/procurement/ReceptionService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 10 });
    await assert.rejects(
        () => new SupplierInvoiceService().createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-17',
            net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121,
        }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'goods_invoice_requires_reception'
    );
    await assert.rejects(
        () => receptionService.createReception({ supplier_id: supplierId, items: [{ product_id: productId, quantity_received: 1 }] }, null),
        (err) => err.statusCode === 400 && err.errorCode === 'RECEPTION_COST_REQUIRED'
    );
    // Without PRODUCTS_COST_EDIT, a cost other than the product's is refused (D5, AUD-016).
    await assert.rejects(
        () => receptionService.createReception({ supplier_id: supplierId, items: [{ product_id: productId, quantity_received: 1, unit_cost: 0.01 }] }, null),
        (err) => err.statusCode === 403 && err.errorCode === 'cost_edit_not_allowed'
    );
});

// ---- AUD-016: delivery notes from before the rule, and goods that left with no cost ----

async function seedLegacyReception(supplierId, productId, quantity, unitCost) {
    // Approved before ADR-027: no 'goods_received' entry (its goods were valued by the transition).
    const receptionId = crypto.randomUUID();
    await pool.query(
        "INSERT INTO receptions (id, reception_number, supplier_id, status) VALUES (?, ?, ?, 'approved')",
        [receptionId, `REC-QA-${receptionId.slice(0, 8)}`, supplierId]
    );
    await pool.query(
        'INSERT INTO reception_items (id, reception_id, product_id, quantity_received, unit_cost) VALUES (?, ?, ?, ?, ?)',
        [crypto.randomUUID(), receptionId, productId, quantity, unitCost]
    );
    return receptionId;
}

test('the invoice of a delivery note from before the rule settles the transition adjustment, never adds inventory again', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 50, stock: [{ location: 'QA-A', quantity: 4 }] });
    const legacyId = await seedLegacyReception(supplierId, productId, 4, 50);

    const invoice = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-18',
        reception_ids: [legacyId], net_amount: 200, vat_amount: 42, vat_rate: 21, total_amount: 242,
    }, null);
    // ADR-028: the transition adjustment lives in 3.1.02.02 (earlier years), so this settles it.
    assert.deepEqual((await ledgerOf('supplier_invoice', invoice.id)).lines, [['1.1.05.02', 42, 0], ['2.1.01.01', 0, 242], ['3.1.02.02', 200, 0]]);
});

test('a delivery note returned in full before its invoice has nothing left to invoice, and 2.1.01.02 ends at 0', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const { default: supplierReturnService } = await import('../domains/procurement/SupplierReturnService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 30 });
    const receptionId = await receiveWithoutOrder(supplierId, productId, 2, 30);
    const back = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: receptionId, items: [{ product_id: productId, quantity: 2, unit_cost: 30 }],
    }, null);
    await supplierReturnService.approveSupplierReturn(back.id, null);

    // ADR-028: an invoice charges units of its delivery notes; none are left here, so no goods are booked.
    await assert.rejects(
        () => new SupplierInvoiceService().createSupplierInvoice({
            invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-18',
            reception_ids: [receptionId], net_amount: 60, vat_amount: 12.6, vat_rate: 21, total_amount: 72.6,
        }, null),
        (err) => err.statusCode === 409 && err.responseBody.error === 'reception_already_invoiced'
    );
    const [[bridge]] = await pool.query(
        `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS balance FROM journal_entries e
         JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '2.1.01.02'
         WHERE (e.reference_type = 'goods_received' AND e.reference_id = ?) OR (e.reference_type = 'supplier_return' AND e.reference_id = ?)`,
        [receptionId, back.id]
    );
    assert.equal(Number(bridge.balance), 0);
});

// ---- ADR-028: invoices per delivery note line, in parts ----

async function bridgeOf(receptionId) {
    const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS balance FROM journal_entries e
         JOIN journal_entry_lines l ON l.journal_entry_id = e.id AND l.account_code = '2.1.01.02'
         WHERE (e.reference_type = 'goods_received' AND e.reference_id = ?)
            OR (e.reference_type = 'supplier_invoice' AND e.id IN (
                SELECT je.id FROM journal_entries je JOIN supplier_invoice_receptions sir ON sir.supplier_invoice_id = je.reference_id
                WHERE je.reference_type = 'supplier_invoice' AND sir.reception_id = ?))
            OR (e.reference_type = 'supplier_return' AND e.reference_id IN (SELECT id FROM supplier_returns WHERE reception_id = ?))`,
        [receptionId, receptionId, receptionId]
    );
    return Number(row.balance);
}

test('a delivery note invoiced in two parts: each invoice clears its units, and a return in between lowers the rest', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const { default: supplierReturnService } = await import('../domains/procurement/SupplierReturnService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 40, salePrice: 100 });
    const receptionId = await receiveWithoutOrder(supplierId, productId, 10, 40);
    const [[line]] = await pool.query('SELECT id FROM reception_items WHERE reception_id = ?', [receptionId]);
    assert.equal(await bridgeOf(receptionId), 400);

    // First invoice: 6 units at 44. Clears 240, 24 of holding, and the cost becomes 44.
    const first = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21',
        reception_ids: [receptionId], net_amount: 264, vat_amount: 55.44, vat_rate: 21, total_amount: 319.44,
        items: [{ reception_item_id: line.id, quantity: 6, unit_cost: 44 }],
    }, null);
    assert.deepEqual((await ledgerOf('supplier_invoice', first.id)).lines, [['1.1.05.02', 55.44, 0], ['2.1.01.01', 0, 319.44], ['2.1.01.02', 240, 0], ['4.2.02.01', 24, 0]]);
    assert.equal(await bridgeOf(receptionId), 160);
    const [[product]] = await pool.query('SELECT purchase_price FROM products WHERE id = ?', [productId]);
    assert.equal(Number(product.purchase_price), 44);

    // 3 units go back: 3 of the 4 not invoiced (at the delivery note's 40), against 2.1.01.02.
    const back = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: receptionId, items: [{ product_id: productId, quantity: 3 }],
    }, null);
    await supplierReturnService.approveSupplierReturn(back.id, null);
    assert.equal(await bridgeOf(receptionId), 40);

    // The second invoice can only charge the 1 unit left.
    const tooMany = () => new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21',
        reception_ids: [receptionId], net_amount: 88, vat_amount: 18.48, vat_rate: 21, total_amount: 106.48,
        items: [{ reception_item_id: line.id, quantity: 2, unit_cost: 44 }],
    }, null);
    await assert.rejects(tooMany, (err) => err.statusCode === 409 && /quedan 1 u\./.test(err.message));
    const second = await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21',
        reception_ids: [receptionId], net_amount: 44, vat_amount: 9.24, vat_rate: 21, total_amount: 53.24,
        items: [{ reception_item_id: line.id, quantity: 1, unit_cost: 44 }],
    }, null);
    assert.equal(second.receptions_net, 40);
    assert.equal(await bridgeOf(receptionId), 0);
    const [[after]] = await pool.query('SELECT invoiced_quantity, returned_quantity FROM reception_items WHERE id = ?', [line.id]);
    assert.deepEqual([Number(after.invoiced_quantity), Number(after.returned_quantity)], [7, 3]);
    // Nothing left: a third invoice is refused.
    await assert.rejects(tooMany, (err) => err.statusCode === 409 && err.responseBody.error === 'reception_already_invoiced');
});

test('a return of invoiced units lowers the debt at the last invoiced cost; the rest of the delivery note, its pending', async () => {
    const { SupplierInvoiceService } = await import('../domains/procurement/SupplierInvoiceService.js');
    const { default: supplierReturnService } = await import('../domains/procurement/SupplierReturnService.js');
    const supplierId = await seedSupplier();
    const productId = await seedProduct({ cost: 40, salePrice: 100 });
    const receptionId = await receiveWithoutOrder(supplierId, productId, 5, 40);
    const [[line]] = await pool.query('SELECT id FROM reception_items WHERE reception_id = ?', [receptionId]);
    await new SupplierInvoiceService().createSupplierInvoice({
        invoice_number: `A-${crypto.randomUUID().slice(0, 8)}`, invoice_type: 'A', supplier_id: supplierId, issue_date: '2026-10-21',
        reception_ids: [receptionId], net_amount: 135, vat_amount: 28.35, vat_rate: 21, total_amount: 163.35,
        items: [{ reception_item_id: line.id, quantity: 3, unit_cost: 45 }],
    }, null);

    // The suggestion for a return against it is what that invoice charged.
    assert.deepEqual(await supplierReturnService.suggestedCosts({ supplierId, receptionId, productIds: [productId] }),
        [{ product_id: productId, unit_cost: 45, source: 'invoice' }]);
    // 4 back: the 2 not invoiced lower its pending (at 40), the 2 invoiced the debt (2 × 45 + VAT).
    const back = await supplierReturnService.createReturn({
        supplier_id: supplierId, reception_id: receptionId, items: [{ product_id: productId, quantity: 4 }],
    }, null);
    await supplierReturnService.approveSupplierReturn(back.id, null);
    const { lines } = await ledgerOf('supplier_return', back.id);
    // Book value 4 × 45 (the cost moved to 45 with the invoice): 180; agreed 80 + 90 = 170: 10 of holding.
    assert.deepEqual(lines, [['1.1.04.01', 0, 180], ['1.1.05.02', 0, 18.9], ['2.1.01.01', 108.9, 0], ['2.1.01.02', 80, 0], ['4.2.02.01', 10, 0]]);
    assert.equal(await bridgeOf(receptionId), 0);
    const [[supplier]] = await pool.query('SELECT account_balance FROM suppliers WHERE id = ?', [supplierId]);
    assert.equal(Number(supplier.account_balance), Math.round((163.35 - 108.9) * 100) / 100);
});

test('goods sold with no cost come back, after the cost is loaded, against the opening adjustment', async () => {
    const productId = await seedProduct({ cost: 0, salePrice: 300, stock: [{ location: 'QA-A', quantity: 5 }] });
    const orderId = await deliveryOrder(productId, 2);
    await salesService.transitionOrderStatus(orderId, 'packed', null);
    assert.deepEqual((await ledgerOf('order', orderId)).lines, [], 'nothing of value left');

    // The cost arrives (D6: the 3 in stock against 3.1.03.01), then the order is cancelled.
    await inventoryService.updateProduct(productId, { purchase_price: 50 }, null, null, 'admin');
    await salesService.transitionOrderStatus(orderId, 'cancelled', null);
    // It used to come back with no entry: stock up by 100, ledger unchanged.
    assert.deepEqual((await ledgerOf('order', orderId)).lines, [['1.1.04.01', 100, 0], ['3.1.03.01', 0, 100]]);
});
