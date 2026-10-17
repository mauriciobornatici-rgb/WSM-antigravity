import test from 'node:test';
import assert from 'node:assert/strict';
import { PickupOrderCheckoutUseCase } from '../domains/sales/PickupOrderCheckoutUseCase.js';

function createMockConnection(options = {}) {
    const state = {
        orders: (options.orders || []).map((order) => ({ ...order })),
        products: (options.products || []).map((product) => ({ ...product })),
        inventory: (options.inventory || []).map((row) => ({ ...row })),
        invoices: (options.invoices || []).map((invoice) => ({ ...invoice })),
        invoiceItems: (options.invoiceItems || []).map((item) => ({ ...item })),
        shifts: (options.shifts || []).map((shift) => ({ ...shift })),
        shiftPayments: [],
        inventoryMovements: [],
        orderItems: [],
        journalEntries: [],
        journalLines: [],
        movementLinks: []
    };
    const executedQueries = [];
    let committed = false;
    let rolledBack = false;
    let rollbackCount = 0;
    let released = false;

    const findOrder = (orderId) => state.orders.find((order) => order.id === orderId);
    const findInvoice = (invoiceId) => state.invoices.find((invoice) => invoice.id === invoiceId);

    const connection = {
        beginTransaction: async () => {},
        commit: async () => {
            if (options.commitError) throw options.commitError;
            committed = true;
        },
        rollback: async () => {
            rolledBack = true;
            rollbackCount += 1;
        },
        release: () => {
            released = true;
        },
        query: async (sql, params = []) => {
            const sqlStr = String(sql);
            const normalizedSql = sqlStr.replace(/\s+/g, ' ').trim();
            executedQueries.push({ sql: sqlStr, params });

            if (options.customQueryHandler) {
                const customResult = await options.customQueryHandler(sqlStr, params, state);
                if (customResult !== undefined) return customResult;
            }

            if (normalizedSql === 'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE') {
                return [[findOrder(params[0])].filter(Boolean)];
            }

            if (normalizedSql === 'SELECT id, status FROM cash_shifts WHERE id = ? FOR UPDATE') {
                return [state.shifts.filter((shift) => shift.id === params[0])];
            }

            // ADR-027: price and cost of the extras, read with a shared lock after their stock.
            if (normalizedSql.startsWith('SELECT id, name, sku, purchase_price, cost_price, sale_price, vat_rate')) {
                assert.match(normalizedSql, /ORDER BY id FOR SHARE$/);
                const ids = new Set(params[0]);
                return [state.products.filter((product) => ids.has(product.id))];
            }

            if (normalizedSql.startsWith('INSERT INTO journal_entries')) {
                state.journalEntries.push({ id: params[0], description: params[2], reference_type: params[3], reference_id: params[4] });
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('INSERT INTO journal_entry_lines')) {
                state.journalLines.push({ entry_id: params[1], account_code: params[2], debit: params[3], credit: params[4] });
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('UPDATE inventory_movements SET journal_entry_id = ?')) {
                state.movementLinks.push({ entry_id: params[0], movement_ids: params[1] });
                return [{ affectedRows: params[1].length }];
            }

            if (normalizedSql.startsWith('SELECT id, product_id, location, quantity, reserved_quantity FROM inventory')) {
                const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
                const excludedLocations = Array.isArray(params[1]) ? params[1] : [params[1]];
                // Return copies: StockLedger keeps its own in-memory running total on the
                // locked row object, separate from the state row the UPDATE mock mutates
                // (mirrors a real SELECT ... FOR UPDATE snapshot vs. the underlying table row).
                return [state.inventory
                    .filter((row) => ids.includes(row.product_id) && !excludedLocations.includes(row.location))
                    .map((row) => ({ ...row }))];
            }

            // ADR-015: the counter channel asks which locations are sales floor (none in these fixtures).
            if (normalizedSql === 'SELECT code FROM warehouse_locations WHERE is_sales_floor = 1 AND active = 1') {
                return [(options.salesFloorCodes || []).map((code) => ({ code }))];
            }

            if (normalizedSql.startsWith('SELECT i.*, c.tax_id AS client_tax_id')) {
                return [state.invoices.filter((invoice) => invoice.id === params[0])];
            }

            if (normalizedSql === 'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC') {
                return [state.invoiceItems.filter((item) => item.invoice_id === params[0])];
            }

            if (normalizedSql === 'SELECT * FROM orders WHERE id = ?') {
                if (options.snapshotError) throw options.snapshotError;
                return [[findOrder(params[0])].filter(Boolean)];
            }

            if (normalizedSql === 'SELECT * FROM invoices WHERE id = ?') {
                if (options.snapshotError) throw options.snapshotError;
                return [[findInvoice(params[0])].filter(Boolean)];
            }

            if (normalizedSql.startsWith('UPDATE orders SET status = \'delivered\'')) {
                const order = findOrder(params[3]);
                if (order) {
                    order.status = 'delivered';
                    order.recipient_name = params[0];
                    order.recipient_dni = params[1];
                    order.delivery_notes = params[2];
                }
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('UPDATE orders SET total_amount = total_amount + ?')) {
                const order = findOrder(params[1]);
                if (order) order.total_amount = Number(order.total_amount || 0) + Number(params[0] || 0);
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('UPDATE orders SET invoice_id = ?, status = ?, payment_status = ?')) {
                const order = findOrder(params[3]);
                if (order) {
                    order.invoice_id = params[0];
                    order.status = params[1];
                    order.payment_status = params[2];
                }
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('UPDATE inventory SET quantity = quantity - ?')) {
                const row = state.inventory.find((candidate) => candidate.id === params[1]);
                if (!row) return [{ affectedRows: 0 }];
                const consume = Number(params[0] || 0);
                const guard = Number(params[2] ?? consume);
                const availableQty = Number(row.quantity || 0) - Number(row.reserved_quantity || 0);
                if (availableQty < guard) return [{ affectedRows: 0 }];
                row.quantity = Number(row.quantity || 0) - consume;
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('INSERT INTO shift_payments')) {
                state.shiftPayments.push({
                    id: params[0],
                    shift_id: params[1],
                    order_id: params[2],
                    payment_method: params[3],
                    amount: params[4]
                });
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('INSERT INTO inventory_movements')) {
                state.inventoryMovements.push({
                    id: params[0],
                    product_id: params[1],
                    location: params[2],
                    quantity: params[3],
                    order_id: params[4]
                });
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('INSERT INTO order_items')) {
                state.orderItems.push({
                    id: params[0],
                    order_id: params[1],
                    product_id: params[2],
                    quantity: params[3],
                    picked_quantity: params[4],
                    unit_price: params[5],
                    subtotal: params[6]
                });
                return [{ affectedRows: 1 }];
            }

            if (normalizedSql.startsWith('UPDATE cash_shifts SET expected_balance = ?')) {
                const shift = state.shifts.find((candidate) => candidate.id === params[1]);
                if (shift) shift.expected_balance = params[0];
                return [{ affectedRows: 1 }];
            }

            throw new Error(`Unexpected SQL in mock: ${normalizedSql}`);
        }
    };

    return {
        connection,
        state,
        executedQueries,
        isCommitted: () => committed,
        isRolledBack: () => rolledBack,
        rollbackCount: () => rollbackCount,
        isReleased: () => released
    };
}

