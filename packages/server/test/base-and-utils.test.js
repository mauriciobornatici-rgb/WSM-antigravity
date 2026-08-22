import test from 'node:test';
import assert from 'node:assert/strict';

import BaseService from '../services/base.service.js';
import { getPagination, applyPaginationHeaders } from '../utils/pagination.js';
import getRequestIp from '../utils/requestIp.js';
import { formatMoney } from '../utils/currency.js';
import {
    MAX_PRODUCT_IMAGE_UPLOAD_BYTES,
    MAX_PRODUCT_IMAGE_URL_LENGTH,
    normalizeProductImageUrl,
    parseProductImageDataUrl,
} from '../utils/imagePolicy.js';
import { mockPool } from './helpers/mockDb.js';

test('BaseService validates identifiers and pagination limits', () => {
    const service = new BaseService('products');
    assert.equal(service._validateColumn('name'), '`name`');
    assert.throws(() => service._validateColumn('name; DROP TABLE products'), /Invalid SQL identifier/);
    assert.throws(() => service._validateColumn('password'), /not allowed/);
    assert.equal(service._parseLimit(undefined), null);
    assert.equal(service._parseLimit('500'), 500);
    assert.throws(() => service._parseLimit(0), /Invalid limit/);
    assert.throws(() => service._parseLimit(501), /Invalid limit/);
    assert.throws(() => service._parseLimit(1.5), /Invalid limit/);
    assert.equal(service._parseOffset('0'), 0);
    assert.equal(service._parseOffset('12'), 12);
    assert.throws(() => service._parseOffset(-1), /Invalid offset/);
    assert.throws(() => service._parseOffset(1.2), /Invalid offset/);
});

test('BaseService CRUD uses allowlisted SQL and returns normalized records', async (t) => {
    const calls = [];
    let findByIdCount = 0;
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT *') && sql.includes('WHERE id = ?')) {
            findByIdCount += 1;
            return findByIdCount === 1 ? [[]] : [[{ id: 'product-1', name: 'Actualizado' }]];
        }
        if (sql.startsWith('SELECT *')) return [[{ id: 'product-1', name: 'Producto' }]];
        if (sql.startsWith('INSERT')) return [{ insertId: 99 }];
        return [{ affectedRows: 1 }];
    });

    const service = new BaseService('products');
    const rows = await service.findAll(
        { status: 'active', supplier_id: 'supplier-1' },
        { orderBy: 'created_at', order: 'desc', limit: '10', offset: '5' }
    );
    assert.equal(rows.length, 1);
    assert.match(calls[0].sql, /ORDER BY `created_at` DESC LIMIT \? OFFSET \?/);
    assert.deepEqual(calls[0].params, ['active', 'supplier-1', 10, 5]);

    assert.equal(await service.findById('missing'), null);
    assert.deepEqual(await service.create({ name: 'Nuevo', status: 'active' }), { id: 99, name: 'Nuevo', status: 'active' });
    assert.deepEqual(await service.create({ id: 'explicit', name: 'Con ID' }), { id: 'explicit', name: 'Con ID' });
    assert.equal((await service.update('product-1', { name: 'Actualizado' })).name, 'Actualizado');
    assert.equal((await service.delete('product-1')).success, true);
    assert.equal((await service.hardDelete('product-1')).success, true);
    assert.ok(calls.some(({ sql }) => sql.includes('deleted_at = CURRENT_TIMESTAMP')));
    assert.ok(calls.some(({ sql }) => sql.startsWith('DELETE FROM')));
});

test('BaseService defaults to ascending order and omits offset without a limit', async (t) => {
    const calls = [];
    mockPool(t, async (sql, params) => {
        calls.push({ sql, params });
        return [[]];
    });
    const service = new BaseService('clients');
    await service.findAll({}, { orderBy: 'name', order: 'unexpected', offset: 20 });
    assert.match(calls[0].sql, /ORDER BY `name` ASC$/);
    assert.deepEqual(calls[0].params, []);
});

