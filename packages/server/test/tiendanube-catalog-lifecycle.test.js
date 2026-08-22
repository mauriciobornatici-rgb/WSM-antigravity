import test from 'node:test';
import assert from 'node:assert/strict';

import { TiendaNubeService } from '../services/tiendanube.service.js';

test('catalog detail returns null and updates only allowlisted family/product fields', async () => {
    const calls = [];
    let familyRows = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT * FROM tiendanube_catalog_families')) return [familyRows];
        if (statement.includes('SELECT v.id, v.family_id')) return [[{ id: 'v', stock: '2' }]];
        return [[]];
    } }, http: {} });
    assert.equal(await service.getCatalogFamily('missing'), null);
    familyRows = [{ id: 'f', name: 'Anterior' }];
    const unchanged = await service.updateCatalogFamily('f', { forbidden: 'x' });
    assert.equal(unchanged.variant_count, 1);
    const updated = await service.updateCatalogFamily('f', {
        name: 'Nuevo', description: 'Descripción', brand: null, category: 'Ropa', visibility: 'visible'
    });
    assert.equal(updated.total_stock, 2);
    assert.ok(calls.some((call) => call.sql.includes('UPDATE tiendanube_catalog_families')));
    assert.ok(calls.some((call) => call.sql.includes('UPDATE products p JOIN')));
});

test('archiveCatalogFamily handles missing, local and connected remote products', async () => {
    let mode = 'missing';
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql) => {
        calls.push(String(sql));
        if (String(sql).startsWith('SELECT remote_product_id')) {
            if (mode === 'missing') return [[]];
            if (mode === 'local') return [[{ remote_product_id: null }]];
            return [[{ remote_product_id: 'remote-1' }]];
        }
        return [[]];
    } }, http: {} });
    assert.equal(await service.archiveCatalogFamily('f'), false);
    mode = 'local';
    assert.equal(await service.archiveCatalogFamily('f'), true);
    mode = 'remote';
    service.getCredentials = async () => ({ storeId: 's', accessToken: 't' });
    let hidden = false;
    service.apiRequest = async (_method, _creds, path, data) => {
        hidden = path === '/products/remote-1' && data.visibility === 'hidden';
    };
    assert.equal(await service.archiveCatalogFamily('f'), true);
    assert.equal(hidden, true);
    assert.ok(calls.some((sql) => sql.includes("SET p.status = 'inactive'")));
});

test('publishCatalogFamily validates connection, family and variants', async () => {
    const disconnected = new TiendaNubeService({ db: {}, http: {} });
    disconnected.getCredentials = async () => null;
    await assert.rejects(() => disconnected.publishCatalogFamily('f'), (e) => e.errorCode === 'TIENDANUBE_NOT_CONNECTED');

    const missing = new TiendaNubeService({ db: { query: async () => [[]] }, http: {} });
    missing.getCredentials = async () => ({ storeId: 's' });
    await assert.rejects(() => missing.publishCatalogFamily('f'), (e) => e.statusCode === 404);

    const empty = new TiendaNubeService({ db: { query: async () => [[{ id: 'f' }]] }, http: {} });
    empty.getCredentials = async () => ({ storeId: 's' });
    empty.getCatalogFamily = async () => ({ variants: [] });
    await assert.rejects(() => empty.publishCatalogFamily('f'), /no tiene variantes/);
});

test('publishCatalogFamily creates and links every matching remote variant', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('SELECT * FROM tiendanube_catalog_families')) return [[{ id: 'f', name: 'Camiseta', visibility: 'hidden' }]];
        return [[]];
    } }, http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    service.getCatalogFamily = async () => ({ variants: [
        { id: 'v-1', product_id: 'p-1', sku: 'SKU-1', sale_price: 10, stock: 2 },
        { id: 'v-2', product_id: 'p-2', sku: 'NO-MATCH', sale_price: 20, stock: 1 }
    ] });
    service.apiRequest = async () => ({ data: {
        id: 99, visibility: 'visible', updated_at: '2026-08-22T12:00:00Z', variants: [{ id: 100, sku: 'SKU-1' }]
    } });
    const result = await service.publishCatalogFamily('f');
    assert.equal(result.remoteProductId, '99');
    assert.ok(calls.some((call) => call.sql.includes('UPDATE tiendanube_catalog_variants')));
    assert.ok(calls.some((call) => call.sql.includes('UPDATE products SET tiendanube_product_id')));
});

