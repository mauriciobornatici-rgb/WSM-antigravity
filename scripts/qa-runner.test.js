import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
    assertIsolatedTestEnvironment,
    assertQaDatabaseEnvironment,
    buildIsolatedTestEnvironment,
    buildQaEnvironment,
    installCleanEnvironment,
    qaModeEnabled,
} from './qa-env.js';
import { commandFor } from './qa-runner.js';
import { ensureSmokeServer } from '../packages/server/scripts/smoke-runner-helper.js';

test('isolated environment ignores inherited remote DB and secret values', () => {
    const environment = buildIsolatedTestEnvironment({
        DB_HOST: 'db.remote.example',
        DB_PORT: '3306',
        DB_NAME: 'production_database',
        JWT_SECRET: 'real-secret-from-parent-process',
        ENV_FILE: '.env.production',
        SMOKE_API_URL: 'http://remote.example:3001',
        SMOKE_MUTATION: '1',
        AWS_SECRET_ACCESS_KEY: 'must-not-be-copied',
    });

    assert.equal(environment.ENV_FILE, '.env.example');
    assert.equal(environment.DB_HOST, '127.0.0.1');
    assert.equal(environment.DB_PORT, '1');
    assert.equal(environment.DB_NAME, 'wsm_qa_isolated');
    assert.equal(environment.SMOKE_API_URL, '');
    assert.equal(environment.SMOKE_MUTATION, '0');
    assert.notEqual(environment.JWT_SECRET, 'real-secret-from-parent-process');
    assert.equal(Object.hasOwn(environment, 'AWS_SECRET_ACCESS_KEY'), false);
    assert.doesNotThrow(() => assertIsolatedTestEnvironment(environment));
});

test('isolated guard rejects a changed loopback target before app/db import', () => {
    const environment = buildIsolatedTestEnvironment();
    environment.DB_HOST = '192.0.2.10';
    assert.throws(() => assertIsolatedTestEnvironment(environment), /DB_HOST must be loopback/);
});

test('QA database guard requires the exact dedicated database and explicit bootstrap flag', () => {
    const environment = buildQaEnvironment();
    assert.doesNotThrow(() => assertQaDatabaseEnvironment(environment));
    assert.throws(
        () => assertQaDatabaseEnvironment(environment, { requireBootstrapFlag: true }),
        /WSM_QA_BOOTSTRAP=1 is required/
    );

    const bootstrapEnvironment = { ...environment, WSM_QA_BOOTSTRAP: '1' };
    assert.doesNotThrow(() => assertQaDatabaseEnvironment(bootstrapEnvironment, { requireBootstrapFlag: true }));

    const remoteEnvironment = { ...bootstrapEnvironment, DB_NAME: 'wsm_sports_erp' };
    assert.throws(() => assertQaDatabaseEnvironment(remoteEnvironment), /DB_NAME must be wsm_qa/);
});

test('clean environment installation drops inherited secrets while preserving executable paths', () => {
    const target = {
        Path: 'C:\\safe-bin',
        DB_HOST: 'db.remote.example',
        AWS_SECRET_ACCESS_KEY: 'real-secret',
    };
    installCleanEnvironment(buildIsolatedTestEnvironment({ Path: 'C:\\safe-bin' }), target);
    assert.equal(target.Path, 'C:\\safe-bin');
    assert.equal(Object.hasOwn(target, 'AWS_SECRET_ACCESS_KEY'), false);
    assert.equal(target.DB_HOST, '127.0.0.1');
});

test('QA mode is explicit and the runner keeps the existing coverage thresholds', () => {
    assert.equal(qaModeEnabled(buildQaEnvironment()), true);
    assert.equal(qaModeEnabled(buildIsolatedTestEnvironment()), false);
    assert.deepEqual(commandFor('coverage').args, [
        '--experimental-test-coverage',
        '--test-coverage-lines=90',
        '--test-coverage-branches=90',
        '--test-coverage-functions=90',
        '--test',
    ]);
});

test('QA smoke helper never reuses a reachable target server', async () => {
    let targetRequests = 0;
    const targetServer = http.createServer((_request, response) => {
        targetRequests += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"status":"target"}');
    });
    await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = targetServer.address().port;

    const ephemeral = await ensureSmokeServer(`http://127.0.0.1:${targetPort}`, {
        application: (_request, response) => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end('{"status":"ephemeral"}');
        },
        environment: buildQaEnvironment(),
    });

    try {
        assert.notEqual(ephemeral.baseUrl, `http://127.0.0.1:${targetPort}`);
        const response = await fetch(`${ephemeral.baseUrl}/api/live`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ephemeral' });
        assert.equal(targetRequests, 0);
    } finally {
        await ephemeral.cleanup();
        await new Promise((resolve) => targetServer.close(resolve));
    }
});

test('QA smoke helper rejects a remote configuration before importing the app', async () => {
    await assert.rejects(
        () => ensureSmokeServer('http://203.0.113.10:3001', {
            application: () => {
                throw new Error('app import should not happen');
            },
            environment: {
                WSM_QA_MODE: '1',
                NODE_ENV: 'development',
                ENV_FILE: '.env.example',
                DB_HOST: '203.0.113.10',
                DB_PORT: '33308',
                DB_NAME: 'wsm_qa',
                DB_USER: 'wsm_qa',
                DB_PASSWORD: 'wsm_qa_password_2026',
                JWT_SECRET: 'wsm-qa-only-jwt-secret-never-use-outside-tests-2026',
                ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            },
        }),
        /DB_HOST must be loopback/
    );
});