function createMockPool(mockConn, options = {}) {
    let poolQueries = 0;
    return {
        getConnection: async () => mockConn.connection,
        query: async () => {
            poolQueries += 1;
            if (options.queryError) throw options.queryError;
            throw new Error('Pool query must not be used after the transaction snapshot');
        },
        poolQueries: () => poolQueries
    };
}

function createUseCase(mockConn, poolOptions = {}, dependencies = {}) {
    const pool = createMockPool(mockConn, poolOptions);
    const useCase = new PickupOrderCheckoutUseCase({
        pool,
        auditService: dependencies.auditService || { log: async () => {} },
        salesService: dependencies.salesService || { createInvoice: async () => ({ id: 'inv-default' }) },
        calculateShiftExpectedBalance: dependencies.calculateShiftExpectedBalance || (async () => ({ expected_balance: 0 }))
    });
    return { useCase, pool };
}

function mutatingQueries(mockConn) {
    return mockConn.executedQueries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql));
}

function assertRolledBackAndReleased(mockConn) {
    assert.equal(mockConn.isCommitted(), false);
    assert.equal(mockConn.isRolledBack(), true);
    assert.equal(mockConn.rollbackCount(), 1);
    assert.equal(mockConn.isReleased(), true);
}

test('rejects a missing order and rolls back/releases the locked transaction', async () => {
    const mockConn = createMockConnection({ orders: [] });
    const { useCase } = createUseCase(mockConn);

    await assert.rejects(
        () => useCase.execute('missing-order', {}),
        (error) => {
            assert.equal(error.statusCode, 404);
            assert.equal(error.errorCode, 'ORDER_NOT_FOUND');
            return true;
        }
    );

    assert.deepEqual(mutatingQueries(mockConn), []);
    assertRolledBackAndReleased(mockConn);
});

