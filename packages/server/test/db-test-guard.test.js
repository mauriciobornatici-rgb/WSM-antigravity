import test from 'node:test';
import assert from 'node:assert/strict';

import { assertTestDatabaseIsLocal } from '../config/db.js';

// AUD-018: a test run outside qa-runner loaded .env (production) and a background stock sync
// queried it. Under the test runner, only a local database may be used.
test('a test process refuses a remote database host and allows a local one', () => {
    const underRunner = { NODE_TEST_CONTEXT: 'child-v8' };
    assert.throws(() => assertTestDatabaseIsLocal({ ...underRunner, DB_HOST: 'srv123.hostinger.example' }, []), /non-local DB_HOST/);
    assert.throws(() => assertTestDatabaseIsLocal({ DB_HOST: '193.203.175.56' }, ['--test']), /non-local DB_HOST/);
    for (const host of ['127.0.0.1', 'localhost', '::1', undefined]) {
        assert.doesNotThrow(() => assertTestDatabaseIsLocal({ ...underRunner, DB_HOST: host }, []));
    }
    // Outside the test runner the server's own start-up check applies instead.
    assert.doesNotThrow(() => assertTestDatabaseIsLocal({ DB_HOST: 'srv123.hostinger.example' }, []));
});
