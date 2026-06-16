import test from 'node:test';
import assert from 'node:assert/strict';

import { schemas } from '../middleware/validationMiddleware.js';

test('companySettingsUpdate keeps Tiendanube integration credentials', () => {
    const payload = {
        body: {
            integrations: {
                tiendanube_client_id: 'app-123',
                tiendanube_client_secret: 'secret-456',
                tiendanube_access_token: 'token-789',
                tiendanube_store_id: 'store-101'
            }
        }
    };

    const value = schemas.companySettingsUpdate.parse(payload);

    assert.ok(value.body.integrations);
    assert.deepEqual(value.body.integrations, payload.body.integrations);
});
