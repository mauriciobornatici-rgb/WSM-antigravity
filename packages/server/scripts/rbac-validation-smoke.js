import '../config/loadEnv.js';
import { closeSmokeAuth, tokensForRoles } from './smoke-auth.js';
import { ensureSmokeServer } from './smoke-runner-helper.js';

let baseUrl = process.env.SMOKE_API_URL || `http://localhost:${process.env.PORT || 3001}`;
const jwtSecret = process.env.JWT_SECRET;
let serverCleanup = null;

if (!jwtSecret) {
    console.error('SMOKE ERROR: JWT_SECRET is not configured.');
    process.exit(1);
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
        throw new Error(`Health check failed: ${health.status}`);
    }
}

async function run() {
    const serverInstance = await ensureSmokeServer(baseUrl);
    baseUrl = serverInstance.baseUrl;
    serverCleanup = serverInstance.cleanup;

    await ensureHealth();

    const {
        admin,
        manager,
        cashier,
        warehouse
    } = await tokensForRoles(['admin', 'manager', 'cashier', 'warehouse'], jwtSecret);

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
        },
        {
            name: 'cashier can read ARCA alerts',
            method: 'GET',
            endpoint: '/api/fiscal/arca-alerts',
            token: cashier,
            expected: 200
        },
        {
            name: 'warehouse cannot read ARCA alerts',
            method: 'GET',
            endpoint: '/api/fiscal/arca-alerts',
            token: warehouse,
            expected: 403
        },
        {
            name: 'manager can list POS exceptions',
            method: 'GET',
            endpoint: '/api/pos/exceptions',
            token: manager,
            expected: 200
        },
        {
            name: 'cashier cannot list POS exceptions',
            method: 'GET',
            endpoint: '/api/pos/exceptions',
            token: cashier,
            expected: 403
        },
        {
            name: 'cashier cannot review POS exceptions',
            method: 'POST',
            endpoint: '/api/pos/exceptions/1/review',
            token: cashier,
            expected: 403,
            body: { decision: 'approved' }
        },
        {
            name: 'warehouse cannot run a POS checkout',
            method: 'POST',
            endpoint: '/api/pos/checkout',
            token: warehouse,
            expected: 403,
            body: {
                idempotency_key: '11111111-1111-4111-8111-111111111111',
                shift_id: '11111111-1111-4111-8111-111111111111',
                payments: [{ method: 'cash', amount: 1 }],
                items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }]
            }
        },
        {
            name: 'POS checkout rejects a payload without shift',
            method: 'POST',
            endpoint: '/api/pos/checkout',
            token: cashier,
            expected: 400,
            body: {
                idempotency_key: '11111111-1111-4111-8111-111111111111',
                payments: [{ method: 'cash', amount: 1 }],
                items: [{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }]
            }
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
        throw new Error(`Smoke failed with ${failures} failing checks.`);
    }

    console.log('Smoke passed: all RBAC/validation checks succeeded.');
}

run()
    .catch((err) => {
        console.error('Smoke execution error:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (serverCleanup) await serverCleanup();
        await closeSmokeAuth();
    });