for (const [label, shippingMethod] of [
    ['delivery', 'delivery'],
    ['null', null],
    ['unknown', 'courier'],
    ['missing', undefined]
]) {
    test(`rejects ${label} shipping method before any pickup mutation`, async () => {
        const order = { id: 'order-invalid-shipping', status: 'packed', shipping_method: shippingMethod };
        if (shippingMethod === undefined) delete order.shipping_method;
        const mockConn = createMockConnection({ orders: [order] });
        const { useCase } = createUseCase(mockConn);

        await assert.rejects(
            () => useCase.execute(order.id, { extra_items: [{ product_id: 'p-extra', quantity: 1 }] }),
            (error) => {
                assert.equal(error.statusCode, 400);
                assert.equal(error.errorCode, 'ORDER_NOT_PICKUP');
                return true;
            }
        );

        assert.deepEqual(mutatingQueries(mockConn), []);
        assertRolledBackAndReleased(mockConn);
    });
}

for (const status of ['delivered', 'completed']) {
    test(`rejects a ${status} pickup order as a finalized retry`, async () => {
        const mockConn = createMockConnection({
            orders: [{ id: `order-${status}`, status, shipping_method: 'pickup' }]
        });
        const { useCase } = createUseCase(mockConn);

        await assert.rejects(
            () => useCase.execute(`order-${status}`, { payments: [{ method: 'cash', amount: 100 }] }),
            (error) => {
                assert.equal(error.statusCode, 400);
                assert.equal(error.errorCode, 'ORDER_ALREADY_FINALIZED');
                return true;
            }
        );

        assert.deepEqual(mutatingQueries(mockConn), []);
        assertRolledBackAndReleased(mockConn);
    });
}

test('rejects an order that is not packed or dispatched', async () => {
    const mockConn = createMockConnection({
        orders: [{ id: 'order-pending', status: 'pending', shipping_method: 'pickup' }]
    });
    const { useCase } = createUseCase(mockConn);

    await assert.rejects(
        () => useCase.execute('order-pending', {}),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.errorCode, 'ORDER_NOT_READY_FOR_PICKUP');
            return true;
        }
    );

    assert.deepEqual(mutatingQueries(mockConn), []);
    assertRolledBackAndReleased(mockConn);
});

test('requires an open locked cash shift before checkout mutations', async () => {
    const mockConn = createMockConnection({
        orders: [{ id: 'order-closed-shift', status: 'packed', shipping_method: 'pickup' }],
        shifts: [{ id: 'shift-closed', status: 'closed' }]
    });
    const { useCase } = createUseCase(mockConn);

    await assert.rejects(
        () => useCase.execute('order-closed-shift', {
            shift_id: 'shift-closed',
            extra_items: [{ product_id: 'p-extra', quantity: 1 }]
        }),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'CASH_SHIFT_NOT_OPEN');
            return true;
        }
    );

    const shiftGuardIndex = mockConn.executedQueries.findIndex(({ sql }) => sql.includes('cash_shifts') && sql.includes('FOR UPDATE'));
    assert.ok(shiftGuardIndex >= 0);
    assert.equal(mutatingQueries(mockConn).length, 0);
    assertRolledBackAndReleased(mockConn);
});

test('rejects a missing cash shift before checkout mutations', async () => {
    const mockConn = createMockConnection({
        orders: [{ id: 'order-missing-shift', status: 'packed', shipping_method: 'pickup' }]
    });
    const { useCase } = createUseCase(mockConn);

    await assert.rejects(
        () => useCase.execute('order-missing-shift', { shift_id: 'shift-missing' }),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'CASH_SHIFT_NOT_OPEN');
            return true;
        }
    );

    assert.ok(mockConn.executedQueries.some(({ sql }) => sql.includes('cash_shifts') && sql.includes('FOR UPDATE')));
    assert.deepEqual(mutatingQueries(mockConn), []);
    assertRolledBackAndReleased(mockConn);
});

