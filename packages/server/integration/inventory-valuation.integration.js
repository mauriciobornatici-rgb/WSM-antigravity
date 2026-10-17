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
