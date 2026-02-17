import pool from './db.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { runMigrations } from './migrations_manager.js';

const SALT_ROUNDS = 10;
const REQUIRED_TABLES = [
    'users',
    'company_settings',
    'clients',
    'suppliers',
    'products',
    'inventory',
    'inventory_movements',
    'orders',
    'order_items',
    'transactions',
    'purchase_orders',
    'purchase_order_items',
    'receptions',
    'reception_items',
    'supplier_returns',
    'supplier_return_items',
    'supplier_payments',
    'invoices',
    'invoice_items',
    'warranty_claims',
    'client_returns',
    'client_return_items',
    'credit_notes',
    'cash_registers',
    'cash_shifts',
    'shift_payments',
    'audit_logs',
    'document_sequences'
];

async function assertRequiredTables() {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
        [REQUIRED_TABLES]
    );

    const found = new Set(rows.map((row) => row.TABLE_NAME));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
        throw new Error(`Missing required tables after migrations: ${missing.join(', ')}`);
    }
}

async function seedDefaultAdmin() {
    const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    if (admins.length > 0) return;

    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || crypto.randomBytes(8).toString('hex');
    if (!process.env.ADMIN_DEFAULT_PASSWORD) {
        console.log(`Generated admin password: ${adminPassword}`);
        console.log('Set ADMIN_DEFAULT_PASSWORD in .env to use a fixed password.');
    }

    const adminId = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
        [adminId, 'Admin User', 'admin@sports.store', hashedPassword, 'admin']
    );
}

async function seedCompanySettings() {
    const [settings] = await pool.query('SELECT id FROM company_settings WHERE id = 1 LIMIT 1');
    if (settings.length > 0) return;

    await pool.query(
        `INSERT INTO company_settings (id, brand_name, legal_name, tax_rate, default_currency)
         VALUES (1, 'Sports Store', 'Sports Store', 0.2100, 'ARS')`
    );
}

export const initDatabase = async () => {
    try {
        console.log('Checking for migrations...');
        await runMigrations();
        await assertRequiredTables();

        console.log('Seeding baseline data...');
        await seedDefaultAdmin();
        await seedCompanySettings();

        console.log('Database bootstrap completed.');
    } catch (err) {
        console.error('Database Initialization Error:', err);
        throw err;
    }
};
