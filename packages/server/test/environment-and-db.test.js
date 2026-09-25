import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { assertSafeDatabaseTarget, buildEnvConfig, isLocalDatabaseHost } from '../config/env.js';
import { loadEnvironment } from '../config/loadEnv.js';

const ENV_KEYS = [
    'NODE_ENV',
    'ENV_FILE',
    'PORT',
    'DB_PORT',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'CORS_ORIGINS',
    'TRUST_PROXY',
    'ENCRYPTION_KEY',
    'DB_SSL',
    'DB_SSL_REJECT_UNAUTHORIZED',
    'ALLOW_INSECURE_NON_DEV',
    'API_RATE_LIMIT_WINDOW_MS',
    'API_RATE_LIMIT_MAX',
    'LOGIN_RATE_LIMIT_WINDOW_MS',
    'LOGIN_RATE_LIMIT_MAX',
    'APP_BASE_URL',
    'TIENDANUBE_WEBHOOK_URL',
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
];

let importCounter = 0;

async function importFresh(relativePath) {
    const url = new URL(relativePath, import.meta.url);
    url.searchParams.set('testCase', String(importCounter += 1));
    return import(url.href);
}

function replaceEnvironment(values = {}) {
    const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    return () => {
        for (const key of ENV_KEYS) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    };
}

test('environment loader selects explicit, environment and legacy files predictably', () => {
    const loaded = [];
    const warnings = [];
    const options = {
        rootDirectory: 'C:\\erp',
        load: (file) => loaded.push(file),
        warn: (message) => warnings.push(message),
    };

    const explicit = loadEnvironment({
        ...options,
        environment: { NODE_ENV: 'production', ENV_FILE: 'secrets\\prod.env' },
        exists: (file) => file.endsWith('secrets\\prod.env'),
    });
    assert.equal(explicit, 'C:\\erp\\secrets\\prod.env');

    const environmentFile = loadEnvironment({
        ...options,
        environment: { NODE_ENV: 'staging' },
        exists: (file) => file.endsWith('.env.staging'),
    });
    assert.equal(environmentFile, 'C:\\erp\\.env.staging');

    const legacy = loadEnvironment({
        ...options,
        environment: { NODE_ENV: 'development' },
        exists: (file) => file.endsWith('\\.env'),
    });
    assert.equal(legacy, 'C:\\erp\\.env');
    assert.ok(warnings.some((message) => message.includes('legacy .env')));
    assert.equal(loaded.length, 3);
});

test('environment loader fails for a missing explicit file and warns for missing non-development defaults', () => {
    const warnings = [];
    const common = { rootDirectory: 'C:\\erp', exists: () => false, warn: (message) => warnings.push(message) };

    assert.throws(() => loadEnvironment({
        ...common,
        environment: { NODE_ENV: 'production', ENV_FILE: 'missing.env' },
    }), /Explicit ENV_FILE does not exist/);

    assert.equal(loadEnvironment({ ...common, environment: { NODE_ENV: 'production' } }), null);
    assert.equal(loadEnvironment({ ...common, environment: { NODE_ENV: 'development' } }), null);
    assert.deepEqual(warnings, ['[env-warning] .env.production is missing; using process environment only']);
});

test('environment configuration normalizes development defaults deterministically', (t) => {
    const restore = replaceEnvironment({
        NODE_ENV: ' DEVELOPMENT ',
        JWT_SECRET: 'dev-secret',
        ENCRYPTION_KEY: '',
        PORT: '',
        DB_PORT: '',
        DB_SSL: '',
        DB_SSL_REJECT_UNAUTHORIZED: '',
        CORS_ORIGINS: '',
        APP_BASE_URL: '',
    });
    const warnings = [];
    t.after(restore);

    const first = buildEnvConfig(process.env, (message) => warnings.push(message));
    process.env.PORT = '9999';

    assert.equal(buildEnvConfig({ ...process.env, PORT: '' }, () => {}).port, first.port);
    assert.equal(first.nodeEnv, 'development');
    assert.equal(first.port, 3001);
    assert.equal(first.dbPort, 3306);
    assert.deepEqual(first.corsOrigins, ['http://localhost:5173']);
    assert.equal(first.appBaseUrl, 'http://localhost:5173');
    assert.equal(first.trustProxy, undefined);
    assert.equal(first.dbSsl, false);
    assert.equal(first.dbSslRejectUnauthorized, true);
    assert.ok(warnings.some((message) => message.includes('ENCRYPTION_KEY')));
});

