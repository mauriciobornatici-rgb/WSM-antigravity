import test from 'node:test';
import assert from 'node:assert/strict';

import * as controller from '../controllers/salesController.js';
import salesService from '../services/sales.service.js';
import financeService from '../services/finance.service.js';
import pickupOrderCheckoutUseCase from '../domains/sales/PickupOrderCheckoutUseCase.js';
import posCheckoutUseCase from '../domains/sales/PosCheckoutUseCase.js';
import posExceptionsService from '../domains/sales/PosExceptionsService.js';
import auditService from '../services/audit.service.js';

function runHandler(handler, overrides = {}) {
    const req = {
        params: {},
        query: {},
        body: {},
        headers: {},
        ip: '127.0.0.1',
        ...overrides
    };

    return new Promise((resolve, reject) => {
        let statusCode = 200;
        let settled = false;
        const headers = {};
        const res = {
            status(code) {
                statusCode = code;
                return this;
            },
            setHeader(name, value) {
                headers[name] = value;
            },
            json(body) {
                settled = true;
                resolve({ status: statusCode, body, headers });
                return this;
            }
        };
        const next = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve({ status: statusCode, body: undefined, headers });
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

function codedError(errorCode, message = 'boom') {
    const err = new Error(message);
    err.errorCode = errorCode;
    return err;
}

test('getOrders without pagination returns the plain list with built filters', async (t) => {
    const calls = stub(t, salesService, 'getOrders', () => [{ id: 'o1' }]);
    const result = await runHandler(controller.getOrders, {
        query: { client_id: 'c1', status: 'pending', shipping_method: 'pickup' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, [{ id: 'o1' }]);
    assert.deepEqual(calls[0][0], { client_id: 'c1', status: 'pending', shipping_method: 'pickup' });
    assert.deepEqual(calls[0][1], { orderBy: 'created_at', order: 'DESC' });
    assert.deepEqual(result.headers, {});
});

test('getOrders ignores empty filters', async (t) => {
    const calls = stub(t, salesService, 'getOrders', () => []);
    await runHandler(controller.getOrders, { query: {} });
    assert.deepEqual(calls[0][0], {});
});

test('getOrders with pagination sets headers and returns rows', async (t) => {
    const calls = stub(t, salesService, 'getOrders', () => ({ rows: [{ id: 'o1' }], total: 120 }));
    const result = await runHandler(controller.getOrders, { query: { page: '2', limit: '50' } });
    assert.deepEqual(result.body, [{ id: 'o1' }]);
    assert.equal(calls[0][1].limit, 50);
    assert.equal(calls[0][1].offset, 50);
    assert.equal(calls[0][1].includeTotal, true);
    assert.equal(result.headers['X-Total-Count'], '120');
    assert.equal(result.headers['X-Page'], '2');
    assert.equal(result.headers['X-Total-Pages'], '3');
});

test('getOrders propagates service errors to next', async (t) => {
    stub(t, salesService, 'getOrders', () => { throw new Error('db down'); });
    await assert.rejects(runHandler(controller.getOrders), /db down/);
});

test('createOrder without idempotency key passes body through with user context', async (t) => {
    const calls = stub(t, salesService, 'createOrder', () => ({ id: 'o1' }));
    const result = await runHandler(controller.createOrder, {
        body: { client_id: 'c1', total_amount: 10 },
        user: { id: 'u1', role: 'seller' }
    });
    assert.deepEqual(result.body, { id: 'o1' });
    assert.deepEqual(calls[0][0], { client_id: 'c1', total_amount: 10 });
    assert.equal(calls[0][1], 'u1');
    assert.deepEqual(calls[0][2], { role: 'seller' });
});

test('createOrder with idempotency key maps to external pos source and total', async (t) => {
    const calls = stub(t, salesService, 'createOrder', () => ({ id: 'o1' }));
    await runHandler(controller.createOrder, {
        body: { idempotency_key: 'k1', total_amount: '15.5' },
        user: { id: 'u1', role: 'admin' }
    });
    assert.deepEqual(calls[0][0], {
        total_amount: '15.5',
        external_source: 'pos',
        external_id: 'k1',
        external_total_amount: 15.5
    });
});

test('createOrder with idempotency key and no total omits external total; no user is tolerated', async (t) => {
    const calls = stub(t, salesService, 'createOrder', () => ({ id: 'o1' }));
    await runHandler(controller.createOrder, { body: { idempotency_key: 'k2' } });
    assert.deepEqual(calls[0][0], { external_source: 'pos', external_id: 'k2' });
    assert.equal(calls[0][1], undefined);
    assert.deepEqual(calls[0][2], { role: undefined });
});

test('posCheckout delegates to the use case', async (t) => {
    const calls = stub(t, posCheckoutUseCase, 'execute', () => ({ ok: true }));
    const result = await runHandler(controller.posCheckout, {
        body: { items: [] },
        user: { id: 'u1', role: 'cashier' }
    });
    assert.deepEqual(result.body, { ok: true });
    assert.deepEqual(calls[0], [{ items: [] }, 'u1', { role: 'cashier' }]);
});

test('posCheckout works without an authenticated user', async (t) => {
    const calls = stub(t, posCheckoutUseCase, 'execute', () => ({ ok: true }));
    await runHandler(controller.posCheckout, { body: {} });
    assert.deepEqual(calls[0], [{}, undefined, { role: undefined }]);
});

test('listPosExceptions passes the query and falls back to an empty object', async (t) => {
    const calls = stub(t, posExceptionsService, 'list', () => [{ id: 'e1' }]);
    const first = await runHandler(controller.listPosExceptions, { query: { status: 'pending' } });
    assert.deepEqual(first.body, [{ id: 'e1' }]);
    assert.deepEqual(calls[0], [{ status: 'pending' }]);

    const second = await runHandler(controller.listPosExceptions, { query: undefined });
    assert.deepEqual(second.body, [{ id: 'e1' }]);
    assert.deepEqual(calls[1], [{}]);
});

test('reviewPosException passes id, body and reviewer', async (t) => {
    const calls = stub(t, posExceptionsService, 'review', () => ({ reviewed: true }));
    const result = await runHandler(controller.reviewPosException, {
        params: { id: 'e1' },
        body: { resolution: 'ok' },
        user: { id: 'u9' }
    });
    assert.deepEqual(result.body, { reviewed: true });
    assert.deepEqual(calls[0], ['e1', { resolution: 'ok' }, 'u9']);
});

test('updateOrderStatus transitions, audits old and new values', async (t) => {
    stub(t, salesService, 'findById', () => ({ id: 'o1', status: 'pending' }));
    const transitions = stub(t, salesService, 'transitionOrderStatus', () => ({ id: 'o1', status: 'picking' }));
    const audits = stub(t, auditService, 'log', () => undefined);

    const result = await runHandler(controller.updateOrderStatus, {
        params: { id: 'o1' },
        body: { status: 'picking' },
        user: { id: 'u1' }
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { id: 'o1', status: 'picking' });
    assert.deepEqual(transitions[0], ['o1', 'picking', 'u1']);
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0][0], {
        user_id: 'u1',
        action: 'UPDATE_ORDER_STATUS',
        entity_type: 'order',
        entity_id: 'o1',
        old_values: { id: 'o1', status: 'pending' },
        new_values: { status: 'picking' },
        ip_address: '127.0.0.1'
    });
});

test('updateOrderStatus audits null user and null previous', async (t) => {
    stub(t, salesService, 'findById', () => null);
    stub(t, salesService, 'transitionOrderStatus', () => ({ id: 'o1', status: 'picking' }));
    const audits = stub(t, auditService, 'log', () => undefined);

    await runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'picking' } });
    assert.equal(audits[0][0].user_id, null);
    assert.equal(audits[0][0].old_values, null);
});

test('updateOrderStatus skips audit when nothing was updated', async (t) => {
    stub(t, salesService, 'findById', () => null);
    stub(t, salesService, 'transitionOrderStatus', () => null);
    const audits = stub(t, auditService, 'log', () => undefined);

    const result = await runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'x' } });
    assert.equal(result.body, null);
    assert.equal(audits.length, 0);
});