test('pagination parser handles disabled, capped, page and explicit offset modes', () => {
    assert.deepEqual(getPagination(), { enabled: false, page: 1, limit: 50, offset: 0 });
    assert.deepEqual(getPagination({ page: '3', limit: '25' }), { enabled: true, page: 3, limit: 25, offset: 50 });
    assert.deepEqual(getPagination({ page: 'bad', limit: '999', offset: '7' }, { defaultLimit: 20, maxLimit: 100 }), {
        enabled: true, page: 1, limit: 100, offset: 7
    });
    assert.deepEqual(getPagination({ limit: '-2', offset: '-1' }, { defaultLimit: 15 }), {
        enabled: true, page: 1, limit: 15, offset: 0
    });
});

test('pagination headers only emit for enabled pagination', () => {
    const headers = {};
    const response = { setHeader: (name, value) => { headers[name] = value; } };
    applyPaginationHeaders(response, { enabled: false }, 100);
    assert.deepEqual(headers, {});
    applyPaginationHeaders(response, { enabled: true, page: 2, limit: 10 }, 21);
    assert.deepEqual(headers, {
        'X-Total-Count': '21', 'X-Page': '2', 'X-Limit': '10', 'X-Total-Pages': '3'
    });
    applyPaginationHeaders(response, { enabled: true, page: 1, limit: 0 }, 0);
    assert.equal(headers['X-Total-Pages'], '1');
});

test('request IP prioritizes the first forwarded address', () => {
    assert.equal(getRequestIp({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.2' }, ip: '127.0.0.1' }), '203.0.113.5');
    assert.equal(getRequestIp({ headers: {}, ip: '127.0.0.1' }), '127.0.0.1');
    assert.equal(getRequestIp({ headers: { 'x-forwarded-for': [] }, ip: '::1' }), '::1');
});

test('image policy covers empty, malformed, oversized and supported payloads', () => {
    assert.equal(normalizeProductImageUrl(null), null);
    assert.equal(normalizeProductImageUrl('   '), null);
    assert.throws(() => normalizeProductImageUrl(123), (error) => error.errorCode === 'INVALID_IMAGE_URL');
    assert.throws(() => normalizeProductImageUrl(`https://example.com/${'a'.repeat(MAX_PRODUCT_IMAGE_URL_LENGTH)}`), (error) => error.errorCode === 'IMAGE_URL_TOO_LONG');
    assert.throws(() => normalizeProductImageUrl('data:image/png;base64,AA=='), (error) => error.errorCode === 'DATA_URL_NOT_ALLOWED');
    assert.throws(() => normalizeProductImageUrl('not a url'), /no es valida/);
    assert.throws(() => normalizeProductImageUrl('file:///tmp/image.png'), /http o https/);

    assert.throws(() => parseProductImageDataUrl(null), (error) => error.errorCode === 'INVALID_IMAGE_UPLOAD_PAYLOAD');
    assert.throws(() => parseProductImageDataUrl('data:image/svg+xml;base64,AA=='), (error) => error.errorCode === 'INVALID_IMAGE_UPLOAD_FORMAT');
    const jpg = parseProductImageDataUrl('data:image/jpeg;base64,/9j/2Q==');
    assert.equal(jpg.extension, 'jpg');
    assert.equal(jpg.mimeType, 'image/jpeg');
    const gif = parseProductImageDataUrl('data:image/gif;base64,R0lGODlh');
    assert.equal(gif.mimeType, 'image/gif');
    const oversized = Buffer.alloc(MAX_PRODUCT_IMAGE_UPLOAD_BYTES + 1, 1).toString('base64');
    assert.throws(() => parseProductImageDataUrl(`data:image/png;base64,${oversized}`), (error) => error.errorCode === 'IMAGE_UPLOAD_TOO_LARGE');
});

test('Argentine money formatter handles null, invalid and negative values', () => {
    assert.equal(formatMoney(null), '$ 0,00');
    assert.equal(formatMoney('not-a-number'), '$ 0,00');
    assert.equal(formatMoney(-1234.5), '$ -1.234,50');
});
