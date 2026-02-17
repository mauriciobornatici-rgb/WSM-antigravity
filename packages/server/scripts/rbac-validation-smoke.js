import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });

const baseUrl = process.env.SMOKE_API_URL || `http://localhost:${process.env.PORT || 3001}`;
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
    console.error('SMOKE ERROR: JWT_SECRET is not configured.');
    process.exit(1);
}

function tokenForRole(role) {
    return jwt.sign(
        {
            id: '00000000-0000-0000-0000-000000000001',
            email: `smoke+${role}@test.local`,
            role
        },
        jwtSecret,
        { expiresIn: '1h' }
    );
}

async function request(method, endpoint, token, body) {
    const headers = {
        Authorization: `Bearer ${token}`
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let parsedBody = null;
    const raw = await res.text();
    if (raw) {
        try {
            parsedBody = JSON.parse(raw);
        } catch {
            parsedBody = raw;
        }
    }

    return {
        status: res.status,
        body: parsedBody
    };
}

function summarizeBody(body) {
    if (!body) return '';
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    return serialized.length > 200 ? `${serialized.slice(0, 200)}...` : serialized;
}

async function ensureHealth() {
    const health = await fetch(`${baseUrl}/api/health`);
    if (health.status !== 200) {
        console.error(`Health check failed: ${health.status}`);
        process.exit(1);
    }
}

async function run() {
    await ensureHealth();

    const admin = tokenForRole('admin');
    const manager = tokenForRole('manager');
    const cashier = tokenForRole('cashier');
    const warehouse = tokenForRole('warehouse');

    const tests = [
        {
            name: 'cashier can read cash registers',
            method: 'GET',
            endpoint: '/api/cash-registers',
            token: cashier,
            expected: 200
        },
        {
            name: 'cashier cannot read transactions',
            method: 'GET',
            endpoint: '/api/transactions',
            token: cashier,
            expected: 403
        },
        {
            name: 'cashier cannot read suppliers',
            method: 'GET',
            endpoint: '/api/suppliers',
            token: cashier,
            expected: 403
        },
        {
            name: 'cashier can read clients',
            method: 'GET',
            endpoint: '/api/clients',
            token: cashier,
            expected: 200
        },
        {
            name: 'warehouse can read purchase orders',
            method: 'GET',
            endpoint: '/api/purchase-orders',
            token: warehouse,
            expected: 200
        },
        {
            name: 'warehouse cannot create purchase orders',
            method: 'POST',
            endpoint: '/api/purchase-orders',
            token: warehouse,
            expected: 403,
            body: {
                supplier_id: '11111111-1111-1111-1111-111111111111',
                order_date: '2026-02-16',
                items: [
                    {
                        product_id: '11111111-1111-1111-1111-111111111111',
                        quantity_ordered: 1,
                        unit_cost: 1
                    }
                ]
            }
        },
        {
            name: 'warehouse can read receptions',
            method: 'GET',
            endpoint: '/api/receptions',
            token: warehouse,
            expected: 200
        },
        {
            name: 'admin can read settings company',
            method: 'GET',
            endpoint: '/api/settings/company',
            token: admin,
            expected: 200
        },
        {
            name: 'manager cannot read settings company',
            method: 'GET',
            endpoint: '/api/settings/company',
            token: manager,
            expected: 403
        },
        {
            name: 'invalid order status is rejected',
            method: 'GET',
            endpoint: '/api/orders?status=invalid_status',
            token: admin,
            expected: 400
        },
        {
            name: 'invalid client id path is rejected',
            method: 'GET',
            endpoint: '/api/clients/not-a-uuid',
            token: admin,
            expected: 400
        },
        {
            name: 'invoice-items requires invoice_id query',
            method: 'GET',
            endpoint: '/api/invoice-items',
            token: admin,
            expected: 400
        }
    ];

    let failures = 0;

    for (const test of tests) {
        const res = await request(test.method, test.endpoint, test.token, test.body);
        if (res.status === test.expected) {
            console.log(`PASS: ${test.name} -> ${res.status}`);
        } else {
            failures += 1;
            console.log(`FAIL: ${test.name} -> expected ${test.expected}, got ${res.status}`);
            const body = summarizeBody(res.body);
            if (body) {
                console.log(`      body: ${body}`);
            }
        }
    }

    if (failures > 0) {
        console.error(`Smoke failed with ${failures} failing checks.`);
        process.exit(1);
    }

    console.log('Smoke passed: all RBAC/validation checks succeeded.');
}

run().catch((err) => {
    console.error('Smoke execution error:', err.message);
    process.exit(1);
});
