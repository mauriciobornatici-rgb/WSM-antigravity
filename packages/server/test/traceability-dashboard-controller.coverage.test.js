import test from 'node:test';
import assert from 'node:assert/strict';

import { getTimeline } from '../controllers/traceabilityController.js';
import { getDashboardStats, getSizeColorAnalytics } from '../controllers/dashboardController.js';
import traceabilityService from '../services/traceability.service.js';
import dashboardService from '../services/dashboard.service.js';

function runHandler(handler, overrides = {}) {
    const req = { params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...overrides };
    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined });
        };
        try {
            handler(req, res, next);
        } catch (error) {
            next(error);
        }
    });
}

function stub(t, target, method, impl) {
    const calls = [];
    const previous = target[method];
    target[method] = async (...args) => {
        calls.push(args);
        return impl(...args);
    };
    t.after(() => {
        target[method] = previous;
    });
    return calls;
}

test('getTimeline forwards only the whitelisted filters', async (t) => {
    const calls = stub(t, traceabilityService, 'getTimeline', () => [{ id: 'ev1' }]);
    const result = await runHandler(getTimeline, {
        query: { product_id: 'p1', sku: 'S1', barcode: '779', limit: '10', evil: 'x' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ id: 'ev1' }]);
    assert.deepEqual(calls[0][0], { product_id: 'p1', sku: 'S1', barcode: '779', limit: '10' });
});

test('getTimeline propagates service errors', async (t) => {
    stub(t, traceabilityService, 'getTimeline', () => { throw new Error('trace failed'); });
    await assert.rejects(runHandler(getTimeline), /trace failed/);
});

test('getDashboardStats returns the service payload', async (t) => {
    const calls = stub(t, dashboardService, 'getDashboardStats', () => ({ salesToday: 5 }));
    const result = await runHandler(getDashboardStats);
    assert.deepEqual(result.body, { salesToday: 5 });
    assert.equal(calls.length, 1);
});

test('getDashboardStats propagates errors', async (t) => {
    stub(t, dashboardService, 'getDashboardStats', () => { throw new Error('stats failed'); });
    await assert.rejects(runHandler(getDashboardStats), /stats failed/);
});

test('getSizeColorAnalytics returns the service payload', async (t) => {
    stub(t, dashboardService, 'getSizeColorAnalytics', () => [{ size: 'M' }]);
    const result = await runHandler(getSizeColorAnalytics);
    assert.deepEqual(result.body, [{ size: 'M' }]);
});

test('getSizeColorAnalytics propagates errors', async (t) => {
    stub(t, dashboardService, 'getSizeColorAnalytics', () => { throw new Error('analytics failed'); });
    await assert.rejects(runHandler(getSizeColorAnalytics), /analytics failed/);
});