test('rejects extras without available stock without updating inventory', async () => {
    const mockConn = createMockConnection({
        orders: [{ id: 'order-insufficient-extra', status: 'packed', shipping_method: 'pickup' }],
        products: [{ id: 'extra-out-of-stock', name: 'Zapatillas Running', sale_price: 50000 }],
        inventory: [{
            id: 'inventory-reserved',
            product_id: 'extra-out-of-stock',
            location: 'Estante A',
            quantity: 1,
            reserved_quantity: 1,
            available_quantity: 0
        }]
    });
    const { useCase } = createUseCase(mockConn);

    await assert.rejects(
        () => useCase.execute('order-insufficient-extra', {
            extra_items: [{ product_id: 'extra-out-of-stock', quantity: 2 }]
        }),
        (error) => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.errorCode, 'INSUFFICIENT_STOCK');
            return true;
        }
    );

    assert.equal(
        mockConn.executedQueries.some(({ sql }) => /^\s*UPDATE inventory\b/i.test(sql)),
        false
    );
    assertRolledBackAndReleased(mockConn);
});

function paidInvoiceDependencies(mockConn, invoiceData, stateInvoice = invoiceData) {
    if (stateInvoice) mockConn.state.invoices.push({ ...stateInvoice, items: undefined, metadata: undefined });
    return {
        salesService: {
            createInvoice: async (orderId, data, userId, connection) => {
                assert.equal(connection, mockConn.connection);
                assert.equal(data.invoice_type, 'B');
                assert.equal(userId, 'cashier-1');
                await connection.query(
                    'UPDATE orders SET invoice_id = ?, status = ?, payment_status = ? WHERE id = ?',
                    [invoiceData.id, 'completed', 'paid', orderId]
                );
                return invoiceData;
            }
        },
        auditService: { log: async () => {} },
        calculateShiftExpectedBalance: async () => ({ expected_balance: 35000 })
    };
}

test('checks out packed pickup with an open shift and returns the pre-commit invoice snapshot', async () => {
    const invoiceData = {
        id: 'invoice-paid',
        invoice_number: 45,
        total_amount: 25000,
        payment_status: 'paid',
        metadata: { source: 'pickup-pos' },
        items: [{ product_id: 'p-1', quantity: 1, total_line: 25000 }]
    };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-paid', status: 'packed', shipping_method: 'pickup', customer_name: 'Carlos', total_amount: 25000 }],
        shifts: [{ id: 'shift-open', status: 'open', opening_balance: 10000 }],
        invoices: [{ id: invoiceData.id, invoice_number: invoiceData.invoice_number, total_amount: invoiceData.total_amount }]
    });
    const dependencies = paidInvoiceDependencies(mockConn, invoiceData, null);
    const { useCase, pool } = createUseCase(mockConn, {}, dependencies);

    const result = await useCase.execute('order-paid', {
        recipient_name: 'Carlos',
        recipient_dni: '30123456',
        shift_id: 'shift-open',
        payments: [{ method: 'cash', amount: 25000 }]
    }, 'cashier-1');

    assert.equal(mockConn.isCommitted(), true);
    assert.equal(mockConn.isRolledBack(), false);
    assert.equal(mockConn.isReleased(), true);
    assert.equal(pool.poolQueries(), 0);
    assert.equal(result.order.status, 'completed');
    assert.deepEqual(result.invoice.items, invoiceData.items);
    assert.deepEqual(result.invoice.metadata, invoiceData.metadata);

    const shiftGuardIndex = mockConn.executedQueries.findIndex(({ sql }) => sql.includes('cash_shifts') && sql.includes('FOR UPDATE'));
    const firstWriteIndex = mockConn.executedQueries.findIndex(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql));
    assert.ok(shiftGuardIndex >= 0);
    assert.ok(firstWriteIndex > shiftGuardIndex);
    assert.equal(mockConn.state.shiftPayments.length, 1);
    assert.equal(mockConn.state.shiftPayments[0].amount, 25000);

    const orderSnapshotIndex = mockConn.executedQueries.findIndex(({ sql }) => sql.replace(/\s+/g, ' ').trim() === 'SELECT * FROM orders WHERE id = ?');
    const invoiceSnapshotIndex = mockConn.executedQueries.findIndex(({ sql }) => sql === 'SELECT * FROM invoices WHERE id = ?');
    assert.ok(orderSnapshotIndex >= 0);
    assert.ok(invoiceSnapshotIndex >= 0);
    assert.ok(orderSnapshotIndex < invoiceSnapshotIndex);
});

