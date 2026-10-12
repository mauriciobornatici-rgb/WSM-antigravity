import test from 'node:test';
import assert from 'node:assert/strict';

import stockAuditService from '../services/stockAudit.service.js';
import {
    applyStockAuditAdjustments,
    cancelStockAudit,
    completeStockAudit,
    countStockAuditItem,
    createStockAudit,
    getStockAudit,
    getStockAuditDashboard,
} from '../controllers/stockAuditController.js';

function invoke(handler, req = {}) {
    return new Promise((resolve, reject) => {
        const response = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
        };
        handler({ params: {}, query: {}, body: {}, ...req }, response, reject);
    });
}

test('stock audit controller redacts blind active quantities from dashboards and details', async (t) => {
    const originalDashboard = stockAuditService.getDashboard;
    const originalGet = stockAuditService.getSession;
    const active = {
        id: 'audit-1', status: 'in_progress', blind_count: true,
        exact_items: 1, variance_units: 2, accuracy_percent: 50,
        items: [{ id: 'item-1', expected_quantity: 5, variance: -1 }],
    };
    stockAuditService.getDashboard = async () => ({
        summary: { accuracy_percent: 90 }, by_class: [],
        sessions: [active, { ...active, id: 'audit-2', status: 'completed' }],
    });
    stockAuditService.getSession = async () => active;
    t.after(() => {
        stockAuditService.getDashboard = originalDashboard;
        stockAuditService.getSession = originalGet;
    });

    const dashboard = await invoke(getStockAuditDashboard, { query: { status: 'in_progress' } });
    assert.equal(dashboard.body.sessions[0].accuracy_percent, undefined);
    assert.equal(dashboard.body.sessions[1].accuracy_percent, 50);

    const detail = await invoke(getStockAudit, { params: { id: 'audit-1' } });
    assert.equal(detail.body.items[0].expected_quantity, undefined);
    assert.equal(detail.body.items[0].variance, undefined);
});

test('stock audit controller delegates create, count, complete, cancel and adjust actions', async (t) => {
    const methods = ['createSession', 'countItem', 'completeSession', 'cancelSession', 'applyAdjustments'];
    const originals = Object.fromEntries(methods.map((method) => [method, stockAuditService[method]]));
    const calls = [];
    for (const method of methods) {
        stockAuditService[method] = async (...args) => {
            calls.push({ method, args });
            return { id: 'audit-1', status: method === 'createSession' || method === 'countItem' ? 'in_progress' : 'completed', blind_count: true, items: [] };
        };
    }
    t.after(() => {
        for (const method of methods) stockAuditService[method] = originals[method];
    });

    const user = { id: 'user-1' };
    const created = await invoke(createStockAudit, { body: { location_code: 'A-01' }, user });
    assert.equal(created.statusCode, 201);
    await invoke(countStockAuditItem, { params: { id: 'audit-1' }, body: { code: 'SKU', quantity: 1 }, user });
    await invoke(completeStockAudit, { params: { id: 'audit-1' }, user });
    await invoke(cancelStockAudit, { params: { id: 'audit-1' }, user });
    await invoke(applyStockAuditAdjustments, { params: { id: 'audit-1' }, user });

    assert.deepEqual(calls.map((call) => call.method), methods);
    assert.equal(calls[0].args[1], 'user-1');
    assert.equal(calls[1].args[0], 'audit-1');
    assert.equal(calls[4].args[1], 'user-1');
});
