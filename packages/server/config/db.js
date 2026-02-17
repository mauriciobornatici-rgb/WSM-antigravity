import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEnvConfig } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const env = getEnvConfig();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: env.dbPort,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sports_erp',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(env.dbSsl ? { ssl: { rejectUnauthorized: env.dbSslRejectUnauthorized } } : {})
});

export default pool;
