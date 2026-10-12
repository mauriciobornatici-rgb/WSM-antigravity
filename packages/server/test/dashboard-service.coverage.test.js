import test from 'node:test';
import assert from 'node:assert/strict';

import dashboardService from '../services/dashboard.service.js';
import pool from '../config/db.js';

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function installPool(t, resolver) {
    const previous = pool.query;
    const statements = [];
    pool.query = async (sql) => {
        const statement = normalizeSql(sql);
        statements.push(statement);
        return resolver(statement);
    };
    t.after(() => {
        pool.query = previous;
    });
    return statements;
}

function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

test('getDashboardStats aggregates transaction-based metrics', async (t) => {
    const statements = installPool(t, (s) => {
        if (s.includes("FROM transactions WHERE type = 'sale' AND DATE(date) = CURDATE()") && s.includes('SUM(amount)')) return [[{ amount: '300.50' }]];
        if (s.includes('DATE_SUB(CURDATE(), INTERVAL 1 DAY)') && s.includes('FROM transactions')) return [[{ amount: '120' }]];
        if (s.includes('COUNT(*) AS count FROM transactions')) return [[{ count: 4 }]];
        if (s.includes("status IN ('pending', 'picking', 'packed')")) return [[{ count: 7 }]];
        if (s.includes("status = 'packed'")) return [[{ count: 2 }]];
        if (s.includes('FROM inventory')) return [[{ count: 3 }]];
        if (s.includes('AS closed')) return [[{ total: 8, closed: 3 }]];
        if (s.includes('GROUP BY DATE(date)')) {
            return [[
                { day: daysAgo(0), total: '300.50' },
                { day: dateKey(daysAgo(1)) + 'T00:00:00.000Z', total: 120 },
                { day: null, total: 999 }
            ]];
        }
        if (s.includes('FROM transactions ORDER BY date DESC')) {
            return [[
                { id: 't1', type: 'sale', amount: '10', description: 'Venta X', date: 'd1' },
                { id: 't2', type: 'refund', amount: 5, description: null, date: 'd2' },
                { id: 't3', type: 'expense', amount: null, description: 'Gasto', date: 'd3' }
            ]];
        }
        if (s.includes('FROM users u')) return [[{ picker_name: 'Leo', total_picked: 9 }]];
        throw new Error(`Unexpected SQL: ${s}`);
    });

    const stats = await dashboardService.getDashboardStats();

    assert.equal(stats.salesToday, 300.5);
    assert.equal(stats.salesYesterday, 120);
    assert.equal(stats.todayOperations, 4);
    assert.equal(stats.pendingOrders, 7);
    assert.equal(stats.readyToDispatch, 2);
    assert.equal(stats.lowStockCount, 3);
    assert.equal(stats.totalActionable, 8);
    assert.equal(stats.closedOrdersCount, 3);
    assert.equal(stats.completionRate, 38);
    assert.equal(stats.dailySalesHistory.length, 7);
    assert.equal(stats.dailySalesHistory[6].amount, 300.5);
    assert.equal(stats.dailySalesHistory[5].amount, 120);
    assert.equal(stats.dailySalesHistory[0].amount, 0);
    assert.deepEqual(stats.activities, [
        { id: 't1', title: 'Venta X', date: 'd1', amount: 10, positive: true },
        { id: 't2', title: 'Venta registrada', date: 'd2', amount: 5, positive: false },
        { id: 't3', title: 'Gasto', date: 'd3', amount: 0, positive: false }
    ]);
    assert.deepEqual(stats.pickerLeaderboard, [{ picker_name: 'Leo', total_picked: 9 }]);
    // No order fallback when transactions exist
    assert.equal(statements.some((s) => s.includes('FROM orders WHERE status != \'cancelled\' AND DATE(created_at)')), false);
});