test('publishCatalogFamily records a bounded remote error before rethrowing', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('SELECT * FROM tiendanube_catalog_families')) return [[{ id: 'f', name: 'X', remote_product_id: '9' }]];
        return [[]];
    } }, http: {} });
    service.getCredentials = async () => ({ storeId: 's' });
    service.getCatalogFamily = async () => ({ variants: [{ sku: 'A' }] });
    service.apiRequest = async () => {
        const error = new Error('fallback');
        error.response = { data: { description: 'rechazo remoto' } };
        throw error;
    };
    await assert.rejects(() => service.publishCatalogFamily('f'), /fallback/);
    assert.ok(calls.some((call) => call.params?.[0] === 'rechazo remoto'));
});

test('remote customer persistence validates id and normalizes identity fields', async () => {
    const calls = [];
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        calls.push({ sql: String(sql), params }); return [[]];
    } }, http: {} });
    await assert.rejects(() => service.persistRemoteCustomer({}), /customer id is required/);
    const result = await service.persistRemoteCustomer({ id: 1, first_name: 'Ana', last_name: 'Pérez', total_spent: '10.5', orders_count: '2' });
    assert.deepEqual(result, { externalId: '1', name: 'Ana Pérez' });
    assert.ok(calls[0].params.includes(10.5));
    assert.ok(calls[0].params.includes(2));
});

test('remote product persistence creates missing products, inventory and links existing SKUs', async () => {
    const calls = [];
    let productLookup = 0;
    const service = new TiendaNubeService({ db: { query: async (sql, params) => {
        const statement = String(sql);
        calls.push({ sql: statement, params });
        if (statement.includes('SELECT id FROM tiendanube_catalog_families')) return [[]];
        if (statement.includes('SELECT id FROM products WHERE sku')) {
            productLookup += 1;
            return productLookup === 1 ? [[]] : [[{ id: 'existing-product' }]];
        }
        return [[]];
    } }, http: {} });
    const result = await service.persistRemoteProduct({
        id: 50,
        name: { es: 'Camiseta' },
        description: { es: 'Edición QA' },
        brand: 'WSM', visibility: 'visible', updated_at: '2026-08-22T12:00:00Z',
        categories: [{ name: { es: 'Ropa' } }],
        attributes: [{ es: 'Talle' }, { es: 'Color' }],
        images: [{ src: 'https://example.test/a.jpg' }],
        variants: [
            { id: 1, sku: '', price: 1 },
            { id: 2, sku: 'NEW-S-RED', values: [{ es: 'S' }, { es: 'Rojo' }], cost: 5, price: 10, stock: 3 },
            { id: 3, sku: 'EXISTING', values: [], cost: 6, price: 12, stock: 0 }
        ]
    });
    assert.equal(result.remoteProductId, '50');
    assert.equal(result.linkedCount, 2);
    assert.equal(result.skippedCount, 1);
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO products')));
    assert.ok(calls.some((call) => call.sql.includes('INSERT INTO inventory (')));
    assert.ok(calls.some((call) => call.params?.includes('existing-product')));
});

test('remote import entrypoints require credentials and delegate fetched payloads', async () => {
    const service = new TiendaNubeService({ db: {}, http: {} });
    service.getCredentials = async () => null;
    await assert.rejects(() => service.importRemoteProduct('1'), /Credenciales/);
    await assert.rejects(() => service.importRemoteCustomer('1'), /Credenciales/);
    service.getCredentials = async () => ({ storeId: 's' });
    service.apiRequest = async (_method, _creds, path) => ({ data: { id: path.endsWith('/1') ? 1 : 2 } });
    service.persistRemoteProduct = async (data) => ({ product: data.id });
    service.persistRemoteCustomer = async (data) => ({ customer: data.id });
    assert.deepEqual(await service.importRemoteProduct('1'), { product: 1 });
    assert.deepEqual(await service.importRemoteCustomer('2'), { customer: 2 });
});