test('uses current invoice columns from the transaction snapshot while preserving metadata and items', async () => {
    const staleInvoice = {
        id: 'invoice-enriched',
        total_amount: 100,
        payment_status: 'pending',
        metadata: { source: 'pickup-pos' },
        items: [{ product_id: 'p-1', quantity: 1, total_line: 100 }]
    };
    const currentInvoice = {
        id: staleInvoice.id,
        total_amount: 121,
        payment_status: 'paid'
    };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-enriched', status: 'packed', shipping_method: 'pickup' }],
        invoices: [currentInvoice]
    });
    const { useCase } = createUseCase(mockConn, {}, paidInvoiceDependencies(mockConn, staleInvoice, null));

    const result = await useCase.execute('order-enriched', {}, 'cashier-1');

    assert.equal(mockConn.isCommitted(), true);
    assert.equal(result.invoice.total_amount, 121);
    assert.equal(result.invoice.payment_status, 'paid');
    assert.deepEqual(result.invoice.metadata, staleInvoice.metadata);
    assert.deepEqual(result.invoice.items, staleInvoice.items);
});

test('accepts the legacy paid alias as a packed pickup order', async () => {
    const invoiceData = { id: 'invoice-paid-alias', payment_status: 'paid', items: [] };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-paid-alias', status: 'paid', shipping_method: 'pickup' }],
        invoices: [{ id: invoiceData.id }]
    });
    const { useCase } = createUseCase(mockConn, {}, paidInvoiceDependencies(mockConn, invoiceData, null));

    const result = await useCase.execute('order-paid-alias', {}, 'cashier-1');

    assert.equal(mockConn.isCommitted(), true);
    assert.equal(result.invoice.id, invoiceData.id);
    assert.equal(mockConn.state.orders[0].status, 'completed');
});

test('deducts available stock for extras without consuming reservations', async () => {
    const invoiceData = { id: 'invoice-extra', payment_status: 'paid', items: [{ product_id: 'extra-product', quantity: 2 }] };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-extra', status: 'dispatched', shipping_method: 'pickup', total_amount: 10000 }],
        products: [{ id: 'extra-product', name: 'Medias Deportivas', sale_price: 4000 }],
        inventory: [{ id: 'inventory-extra', product_id: 'extra-product', location: 'Estante B', quantity: 10, reserved_quantity: 2, available_quantity: 8 }],
        invoices: [{ id: invoiceData.id }]
    });
    const { useCase } = createUseCase(mockConn, {}, paidInvoiceDependencies(mockConn, invoiceData, null));

    await useCase.execute('order-extra', {
        extra_items: [{ product_id: 'extra-product', quantity: 2 }]
    }, 'cashier-1');

    assert.equal(mockConn.isCommitted(), true);
    assert.equal(mockConn.state.inventory[0].quantity, 8);
    assert.equal(mockConn.state.inventory[0].reserved_quantity, 2);
    assert.ok(mockConn.executedQueries.some(({ sql }) => sql.includes('INSERT INTO inventory_movements')));
    // The extras deduction guards against reserved stock (WHERE ... reserved_quantity) but
    // never decrements the reservation itself.
    assert.equal(
        mockConn.executedQueries.some(({ sql }) => /^\s*UPDATE inventory\b/i.test(sql) && /reserved_quantity\s*=\s*reserved_quantity/i.test(sql)),
        false
    );
});

