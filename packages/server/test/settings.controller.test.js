import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompanySettingsResponse } from '../controllers/settingsController.js';
import { encrypt } from '../utils/crypto.js';

test('public company settings response redacts Tiendanube secrets and AFIP secrets', () => {
    const encryptedKey = encrypt('afip-private-key');
    const encryptedCert = encrypt('afip-cert');
    const encryptedTnToken = encrypt('tn-token');
    const encryptedTnSecret = encrypt('tn-secret');

    const response = buildCompanySettingsResponse({
        billing_afip_key: encryptedKey,
        billing_afip_crt: encryptedCert,
        tiendanube_access_token: encryptedTnToken,
        tiendanube_store_id: 'store-123',
        tiendanube_client_id: 'client-123',
        tiendanube_client_secret: encryptedTnSecret
    }, { includeSecrets: false });

    assert.equal(response.integrations.tiendanube_store_id, 'store-123');
    assert.equal(response.integrations.tiendanube_access_token, '');
    assert.equal(response.integrations.tiendanube_client_id, '');
    assert.equal(response.integrations.tiendanube_client_secret, '');
    assert.equal(response.billing.afip_key, '');
    assert.equal(response.billing.afip_crt, '');
});

test('internal company settings response decrypts secrets', () => {
    const encryptedKey = encrypt('afip-private-key');
    const encryptedCert = encrypt('afip-cert');
    const encryptedTnToken = encrypt('tn-token');
    const encryptedTnSecret = encrypt('tn-secret');

    const response = buildCompanySettingsResponse({
        billing_afip_key: encryptedKey,
        billing_afip_crt: encryptedCert,
        tiendanube_access_token: encryptedTnToken,
        tiendanube_store_id: 'store-123',
        tiendanube_client_id: 'client-123',
        tiendanube_client_secret: encryptedTnSecret
    }, { includeSecrets: true });

    assert.equal(response.integrations.tiendanube_store_id, 'store-123');
    assert.equal(response.integrations.tiendanube_access_token, 'tn-token');
    assert.equal(response.integrations.tiendanube_client_id, 'client-123');
    assert.equal(response.integrations.tiendanube_client_secret, 'tn-secret');
    assert.equal(response.billing.afip_key, 'afip-private-key');
    assert.equal(response.billing.afip_crt, 'afip-cert');
});
