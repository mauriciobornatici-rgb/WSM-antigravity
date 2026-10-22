import mysql from 'mysql2/promise';
import { getEnvConfig, isLocalDatabaseHost } from './env.js';

const env = getEnvConfig();

let _pool = null;

// A test process never talks to a remote database (AUD-018: a test run outside qa-runner loaded
// .env, which points to production, and a background stock sync queried it). Node's test runner
// marks its processes with NODE_TEST_CONTEXT.
export function assertTestDatabaseIsLocal(environment = process.env, execArgv = process.execArgv) {
    const underTestRunner = Boolean(environment.NODE_TEST_CONTEXT) || execArgv.includes('--test');
    if (underTestRunner && !isLocalDatabaseHost(environment.DB_HOST || 'localhost')) {
        throw new Error(`Refusing to open a database connection from a test to non-local DB_HOST '${environment.DB_HOST}'.`);
    }
}

const getPool = () => {
    if (!_pool) {
        _pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            port: env.dbPort,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'sports_erp',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            connectTimeout: 5000,
            // Un objeto recibido del cliente nunca se expande a `col` = valor en un placeholder.
            stringifyObjects: true,
            ...(env.dbSsl ? { ssl: { rejectUnauthorized: env.dbSslRejectUnauthorized } } : {})
        });
    }
    return _pool;
};

export const closePool = async () => {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
};

const CONNECTING_METHODS = new Set(['query', 'execute', 'getConnection']);

const poolProxy = new Proxy({}, {
    get: (target, prop) => {
        if (prop in target) {
            return target[prop];
        }
        const p = getPool();
        if (typeof p[prop] === 'function') {
            const bound = p[prop].bind(p);
            // Checked when used, not when read: tests read pool.query to put it back after a mock.
            return CONNECTING_METHODS.has(prop)
                ? (...args) => { assertTestDatabaseIsLocal(); return bound(...args); }
                : bound;
        }
        return p[prop];
    },
    set: (target, prop, value) => {
        target[prop] = value;
        return true;
    }
});

export default poolProxy;