test('locks multiple extras in a stable sorted order and grows the order total by each gross line', async () => {
    const invoiceData = { id: 'invoice-multi-extra', payment_status: 'paid', items: [] };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-multi-extra', status: 'packed', shipping_method: 'pickup', total_amount: 5000 }],
        products: [
            { id: 'aaa-product', name: 'Buff', sale_price: 1000, vat_rate: 21, purchase_price: 400 },
            { id: 'zzz-product', name: 'Cinta', sale_price: 500, vat_rate: 10.5, purchase_price: 0, cost_price: 200 }
        ],
        inventory: [
            { id: 'inventory-aaa', product_id: 'aaa-product', location: 'Estante A', quantity: 20, reserved_quantity: 0 },
            { id: 'inventory-zzz', product_id: 'zzz-product', location: 'Estante B', quantity: 20, reserved_quantity: 0 }
        ],
        invoices: [{ id: invoiceData.id }]
    });
    const { useCase } = createUseCase(mockConn, {}, paidInvoiceDependencies(mockConn, invoiceData, null));

    // Requested out of alphabetical order: the use case must sort by product_id before
    // locking (stable lock order across concurrent counters, avoiding deadlocks).
    await useCase.execute('order-multi-extra', {
        extra_items: [
            { product_id: 'zzz-product', quantity: 2 },
            { product_id: 'aaa-product', quantity: 1 }
        ]
    }, 'cashier-1');

    const isLockQuery = (sql) => sql.replace(/\s+/g, ' ').trim()
        .startsWith('SELECT id, product_id, location, quantity, reserved_quantity FROM inventory');
    const lockQuery = mockConn.executedQueries.find(({ sql }) => isLockQuery(sql));
    assert.ok(lockQuery, 'lockSellableRows must run once for every extra line');
    assert.deepEqual(lockQuery.params[0], ['aaa-product', 'zzz-product']);

    // Only one lock query: both extras are locked together, not one row lookup per item.
    assert.equal(mockConn.executedQueries.filter(({ sql }) => isLockQuery(sql)).length, 1);

    // 1000 net + 21% VAT = 1210; 2 * 500 net + 10.5% VAT = 1105. Gross lines, not net (ADR-008).
    assert.equal(mockConn.state.orders[0].total_amount, 5000 + 1210 + 1105);
    assert.equal(mockConn.state.inventory[0].quantity, 19);
    assert.equal(mockConn.state.inventory[1].quantity, 18);

    // ADR-027 (D8): the extras left now, so their cost is posted now (1 × 400 + 2 × 200, the
    // second one still valued at its legacy cost), in one entry linked to both movements.
    assert.equal(mockConn.state.journalEntries.length, 1);
    const [entry] = mockConn.state.journalEntries;
    assert.deepEqual([entry.reference_type, entry.reference_id], ['order', 'order-multi-extra']);
    assert.deepEqual(
        mockConn.state.journalLines.map((line) => [line.account_code, line.debit, line.credit]),
        [['5.1.01.01', 800, 0], ['1.1.04.01', 0, 800]]
    );
    assert.deepEqual(mockConn.state.movementLinks, [{ entry_id: entry.id, movement_ids: mockConn.state.inventoryMovements.map((movement) => movement.id) }]);
    const costs = mockConn.executedQueries.filter(({ sql }) => sql.includes('INSERT INTO inventory_movements')).map(({ params }) => params[5]);
    assert.deepEqual(costs, [400, 200], 'each movement carries the cost it left at');
});

test('rolls back and releases when the response snapshot fails before commit', async () => {
    const invoiceData = { id: 'invoice-snapshot-failure', payment_status: 'paid', items: [] };
    const snapshotError = new Error('snapshot read failed');
    const mockConn = createMockConnection({
        orders: [{ id: 'order-snapshot-failure', status: 'packed', shipping_method: 'pickup' }],
        invoices: [{ id: invoiceData.id }],
        snapshotError
    });
    const { useCase } = createUseCase(mockConn, {}, paidInvoiceDependencies(mockConn, invoiceData, null));

    await assert.rejects(
        () => useCase.execute('order-snapshot-failure', {}, 'cashier-1'),
        (error) => {
            assert.equal(error, snapshotError);
            return true;
        }
    );

    assertRolledBackAndReleased(mockConn);
    assert.ok(mockConn.executedQueries.some(({ sql }) => sql.includes('UPDATE orders')));
});

test('rejects a second checkout after the first one finalized the order', async () => {
    const invoiceData = { id: 'invoice-retry', payment_status: 'paid', items: [] };
    const mockConn = createMockConnection({
        orders: [{ id: 'order-retry', status: 'packed', shipping_method: 'pickup' }],
        invoices: [{ id: invoiceData.id }]
    });
    const dependencies = paidInvoiceDependencies(mockConn, invoiceData, null);
    const { useCase } = createUseCase(mockConn, {}, dependencies);

    await useCase.execute('order-retry', {}, 'cashier-1');
    const writesAfterFirstCheckout = mockConn.executedQueries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)).length;

    await assert.rejects(
        () => useCase.execute('order-retry', {}, 'cashier-1'),
        (error) => {
            assert.equal(error.errorCode, 'ORDER_ALREADY_FINALIZED');
            return true;
        }
    );

    const writesAfterRetry = mockConn.executedQueries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)).length;
    assert.equal(writesAfterRetry, writesAfterFirstCheckout);
});