test('getDashboardStats falls back to orders when there are no transactions', async (t) => {
    const orderId = 'abcdef1234567890';
    const cancelledId = '1234567890abcdef';
    const statements = installPool(t, (s) => {
        if (s.includes('FROM transactions') && s.includes('COUNT(*)')) return [[{ count: 0 }]];
        if (s.includes('FROM transactions') && s.includes('SUM(amount)') && !s.includes('GROUP BY')) return [[{ amount: 0 }]];
        if (s.includes('AS amount, COUNT(*) AS count FROM orders')) return [[{ amount: '75', count: 2 }]];
        if (s.includes("AS amount FROM orders WHERE status != 'cancelled' AND DATE(created_at) = DATE_SUB")) return [[{ amount: '50' }]];
        if (s.includes("status IN ('pending'")) return [[{ count: 1 }]];
        if (s.includes("status = 'packed'")) return [[{ count: 0 }]];
        if (s.includes('FROM inventory')) return [[{ count: 0 }]];
        if (s.includes('AS closed')) return [[{ total: 0, closed: 0 }]];
        if (s.includes('FROM transactions') && s.includes('GROUP BY DATE(date)')) return [[]];
        if (s.includes('FROM orders') && s.includes('GROUP BY DATE(created_at)')) {
            return [[{ day: daysAgo(2), total: '75' }]];
        }
        if (s.includes('FROM transactions ORDER BY date DESC')) return [[]];
        if (s.includes('FROM orders WHERE deleted_at IS NULL ORDER BY created_at DESC')) {
            return [[
                { id: orderId, status: 'pending', total_amount: '75', created_at: 'c1' },
                { id: cancelledId, status: 'cancelled', total_amount: null, created_at: 'c2' }
            ]];
        }
        if (s.includes('FROM users u')) return [[]];
        throw new Error(`Unexpected SQL: ${s}`);
    });

    const stats = await dashboardService.getDashboardStats();

    assert.equal(stats.salesToday, 75);
    assert.equal(stats.todayOperations, 2);
    assert.equal(stats.salesYesterday, 50);
    assert.equal(stats.completionRate, 0);
    assert.equal(stats.dailySalesHistory[4].amount, 75);
    assert.deepEqual(stats.activities, [
        { id: orderId, title: 'Pedido #ABCDEF12', status: 'pending', date: 'c1', amount: 75, positive: true },
        { id: cancelledId, title: 'Pedido #12345678', status: 'cancelled', date: 'c2', amount: 0, positive: false }
    ]);
    assert.deepEqual(stats.pickerLeaderboard, []);
    assert.equal(statements.some((s) => s.includes('GROUP BY DATE(created_at)')), true);
});

test('getDashboardStats copes with empty/missing rows (zeros everywhere)', async (t) => {
    installPool(t, (s) => {
        if (s.includes('AS count') || s.includes('AS amount') || s.includes('AS closed')) return [[undefined]];
        return [[]];
    });
    const stats = await dashboardService.getDashboardStats();
    assert.equal(stats.salesToday, 0);
    assert.equal(stats.salesYesterday, 0);
    assert.equal(stats.todayOperations, 0);
    assert.equal(stats.pendingOrders, 0);
    assert.equal(stats.readyToDispatch, 0);
    assert.equal(stats.lowStockCount, 0);
    assert.equal(stats.completionRate, 0);
    assert.deepEqual(stats.activities, []);
    assert.equal(stats.dailySalesHistory.every((d) => d.amount === 0), true);
});

test('getDashboardStats propagates database errors', async (t) => {
    installPool(t, () => { throw new Error('db down'); });
    await assert.rejects(dashboardService.getDashboardStats(), /db down/);
});

test('getSizeColorAnalytics returns rows', async (t) => {
    const statements = installPool(t, () => [[{ category: 'General', size: 'M', units_sold: 4 }]]);
    const rows = await dashboardService.getSizeColorAnalytics();
    assert.deepEqual(rows, [{ category: 'General', size: 'M', units_sold: 4 }]);
    assert.match(statements[0], /LIMIT 30/);
});

test('getSizeColorAnalytics swallows errors and returns an empty list', async (t) => {
    installPool(t, () => { throw new Error('boom'); });
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    t.after(() => { console.error = originalError; });
    const rows = await dashboardService.getSizeColorAnalytics();
    assert.deepEqual(rows, []);
    assert.equal(logged.length, 1);
});