test('environment configuration parses explicit booleans, limits, origins and proxy values', (t) => {
    const restore = replaceEnvironment({
        NODE_ENV: 'development',
        JWT_SECRET: 'dev-secret',
        ENCRYPTION_KEY: 'test-key',
        PORT: '4100',
        DB_PORT: '3307',
        DB_SSL: 'YES',
        DB_SSL_REJECT_UNAUTHORIZED: 'off',
        ALLOW_INSECURE_NON_DEV: '1',
        API_RATE_LIMIT_WINDOW_MS: '1000',
        API_RATE_LIMIT_MAX: '99',
        LOGIN_RATE_LIMIT_WINDOW_MS: '2000',
        LOGIN_RATE_LIMIT_MAX: '4',
        CORS_ORIGINS: ' https://uno.example, ,https://dos.example ',
        TRUST_PROXY: '2',
        APP_BASE_URL: 'http://localhost:4100',
        TIENDANUBE_WEBHOOK_URL: 'https://hooks.example/tiendanube',
    });
    t.after(restore);

    const config = buildEnvConfig(process.env);

    assert.equal(config.port, 4100);
    assert.equal(config.dbPort, 3307);
    assert.equal(config.dbSsl, true);
    assert.equal(config.dbSslRejectUnauthorized, false);
    assert.equal(config.allowInsecureNonDev, true);
    assert.deepEqual(config.corsOrigins, ['https://uno.example', 'https://dos.example']);
    assert.equal(config.trustProxy, 2);
    assert.equal(config.apiRateLimitMax, 99);
    assert.equal(config.loginRateLimitMax, 4);
});

test('environment configuration supports proxy aliases and a secure staging setup', (t) => {
    const restore = replaceEnvironment({
        NODE_ENV: 'staging',
        JWT_SECRET: 'a-secure-secret-with-more-than-32-characters',
        ENCRYPTION_KEY: 'encrypted-test-key',
        DB_SSL: 'on',
        DB_SSL_REJECT_UNAUTHORIZED: 'true',
        CORS_ORIGINS: 'https://staging.example',
        APP_BASE_URL: 'https://staging.example',
        TRUST_PROXY: 'true',
    });
    t.after(restore);

    const config = buildEnvConfig(process.env);
    assert.equal(config.isStaging, true);
    assert.equal(config.isNonDevelopment, true);
    assert.equal(config.trustProxy, 1);
    assert.equal(config.apiRateLimitMax, 2000);
});

test('environment validation rejects malformed scalar values', (t) => {
    const scenarios = [
        [{ NODE_ENV: 'qa', JWT_SECRET: 'secret' }, /Invalid NODE_ENV/],
        [{ NODE_ENV: 'development', JWT_SECRET: 'secret', DB_SSL: 'maybe' }, /Invalid boolean value/],
        [{ NODE_ENV: 'development', JWT_SECRET: 'secret', PORT: '0' }, /Invalid port value/],
        [{ NODE_ENV: 'development', JWT_SECRET: 'secret', DB_PORT: '70000' }, /Invalid port value/],
        [{ NODE_ENV: 'development', JWT_SECRET: 'secret', API_RATE_LIMIT_MAX: '-1' }, /Invalid positive integer/],
    ];

    for (const [values, expected] of scenarios) {
        const restore = replaceEnvironment(values);
        try {
            assert.throws(() => buildEnvConfig(process.env), expected);
        } finally {
            restore();
        }
    }
    t.after(() => {});
});

test('production validation reports unsafe URLs, credentials, SSL, CORS and proxy warnings together', (t) => {
    const restore = replaceEnvironment({
        NODE_ENV: 'production',
        JWT_SECRET: 'short',
        JWT_EXPIRES_IN: ' ',
        CORS_ORIGINS: '*,http://localhost:5173',
        APP_BASE_URL: 'http://localhost:5173',
        TIENDANUBE_WEBHOOK_URL: 'not-a-url',
        DB_SSL: 'false',
        TRUST_PROXY: 'false',
    });
    const warnings = [];
    t.after(restore);

    assert.throws(() => buildEnvConfig(process.env, (message) => warnings.push(message)), (error) => {
        assert.match(error.message, /ENCRYPTION_KEY is required/);
        assert.match(error.message, /JWT_EXPIRES_IN is required/);
        assert.match(error.message, /APP_BASE_URL must be/);
        assert.match(error.message, /TIENDANUBE_WEBHOOK_URL must be/);
        assert.match(error.message, /JWT_SECRET must be at least 32/);
        assert.match(error.message, /DB_SSL must be true/);
        assert.match(error.message, /wildcard/);
        return true;
    });
    assert.ok(warnings.some((message) => message.includes('localhost')));
    assert.ok(warnings.some((message) => message.includes('TRUST_PROXY')));
});

