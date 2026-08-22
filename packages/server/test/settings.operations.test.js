import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCompanySettingsResponse,
    getCompanySettings,
    getCompanyPublicProfile,
    updateCompanySettings,
    getAuditLogs,
    testAfipConnection
} from '../controllers/settingsController.js';
import auditService from '../services/audit.service.js';
import afipService from '../services/afip.service.js';
import { mockPool } from './helpers/mockDb.js';

function invoke(handler, req = {}) {
    return new Promise((resolve, reject) => {
        const result = { statusCode: 200, headers: {} };
        const res = {
            status(code) { result.statusCode = code; return this; },
            set(name, value) { result.headers[name] = value; return this; },
            setHeader(name, value) { result.headers[name] = value; },
            json(body) { result.body = body; resolve(result); return this; }
        };
        handler(req, res, reject);
    });
}

test('company settings defaults and normalization are safe for an empty installation', () => {
    const empty = buildCompanySettingsResponse(null);
    assert.equal(empty.operation.tax_rate, 0.21);
    assert.equal(empty.operation.default_currency, 'ARS');
    assert.equal(empty.billing.pos, 1);
    const normalized = buildCompanySettingsResponse({ tax_rate: '21', default_currency: ' usd ' });
    assert.equal(normalized.operation.tax_rate, 0.21);
    assert.equal(normalized.operation.default_currency, 'USD');
    const invalid = buildCompanySettingsResponse({ tax_rate: 'invalid', default_currency: 'PESOS' });
    assert.equal(invalid.operation.tax_rate, 0.21);
    assert.equal(invalid.operation.default_currency, 'ARS');
    assert.equal(buildCompanySettingsResponse({ tax_rate: 250 }).operation.tax_rate, 1);
    assert.equal(buildCompanySettingsResponse({ tax_rate: -5 }).operation.tax_rate, 0);
});

test('private and public company endpoints return the same redacted profile', async (t) => {
    mockPool(t, async () => [[{ brand_name: 'WSM', billing_afip_key: 'secret' }]]);
    const privateResult = await invoke(getCompanySettings, {});
    const publicResult = await invoke(getCompanyPublicProfile, {});
    assert.equal(privateResult.body.identity.brand_name, 'WSM');
    assert.deepEqual(privateResult.body, publicResult.body);
    assert.equal(privateResult.body.billing.afip_key, '');
});

test('updateCompanySettings preserves omitted secrets, normalizes operation and audits', async (t) => {
    const calls = [];
    const previous = {
        brand_name: 'Anterior', tax_rate: 0.105, default_currency: 'ars', billing_pos: 2,
        billing_afip_crt: 'crt', billing_afip_key: 'key', billing_afip_env: 'homologacion',
        tiendanube_access_token: 'token', tiendanube_store_id: 'store', tiendanube_location_id: 'loc',
        tiendanube_client_id: 'client', tiendanube_client_secret: 'secret'
    };
    const connection = mockPool(t, async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes('FOR UPDATE')) return [[previous]];
        if (String(sql).startsWith('SELECT * FROM company_settings WHERE id = 1 LIMIT 1')) {
            return [[{ ...previous, brand_name: 'Nuevo', tax_rate: 0.21, default_currency: 'USD' }]];
        }
        return [[]];
    });
    let committed = false;
    connection.commit = async () => { committed = true; };
    const originalAudit = auditService.log;
    let audit;
    auditService.log = async (payload) => { audit = payload; };
    t.after(() => { auditService.log = originalAudit; });
    const result = await invoke(updateCompanySettings, {
        body: { identity: { brand_name: 'Nuevo' }, operation: { tax_rate: 21, default_currency: 'usd' }, integrations: {} },
        user: { id: 'u-1' }, headers: { 'x-forwarded-for': '10.0.0.1' }, socket: {}
    });
    assert.deepEqual(result.body, { success: true });
    assert.equal(committed, true);
    assert.equal(audit.action, 'UPDATE_COMPANY_SETTINGS');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO company_settings'));
    assert.ok(insert.params.includes('Nuevo'));
    assert.ok(insert.params.includes(0.21));
    assert.ok(insert.params.includes('USD'));
    assert.ok(insert.params.includes('token'));
});

test('updateCompanySettings rolls back and forwards database errors', async (t) => {
    let rolledBack = false;
    const connection = mockPool(t, async (sql) => {
        if (String(sql).includes('FOR UPDATE')) return [[]];
        throw new Error('database unavailable');
    });
    connection.rollback = async () => { rolledBack = true; };
    await assert.rejects(
        () => invoke(updateCompanySettings, { body: {}, headers: {}, socket: {} }),
        /database unavailable/
    );
    assert.equal(rolledBack, true);
});

test('audit endpoint supports unpaged and paged filtered responses', async (t) => {
    const original = auditService.getLogs;
    const calls = [];
    auditService.getLogs = async (filters, options) => {
        calls.push({ filters, options });
        return options ? { rows: [{ id: 'a-2' }], total: 25 } : [{ id: 'a-1' }];
    };
    t.after(() => { auditService.getLogs = original; });
    const unpaged = await invoke(getAuditLogs, { query: { pagination: 'false', entity_type: 'order' } });
    const paged = await invoke(getAuditLogs, { query: { page: '2', limit: '10', entity_id: 'o-1' } });
    assert.equal(unpaged.body[0].id, 'a-1');
    assert.equal(paged.body[0].id, 'a-2');
    assert.deepEqual(calls[0].filters, { entity_type: 'order' });
    assert.deepEqual(calls[1].filters, { entity_id: 'o-1' });
    assert.equal(calls[1].options.offset, 10);
    assert.equal(paged.headers['X-Total-Count'], '25');
});

test('ARCA connection test reports missing credentials, success and upstream failure', async (t) => {
    let mode = 'missing';
    mockPool(t, async () => {
        if (mode === 'missing') return [[{}]];
        return [[{
            tax_id: '30700000001', billing_pos: 3, billing_afip_env: 'homologacion',
            billing_afip_crt: 'crt', billing_afip_key: 'key'
        }]];
    });
    const original = afipService.getLastVoucher;
    const originalError = console.error;
    console.error = () => {};
    afipService.getLastVoucher = async () => 9;
    t.after(() => {
        afipService.getLastVoucher = original;
        console.error = originalError;
    });
    const missing = await invoke(testAfipConnection, {});
    mode = 'success';
    const success = await invoke(testAfipConnection, {});
    afipService.getLastVoucher = async () => { throw new Error('ARCA offline'); };
    const failure = await invoke(testAfipConnection, {});
    assert.equal(missing.statusCode, 422);
    assert.equal(success.body.nextVoucherNumber, 10);
    assert.equal(failure.statusCode, 502);
    assert.equal(failure.body.success, false);
});
