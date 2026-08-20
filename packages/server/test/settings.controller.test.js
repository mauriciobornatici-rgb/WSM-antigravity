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
