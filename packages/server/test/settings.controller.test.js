import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompanySettingsResponse } from '../controllers/settingsController.js';

test('public company settings response redacts Tiendanube secrets and AFIP secrets', () => {
    const encryptedKey = 'encrypted-afip-private-key';
    const encryptedCert = 'encrypted-afip-cert';
    const encryptedTnToken = 'encrypted-tn-token';
    const encryptedTnSecret = 'encrypted-tn-secret';

    const response = buildCompanySettingsResponse({
        billing_afip_key: encryptedKey,
        billing_afip_crt: encryptedCert,
        tiendanube_access_token: encryptedTnToken,
        tiendanube_store_id: 'store-123',
        tiendanube_client_id: 'client-123',
        tiendanube_client_secret: encryptedTnSecret
    });

    assert.equal(response.integrations.tiendanube_store_id, 'store-123');
    assert.equal(response.integrations.tiendanube_access_token, '');
    assert.equal(response.integrations.tiendanube_client_id, 'client-123');
    assert.equal(response.integrations.tiendanube_client_secret, '');
    assert.equal(response.integrations.tiendanube_access_token_configured, true);
    assert.equal(response.integrations.tiendanube_client_secret_configured, true);
    assert.equal(response.billing.afip_key, '');
    assert.equal(response.billing.afip_crt, '');
    assert.equal(response.billing.afip_credentials_configured, true);
});

test('internal company settings response never returns decrypted secrets', () => {
    const encryptedKey = 'encrypted-afip-private-key';
    const encryptedCert = 'encrypted-afip-cert';
    const encryptedTnToken = 'encrypted-tn-token';
    const encryptedTnSecret = 'encrypted-tn-secret';

    const response = buildCompanySettingsResponse({
        billing_afip_key: encryptedKey,
        billing_afip_crt: encryptedCert,
        tiendanube_access_token: encryptedTnToken,
        tiendanube_store_id: 'store-123',
        tiendanube_client_id: 'client-123',
        tiendanube_client_secret: encryptedTnSecret
    });

    assert.equal(response.integrations.tiendanube_store_id, 'store-123');
    assert.equal(response.integrations.tiendanube_access_token, '');
    assert.equal(response.integrations.tiendanube_client_id, 'client-123');
    assert.equal(response.integrations.tiendanube_client_secret, '');
    assert.equal(response.billing.afip_key, '');
    assert.equal(response.billing.afip_crt, '');
});

test('company settings response normalizes tax, currency and incomplete legacy records', () => {
    const empty = buildCompanySettingsResponse(null);
    assert.equal(empty.operation.tax_rate, 0.21);
    assert.equal(empty.operation.default_currency, 'ARS');
    assert.equal(empty.billing.pos, 1);
    assert.equal(empty.integrations.tiendanube_access_token_configured, false);

    const percent = buildCompanySettingsResponse({ tax_rate: '21', default_currency: ' usd ', billing_pos: 3 });
    assert.equal(percent.operation.tax_rate, 0.21);
    assert.equal(percent.operation.default_currency, 'USD');
    assert.equal(percent.billing.pos, 3);

    assert.equal(buildCompanySettingsResponse({ tax_rate: 250 }).operation.tax_rate, 1);
    assert.equal(buildCompanySettingsResponse({ tax_rate: -5 }).operation.tax_rate, 0);
    assert.equal(buildCompanySettingsResponse({ tax_rate: 'invalid' }).operation.tax_rate, 0.21);
    assert.equal(buildCompanySettingsResponse({ default_currency: 'xx' }).operation.default_currency, 'ARS');
    assert.equal(buildCompanySettingsResponse({ default_currency: 123 }).operation.default_currency, 'ARS');

    const partialSecrets = buildCompanySettingsResponse({
        billing_afip_crt: 'cert-only', tiendanube_access_token: 'token-only',
        billing_iva_condition: '', billing_afip_env: '',
    });
    assert.equal(partialSecrets.billing.afip_credentials_configured, false);
    assert.equal(partialSecrets.billing.iva_condition, 'Responsable Inscripto');
    assert.equal(partialSecrets.billing.afip_env, 'homologacion');
    assert.equal(partialSecrets.integrations.tiendanube_access_token_configured, true);
    assert.equal(partialSecrets.integrations.tiendanube_client_secret_configured, false);
});
