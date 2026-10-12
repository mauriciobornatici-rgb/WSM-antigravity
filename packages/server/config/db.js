import mysql from 'mysql2/promise';
import { getEnvConfig } from './env.js';

const env = getEnvConfig();

let _pool = null;

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

const poolProxy = new Proxy({}, {
    get: (target, prop) => {
        if (prop in target) {
            return target[prop];
        }
        const p = getPool();
        if (typeof p[prop] === 'function') {
            return p[prop].bind(p);
        }
        return p[prop];
    },
    set: (target, prop, value) => {
        target[prop] = value;
        return true;
    }
});

export default poolProxy;
