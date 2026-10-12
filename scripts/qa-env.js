/**
 * Deterministic, non-production environments used by the QA wrappers.
 *
 * This module intentionally imports only Node built-ins. Callers must validate
 * the returned values before importing any module that creates a DB pool or
 * starts the application.
 */

export const QA_DATABASE = Object.freeze({
    host: '127.0.0.1',
    port: '33308',
    user: 'wsm_qa',
    password: 'wsm_qa_password_2026',
    name: 'wsm_qa',
});

export const ISOLATED_TEST_DATABASE = Object.freeze({
    host: '127.0.0.1',
    port: '1',
    user: 'wsm_qa_isolated',
    password: 'wsm_qa_isolated_placeholder',
    name: 'wsm_qa_isolated',
});

export const QA_BOOTSTRAP_FLAG = 'WSM_QA_BOOTSTRAP';
export const QA_MODE_FLAG = 'WSM_QA_MODE';

const FAKE_JWT_SECRET = 'wsm-qa-only-jwt-secret-never-use-outside-tests-2026';
const FAKE_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const SAFE_INHERITED_KEYS = new Set([
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'TEMP',
    'TMP',
    'OS',
    'PROCESSOR_ARCHITECTURE',
    'PROCESSOR_IDENTIFIER',
    'NUMBER_OF_PROCESSORS',
    'CI',
]);

const CONFIG_KEYS = [
    'NODE_ENV',
    'ENV_FILE',
    'PORT',
    'APP_BASE_URL',
    'VITE_API_URL',
    'CORS_ORIGINS',
    'TRUST_PROXY',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'DB_SSL',
    'DB_SSL_REJECT_UNAUTHORIZED',
    'ALLOW_INSECURE_NON_DEV',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'ENCRYPTION_KEY',
    'API_RATE_LIMIT_WINDOW_MS',
    'API_RATE_LIMIT_MAX',
    'LOGIN_RATE_LIMIT_WINDOW_MS',
    'LOGIN_RATE_LIMIT_MAX',
    'TIENDANUBE_WEBHOOK_URL',
    'SMOKE_API_URL',
    'SMOKE_MUTATION',
    'SMOKE_RECEPTION_FLOW',
    'SMOKE_CASH_FLOW',
    'SMOKE_SUPPLIER_ID',
    'SMOKE_PRODUCT_ID',
    'SMOKE_CASH_REGISTER_ID',
    'ADMIN_DEFAULT_PASSWORD',
    QA_BOOTSTRAP_FLAG,
    QA_MODE_FLAG,
];

function copySafeProcessValues(source) {
    const result = {};
    for (const [key, value] of Object.entries(source ?? {})) {
        if (SAFE_INHERITED_KEYS.has(key) && value !== undefined) {
            result[key] = String(value);
        }
    }
    return result;
}

function buildRuntimeEnvironment(database, source = process.env) {
    return {
        ...copySafeProcessValues(source),
        NODE_ENV: 'development',
        ENV_FILE: '.env.example',
        PORT: '3001',
        APP_BASE_URL: 'http://127.0.0.1:5173',
        VITE_API_URL: 'http://127.0.0.1:3001',
        CORS_ORIGINS: 'http://127.0.0.1:5173',
        TRUST_PROXY: 'false',
        DB_HOST: database.host,
        DB_PORT: database.port,
        DB_USER: database.user,
        DB_PASSWORD: database.password,
        DB_NAME: database.name,
        DB_SSL: 'false',
        DB_SSL_REJECT_UNAUTHORIZED: 'true',
        ALLOW_INSECURE_NON_DEV: 'false',
        JWT_SECRET: FAKE_JWT_SECRET,
        JWT_EXPIRES_IN: '1h',
        ENCRYPTION_KEY: FAKE_ENCRYPTION_KEY,
        API_RATE_LIMIT_WINDOW_MS: '900000',
        API_RATE_LIMIT_MAX: '1200',
        LOGIN_RATE_LIMIT_WINDOW_MS: '900000',
        LOGIN_RATE_LIMIT_MAX: '8',
        TIENDANUBE_WEBHOOK_URL: '',
        SMOKE_API_URL: '',
        SMOKE_MUTATION: '0',
        SMOKE_RECEPTION_FLOW: '0',
        SMOKE_CASH_FLOW: '0',
        SMOKE_SUPPLIER_ID: '',
        SMOKE_PRODUCT_ID: '',
        SMOKE_CASH_REGISTER_ID: '',
    };
}