test('updateOrderStatus maps domain errors to 404 / 409 without auditing', async (t) => {
    stub(t, salesService, 'findById', () => null);
    const audits = stub(t, auditService, 'log', () => undefined);
    let current = 'ORDER_NOT_FOUND';
    stub(t, salesService, 'transitionOrderStatus', () => { throw codedError(current, 'detalle'); });

    const notFound = await runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'x' } });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.body.error, 'not_found');

    current = 'INVALID_ORDER_TRANSITION';
    const invalid = await runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'x' } });
    assert.equal(invalid.status, 409);
    assert.deepEqual(invalid.body, { error: 'invalid_transition', message: 'detalle' });

    current = 'INVOICED_ORDER_REQUIRES_CREDIT_NOTE';
    const invoiced = await runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'x' } });
    assert.equal(invoiced.status, 409);
    assert.deepEqual(invoiced.body, { error: 'credit_note_required', message: 'detalle' });

    assert.equal(audits.length, 0);
});

test('updateOrderStatus rethrows unknown errors', async (t) => {
    stub(t, salesService, 'findById', () => null);
    stub(t, salesService, 'transitionOrderStatus', () => { throw codedError('OTHER', 'inesperado'); });
    await assert.rejects(
        runHandler(controller.updateOrderStatus, { params: { id: 'o1' }, body: { status: 'x' } }),
        /inesperado/
    );
});

