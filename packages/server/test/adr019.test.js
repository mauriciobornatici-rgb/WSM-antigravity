import test from 'node:test';
import assert from 'node:assert/strict';

import { TiendaNubeService } from '../services/tiendanube.service.js';

// ---- one stock with Tiendanube ----

function stockDb({ policy = { enabled: 0, units: 0 }, rows = [], linked = [] } = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('tiendanube_safety_stock_enabled AS enabled')) return [[policy]];
            if (statement.includes('GREATEST(i.quantity - i.reserved_quantity, 0)')) return [rows];
            if (statement.includes('LEFT JOIN tiendanube_stock_state')) return [linked];
            if (statement.includes('INSERT INTO tiendanube_stock_state')) return [{ affectedRows: 1 }];
            return [[]];
        }
    };
}

test('the online store gets the available stock: physical minus reserved, minus the safety stock only when the policy is on', async () => {
    const rows = [
        { id: 'a', tiendanube_safety_stock: null, available: 5 },
        { id: 'b', tiendanube_safety_stock: 1, available: 3 },
        { id: 'c', tiendanube_safety_stock: null, available: 1 },
    ];
    const off = new TiendaNubeService({ db: stockDb({ rows }), http: {}, env: {} });
    assert.deepEqual([...(await off.availableStock(['a', 'b', 'c'])).entries()], [['a', 5], ['b', 3], ['c', 1]]);

    const on = new TiendaNubeService({ db: stockDb({ rows, policy: { enabled: 1, units: 2 } }), http: {}, env: {} });
    // Store-wide 2 units, product b overrides with 1, never below zero.
    assert.deepEqual([...(await on.availableStock(['a', 'b', 'c'])).entries()], [['a', 3], ['b', 2], ['c', 0]]);
    assert.equal((await on.availableStock([])).size, 0);
});

test('publishing only calls Tiendanube for values that changed, and remembers what it published', async () => {
    const db = stockDb({
        rows: [{ id: 'a', tiendanube_safety_stock: null, available: 4 }, { id: 'b', tiendanube_safety_stock: null, available: 7 }],
        linked: [{ id: 'a', pushed_stock: 4 }, { id: 'b', pushed_stock: 6 }],
    });
    const service = new TiendaNubeService({ db, http: {}, env: {} });
    const pushed = [];
    service.syncStock = async (productId, stock) => { pushed.push([productId, stock]); return { ok: true }; };
    assert.deepEqual(await service.pushAvailableStock(['a', 'b', 'b']), { checked: 2, pushed: 1 });
    assert.deepEqual(pushed, [['b', 7]]);
    assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO tiendanube_stock_state') && call.params[1] === 7));

    // A failed call is not remembered: the next run retries with fresh data.
    service.syncStock = async () => undefined;
    db.calls.length = 0;
    assert.deepEqual(await service.pushAvailableStock(['b']), { checked: 2, pushed: 0 });
    // ...only its failure, so it waits longer before trying again (backoff, AUD-007).
    const writes = db.calls.filter((call) => call.sql.includes('INSERT INTO tiendanube_stock_state'));
    assert.equal(writes.length, 1);
    assert.match(writes[0].sql, /error_count = error_count \+ 1/);
    assert.deepEqual(await service.pushAvailableStock([]), { checked: 0, pushed: 0 });
});

test('the reconciliation runs one at a time and needs credentials', async () => {
    const db = stockDb();
    const service = new TiendaNubeService({ db, http: {}, env: {} });
    const reserved = [];
    service.shortageReserver = { reserveOpenShortages: async (ids) => { reserved.push(ids); return []; } };
    service.getCredentials = async () => null;
    assert.deepEqual(await service.reconcileStock(), { skipped: true });

    service.getCredentials = async () => ({ storeId: 's' });
    const seen = [];
    service.pushAvailableStock = async (ids) => { seen.push(ids); return { checked: ids.length, pushed: 0 }; };
    // First run (no previous run) compares every linked product.
    await service.reconcileStock();
    assert.ok(db.calls.some((call) => call.sql.includes('FROM products WHERE tiendanube_sync_enabled = 1')));
    // Next runs only look at what changed since the previous one.
    db.calls.length = 0;
    await service.reconcileStock();
    assert.ok(db.calls.some((call) => call.sql.includes('i.updated_at >= ?')));
    service.stockReconcileRunning = true;
    assert.deepEqual(await service.reconcileStock(), { skipped: true });
});

test('AUD-007: a product that keeps failing waits, an increase waits for pending online orders, a dead store stops the run', async () => {
    const calls = [];
    let pendingImports = 0;
    const linked = [
        { id: 'waiting', tiendanube_variant_id: 'v1', pushed_stock: 2, error_count: 3, seconds_since_error: 10 },
        { id: 'up', tiendanube_variant_id: 'v2', pushed_stock: 2, error_count: 0 },
        { id: 'relinked', tiendanube_variant_id: 'new', pushed_stock: 5, variant_id: 'old', error_count: 0 },
    ];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            calls.push({ sql: statement, params });
            if (statement.includes('LEFT JOIN tiendanube_stock_state')) return [linked];
            if (statement.includes('FROM tiendanube_webhook_events')) return [[{ n: pendingImports }]];
            if (statement.includes('GREATEST(i.quantity - i.reserved_quantity, 0)')) return [[{ id: params[1][0], available: 5, owed: 0 }]];
            return [[]];
        }
    };
    const service = new TiendaNubeService({ db, http: {}, env: {} });
    const sent = [];
    service.syncStock = async (id, value) => { sent.push([id, value]); return { ok: true }; };

    await service.pushAvailableStock(['waiting', 'up', 'relinked']);
    // 'waiting' is in backoff; 'up' goes from 2 to 5; 'relinked' has a new variant: published even if equal.
    assert.deepEqual(sent, [['up', 5], ['relinked', 5]]);

    sent.length = 0;
    pendingImports = 1;
    await service.pushAvailableStock(['up']);
    assert.deepEqual(sent, [], 'an increase waits while online orders are being imported');

    pendingImports = 0;
    service.syncStock = async () => undefined;
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, tiendanube_variant_id: `v${i}`, pushed_stock: 1, error_count: 0 }));
    linked.splice(0, linked.length, ...many);
    const result = await service.pushAvailableStock(many.map((row) => row.id));
    assert.equal(result.aborted, true);
});

test('AUD-007: a full run asked during another run is not lost', async () => {
    const service = new TiendaNubeService({ db: { query: async () => [[]] }, http: {}, env: {} });
    service.stockReconcileRunning = true;
    assert.deepEqual(await service.reconcileStock({ full: true }), { skipped: true });
    assert.deepEqual(service.pendingStockReconcile, { full: true, force: undefined });
});