test('production validation requires origins/base URL and rejects disabled SSL verification', (t) => {
    const cases = [
        {
            values: {
                NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), ENCRYPTION_KEY: 'key',
                DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'true',
            },
            expected: /CORS_ORIGINS cannot be empty[\s\S]*APP_BASE_URL is required/,
        },
        {
            values: {
                NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), ENCRYPTION_KEY: 'key',
                DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false', CORS_ORIGINS: 'https://app.example',
                APP_BASE_URL: 'https://app.example', TRUST_PROXY: 'custom-proxy',
            },
            expected: /DB_SSL_REJECT_UNAUTHORIZED must be true/,
        },
    ];

    for (const { values, expected } of cases) {
        const restore = replaceEnvironment(values);
        try {
            assert.throws(() => buildEnvConfig(process.env), expected);
        } finally {
            restore();
        }
    }
    t.after(() => {});
});

test('development refuses a non-local database unless explicitly allowed', () => {
    const base = { NODE_ENV: 'development', JWT_SECRET: 'dev-secret', ENCRYPTION_KEY: 'key' };
    const configFor = (extra) => buildEnvConfig({ ...base, ...extra }, () => {});

    assert.throws(() => assertSafeDatabaseTarget(configFor({ DB_HOST: '193.203.175.56' })), /Refusing to start in development/);
    assert.throws(() => assertSafeDatabaseTarget(configFor({ DB_HOST: 'mysql.example.com' })), /ALLOW_REMOTE_DB/);
    assert.doesNotThrow(() => assertSafeDatabaseTarget(configFor({ DB_HOST: '193.203.175.56', ALLOW_REMOTE_DB: 'true' })));
    for (const host of ['127.0.0.1', 'localhost', '127.0.0.2', '::1', 'db', 'host.docker.internal']) {
        assert.doesNotThrow(() => assertSafeDatabaseTarget(configFor({ DB_HOST: host })), host);
    }
    assert.doesNotThrow(() => assertSafeDatabaseTarget(configFor({})));
    assert.equal(isLocalDatabaseHost('10.0.0.5'), false);
});

test('non-development environments reject published example secrets', () => {
    const secure = {
        NODE_ENV: 'production',
        JWT_SECRET: 'a-real-production-secret-with-more-than-32-characters',
        ENCRYPTION_KEY: 'f'.repeat(64),
        DB_PASSWORD: 'a-real-db-password',
        DB_SSL: 'true',
        CORS_ORIGINS: 'https://erp.example.com',
        APP_BASE_URL: 'https://erp.example.com',
        TRUST_PROXY: '1',
    };
    assert.doesNotThrow(() => buildEnvConfig(secure, () => {}));
    assert.throws(
        () => buildEnvConfig({ ...secure, ENCRYPTION_KEY: '0123456789abcdef'.repeat(4) }, () => {}),
        /ENCRYPTION_KEY reuse a published example value/
    );
    assert.throws(
        () => buildEnvConfig({ ...secure, ALLOW_INSECURE_NON_DEV: 'true', JWT_SECRET: 'wsm_staging_secret_jwt_key_at_least_32_chars_long_2026' }, () => {}),
        /JWT_SECRET reuse a published example value/
    );
    // The local staging simulation opts into insecure values explicitly.
    assert.doesNotThrow(() => buildEnvConfig({
        ...secure, NODE_ENV: 'staging', ALLOW_INSECURE_NON_DEV: 'true', DB_PASSWORD: 'wsm_staging_password_2026',
    }, () => {}));
});

test('database pool is lazy, applies SSL/options, binds methods and can be reopened', async (t) => {
    const restore = replaceEnvironment({
        NODE_ENV: 'development',
        JWT_SECRET: 'dev-secret',
        ENCRYPTION_KEY: 'key',
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
        DB_HOST: 'db.internal',
        DB_PORT: '3310',
        DB_USER: 'erp',
        DB_PASSWORD: 'password',
        DB_NAME: 'erp_test',
    });
    const originalCreatePool = mysql.createPool;
    const options = [];
    const pools = [];
    mysql.createPool = (poolOptions) => {
        options.push(poolOptions);
        const created = {
            marker: `pool-${options.length}`,
            ended: false,
            query() { return this.marker; },
            async end() { this.ended = true; },
        };
        pools.push(created);
        return created;
    };
    t.after(() => {
        mysql.createPool = originalCreatePool;
        restore();
    });

    const { default: pool, closePool } = await importFresh('../config/db.js');
    assert.equal(options.length, 0);
    assert.equal(pool.query(), 'pool-1');
    assert.equal(pool.marker, 'pool-1');
    assert.deepEqual(options[0], {
        host: 'db.internal', port: 3310, user: 'erp', password: 'password', database: 'erp_test',
        waitForConnections: true, connectionLimit: 10, queueLimit: 0,
        connectTimeout: 5000, stringifyObjects: true,
        ssl: { rejectUnauthorized: false },
    });

    pool.testOverride = 'local';
    assert.equal(pool.testOverride, 'local');
    await closePool();
    assert.equal(pools[0].ended, true);
    await closePool();
    assert.equal(pool.marker, 'pool-2');
});