export function buildIsolatedTestEnvironment(source = process.env) {
    return buildRuntimeEnvironment(ISOLATED_TEST_DATABASE, source);
}

export function buildQaEnvironment(source = process.env) {
    return {
        ...buildRuntimeEnvironment(QA_DATABASE, source),
        [QA_MODE_FLAG]: '1',
    };
}

export function installCleanEnvironment(environment, target = process.env) {
    for (const key of Object.keys(target)) {
        if (!SAFE_INHERITED_KEYS.has(key)) delete target[key];
    }
    for (const key of CONFIG_KEYS) delete target[key];
    Object.assign(target, environment);
}

export function isLoopbackHost(host) {
    const normalized = String(host ?? '').trim().toLowerCase();
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function assertMatches(actual, expected, name, failures) {
    if (String(actual ?? '') !== String(expected)) {
        failures.push(`${name} must be ${expected}`);
    }
}

export function assertIsolatedTestEnvironment(environment = process.env) {
    const failures = [];
    assertMatches(environment.NODE_ENV, 'development', 'NODE_ENV', failures);
    assertMatches(environment.ENV_FILE, '.env.example', 'ENV_FILE', failures);
    if (!isLoopbackHost(environment.DB_HOST)) failures.push('DB_HOST must be loopback');
    assertMatches(environment.DB_PORT, ISOLATED_TEST_DATABASE.port, 'DB_PORT', failures);
    assertMatches(environment.DB_NAME, ISOLATED_TEST_DATABASE.name, 'DB_NAME', failures);
    assertMatches(environment.JWT_SECRET, FAKE_JWT_SECRET, 'JWT_SECRET', failures);
    assertMatches(environment.ENCRYPTION_KEY, FAKE_ENCRYPTION_KEY, 'ENCRYPTION_KEY', failures);

    if (failures.length > 0) {
        throw new Error(`Unsafe isolated test environment:\n- ${failures.join('\n- ')}`);
    }
    return true;
}

export function assertQaDatabaseEnvironment(environment = process.env, { requireBootstrapFlag = false } = {}) {
    const failures = [];
    assertMatches(environment.NODE_ENV, 'development', 'NODE_ENV', failures);
    assertMatches(environment.ENV_FILE, '.env.example', 'ENV_FILE', failures);
    if (!isLoopbackHost(environment.DB_HOST)) failures.push('DB_HOST must be loopback');
    assertMatches(environment.DB_PORT, QA_DATABASE.port, 'DB_PORT', failures);
    assertMatches(environment.DB_NAME, QA_DATABASE.name, 'DB_NAME', failures);
    assertMatches(environment.DB_USER, QA_DATABASE.user, 'DB_USER', failures);
    assertMatches(environment.DB_PASSWORD, QA_DATABASE.password, 'DB_PASSWORD', failures);
    assertMatches(environment.JWT_SECRET, FAKE_JWT_SECRET, 'JWT_SECRET', failures);
    assertMatches(environment.ENCRYPTION_KEY, FAKE_ENCRYPTION_KEY, 'ENCRYPTION_KEY', failures);
    if (requireBootstrapFlag && environment[QA_BOOTSTRAP_FLAG] !== '1') {
        failures.push(`${QA_BOOTSTRAP_FLAG}=1 is required for database bootstrap`);
    }

    if (failures.length > 0) {
        throw new Error(`Unsafe QA database environment:\n- ${failures.join('\n- ')}`);
    }
    return true;
}

export function qaModeEnabled(environment = process.env) {
    return environment[QA_MODE_FLAG] === '1';
}