// Plain delegating handlers: [handler, target, method, req overrides, expected args]
const delegations = [
    ['recordPickingEvent', salesService, 'recordPickingEvent', { params: { id: 'o1' }, body: { a: 1 }, user: { id: 'u1' } }, ['o1', { a: 1 }, 'u1']],
    ['dispatchOrder', salesService, 'dispatchOrder', { params: { id: 'o1' }, body: { carrier: 'x' }, user: { id: 'u1' } }, ['o1', { carrier: 'x' }, 'u1']],
    ['deliverOrder', salesService, 'deliverOrder', { params: { id: 'o1' }, body: { signed: true }, user: { id: 'u1' } }, ['o1', { signed: true }, 'u1']],
    ['pickOrderItem', salesService, 'pickOrderItem', { params: { id: 'o1' }, body: { picked_quantity: 3 }, user: { id: 'u1' } }, ['o1', 3, 'u1']],
    ['getOrderSummary', salesService, 'getOrderSummary', { params: { id: 'o1' } }, ['o1']],
    ['getInvoices', salesService, 'getInvoices', { query: { status: 'issued' } }, [{ status: 'issued' }]],
    ['createInvoice', salesService, 'createInvoice', { params: { id: 'o1' }, body: { type: 'B' }, user: { id: 'u1' } }, ['o1', { type: 'B' }, 'u1']],
    ['checkoutPickupOrder', pickupOrderCheckoutUseCase, 'execute', { params: { id: 'o1' }, body: { p: 1 }, user: { id: 'u1', role: 'seller' } }, ['o1', { p: 1 }, 'u1', { role: 'seller' }]],
    ['createManualInvoice', salesService, 'createManualInvoice', { body: { m: 1 }, user: { id: 'u1' } }, [{ m: 1 }, 'u1']],
    ['authorizeInvoice', salesService, 'authorizeInvoice', { params: { id: 'i1' }, user: { id: 'u1' } }, ['i1', 'u1']],
    ['registerInvoicePayments', financeService, 'registerInvoicePayments', { params: { id: 'i1' }, body: { payments: [] }, user: { id: 'u1' } }, ['i1', { payments: [] }, 'u1']],
    ['getTaxConditions', salesService, 'getTaxConditions', {}, []]
];

for (const [name, target, method, overrides, expectedArgs] of delegations) {
    test(`${name} delegates to ${method} and returns its result`, async (t) => {
        const calls = stub(t, target, method, () => ({ done: name }));
        const result = await runHandler(controller[name], overrides);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { done: name });
        assert.deepEqual(calls[0], expectedArgs);
    });

    test(`${name} propagates errors`, async (t) => {
        stub(t, target, method, () => { throw new Error(`fail-${name}`); });
        await assert.rejects(runHandler(controller[name], overrides), new RegExp(`fail-${name}`));
    });
}

test('getInvoices falls back to an empty filter object', async (t) => {
    const calls = stub(t, salesService, 'getInvoices', () => []);
    await runHandler(controller.getInvoices, { query: undefined });
    assert.deepEqual(calls[0], [{}]);
});

test('getInvoiceById returns the invoice or 404', async (t) => {
    let invoice = { id: 'i1' };
    const calls = stub(t, salesService, 'getInvoiceById', () => invoice);
    const found = await runHandler(controller.getInvoiceById, { params: { id: 'i1' } });
    assert.deepEqual(found.body, { id: 'i1' });
    assert.deepEqual(calls[0], ['i1']);

    invoice = null;
    const missing = await runHandler(controller.getInvoiceById, { params: { id: 'zz' } });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');
});

test('getInvoiceItems requires invoice_id and otherwise returns rows', async (t) => {
    const calls = stub(t, salesService, 'getInvoiceItems', () => [{ id: 1 }]);
    const missing = await runHandler(controller.getInvoiceItems, { query: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'missing_invoice_id');
    assert.equal(calls.length, 0);

    const ok = await runHandler(controller.getInvoiceItems, { query: { invoice_id: 'i1' } });
    assert.deepEqual(ok.body, [{ id: 1 }]);
    assert.deepEqual(calls[0], ['i1']);
});
