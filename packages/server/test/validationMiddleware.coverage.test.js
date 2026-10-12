import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { validate, validateZod, zodSchemas, schemas } from '../middleware/validationMiddleware.js';

function run(middleware, req) {
    const state = { status: null, body: null, nextCalls: [] };
    const res = {
        status(code) {
            state.status = code;
            return this;
        },
        json(body) {
            state.body = body;
            return this;
        }
    };
    middleware(req, res, (...args) => state.nextCalls.push(args));
    return state;
}

const schema = z.object({
    body: z.object({ name: z.string().trim().min(1), qty: z.coerce.number().int() }).strict().optional(),
    params: z.object({ id: z.coerce.number().int().positive() }).optional(),
    query: z.object({ page: z.coerce.number().int().default(1) }).optional()
});

test('exports aliases pointing at the same implementations', () => {
    assert.equal(validateZod, validate);
    assert.equal(schemas, zodSchemas);
});

test('replaces body and params with the parsed (coerced, trimmed) values and calls next()', () => {
    const req = { body: { name: '  Pelota  ', qty: '3' }, params: { id: '7' }, query: {} };
    const state = run(validate(schema), req);
    assert.deepEqual(state.nextCalls, [[]]);
    assert.equal(state.status, null);
    assert.deepEqual(req.body, { name: 'Pelota', qty: 3 });
    assert.deepEqual(req.params, { id: 7 });
    assert.equal(req.validatedQuery, undefined);
});

test('exposes parsed query as req.validatedQuery and merges it into req.query', () => {
    const req = { body: {}, params: {}, query: { page: '4' } };
    const state = run(validate(schema), req);
    assert.deepEqual(state.nextCalls, [[]]);
    assert.deepEqual(req.validatedQuery, { page: 4 });
    assert.equal(req.query.page, 4);
});

test('tolerates missing body/params/query objects', () => {
    const state = run(validate(z.object({ body: z.undefined().optional() })), {});
    assert.deepEqual(state.nextCalls, [[]]);
});

test('rejects invalid input with 400 validation_error and never calls next', () => {
    const req = { body: { name: '', qty: 'abc' }, params: { id: '-1' }, query: {} };
    const original = JSON.parse(JSON.stringify(req));
    const state = run(validate(schema), req);
    assert.equal(state.status, 400);
    assert.equal(state.body.error, 'validation_error');
    assert.equal(state.body.message, 'Datos de entrada invalidos (Zod)');
    assert.equal(state.nextCalls.length, 0);
    const paths = state.body.details.map((d) => d.path.join('.'));
    assert.ok(paths.includes('body.name'));
    assert.ok(paths.includes('body.qty'));
    assert.ok(paths.includes('params.id'));
    for (const detail of state.body.details) assert.equal(typeof detail.message, 'string');
    // Request is left untouched on failure.
    assert.deepEqual(req, original);
});

test('rejects unknown keys on strict schemas (no mass assignment)', () => {
    const req = { body: { name: 'x', qty: 1, role: 'admin' }, params: {}, query: {} };
    const state = run(validate(schema), req);
    assert.equal(state.status, 400);
    assert.equal(state.nextCalls.length, 0);
});

test('forwards non-validation errors to next(error) instead of answering 400', () => {
    const failure = new Error('schema exploded');
    const exploding = { parse() { throw failure; } };
    const state = run(validate(exploding), { body: {}, params: {}, query: {} });
    assert.equal(state.status, null);
    assert.deepEqual(state.nextCalls, [[failure]]);
});

test('zodSchemas.idParam only accepts a UUID id', () => {
    const ok = run(validate(zodSchemas.idParam), {
        body: {}, query: {}, params: { id: '123e4567-e89b-42d3-a456-426614174000' }
    });
    assert.deepEqual(ok.nextCalls, [[]]);

    const bad = run(validate(zodSchemas.idParam), { body: {}, query: {}, params: { id: '1; DROP TABLE' } });
    assert.equal(bad.status, 400);
});

test('zodSchemas.login rejects an empty body and accepts a well-formed credential payload', () => {
    const empty = run(validate(zodSchemas.login), { body: {}, params: {}, query: {} });
    assert.equal(empty.status, 400);

    const bad = run(validate(zodSchemas.login), { body: { email: 'not-an-email', password: '' }, params: {}, query: {} });
    assert.equal(bad.status, 400);

    const req = { body: { email: 'a@b.com', password: 'secret' }, params: {}, query: {} };
    assert.deepEqual(run(validate(zodSchemas.login), req).nextCalls, [[]]);
    assert.deepEqual(req.body, { email: 'a@b.com', password: 'secret' });
});

test('posExceptionReview coerces the numeric id and validates the body', () => {
    const okReq = { body: { decision: 'approved', notes: '  ok  ' }, params: { id: '12' }, query: {} };
    assert.deepEqual(run(validate(zodSchemas.posExceptionReview), okReq).nextCalls, [[]]);
    assert.deepEqual(okReq.params, { id: 12 });
    assert.deepEqual(okReq.body, { decision: 'approved', notes: 'ok' });

    const bad = run(validate(zodSchemas.posExceptionReview), {
        body: { decision: 'nope' }, params: { id: '12' }, query: {}
    });
    assert.equal(bad.status, 400);

    const badId = run(validate(zodSchemas.posExceptionReview), {
        body: { decision: 'approved' }, params: { id: '0' }, query: {}
    });
    assert.equal(badId.status, 400);
});
