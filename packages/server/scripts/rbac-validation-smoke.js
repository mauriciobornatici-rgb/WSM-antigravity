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
            name: 'warehouse can start the picking of an order (unknown order -> 404, not 403)',
            method: 'PUT',
            endpoint: '/api/orders/00000000-0000-4000-8000-000000000000/status',
            token: warehouse,
            expected: 404,
            body: { status: 'picking' }
        },
        {
            name: 'warehouse cannot cancel an order',
            method: 'PUT',
            endpoint: '/api/orders/00000000-0000-4000-8000-000000000000/status',
            token: warehouse,
            expected: 403,
            body: { status: 'cancelled' }
        },
        {
            name: 'warehouse cannot reissue an invoice',
            method: 'POST',
            endpoint: '/api/invoices/00000000-0000-4000-8000-000000000000/reissue',
            token: warehouse,
            expected: 403,
            body: { invoice_type: 'B' }
        },
        {
            name: 'reissue of an unknown invoice is 404',
            method: 'POST',
            endpoint: '/api/invoices/00000000-0000-4000-8000-000000000000/reissue',
            token: cashier,
            expected: 404,
            body: { invoice_type: 'B' }
        },
        {
            name: 'warehouse cannot load a customer VAT condition',
            method: 'PUT',
            endpoint: '/api/clients/00000000-0000-4000-8000-000000000000/tax-condition',
            token: warehouse,
            expected: 403,
            body: { tax_condition_id: 'tc_ConsFinal' }
        },
        {
            name: 'an unknown VAT condition is rejected',
            method: 'PUT',
            endpoint: '/api/clients/00000000-0000-4000-8000-000000000000/tax-condition',
            token: cashier,
            expected: 400,
            body: { tax_condition_id: 'tc_Inventada' }
        },
        {
            name: 'warehouse cannot read ARCA alerts',
            method: 'GET',
            endpoint: '/api/fiscal/arca-alerts',
            token: warehouse,
            expected: 403
        },
        {
            name: 'cashier cannot import products',
            method: 'POST',
            endpoint: '/api/imports/products/preview',
            token: cashier,
            expected: 403,
            body: { rows: [{ row: 2, sku: 'RBAC-1', name: 'x', sale_price: 1 }] }
        },
        {
            name: 'warehouse cannot import clients',
            method: 'POST',
            endpoint: '/api/imports/clients/preview',
            token: warehouse,
            expected: 403,
            body: { rows: [{ row: 2, name: 'Cliente RBAC' }] }
        },
        {
            name: 'cashier can preview a client import (nothing is saved)',
            method: 'POST',
            endpoint: '/api/imports/clients/preview',
            token: cashier,
            expected: 200,
            body: { rows: [{ row: 2, name: 'Cliente RBAC' }] }
        },
        {
            name: 'an unknown import kind is 404',
            method: 'POST',
            endpoint: '/api/imports/orders/preview',
            token: manager,
            expected: 404,
            body: { rows: [{ row: 2 }] }
        },
        {
            name: 'an import batch bigger than allowed is rejected',
            method: 'POST',
            endpoint: '/api/imports/suppliers/commit',
            token: manager,
            expected: 400,
            body: { rows: Array.from({ length: 51 }, (_, index) => ({ row: index + 2, name: `Proveedor ${index}` })), batch_id: '00000000-0000-4000-8000-000000000000' }
        },
        {
            // ADR-027: a free movement carried any cost into the cost of goods sold.
            name: 'free inventory movements are closed, even for a manager',
            method: 'POST',
            endpoint: '/api/inventory-movements',
            token: manager,
            expected: 404,
            body: { type: 'adjustment', product_id: '11111111-1111-4111-8111-111111111111', quantity: 1, unit_cost: 1 }
        },
        {
            name: 'goods are not invoiced without their delivery note',
            method: 'POST',
            endpoint: '/api/supplier-invoices',
            token: manager,
            expected: 409,
            body: {
                invoice_number: '0001-RBAC', invoice_type: 'A', supplier_id: '11111111-1111-4111-8111-111111111111',
                issue_date: '2026-10-17', net_amount: 100, vat_amount: 21, vat_rate: 21, total_amount: 121
            }
        },
        {
            // ADR-029: a supplier credit note lowers the debt and posts: purchasing only.
            name: 'warehouse cannot load a supplier credit note',
            method: 'POST',
            endpoint: '/api/supplier-credit-notes',
            token: warehouse,
            expected: 403,
            body: { supplier_invoice_id: '11111111-1111-4111-8111-111111111111', credit_note_number: '0001-RBAC', issue_date: '2026-10-22', net_amount: 10, vat_amount: 2.1 }
        },
        {
            name: 'a supplier credit note needs an invoice that expects it',
            method: 'POST',
            endpoint: '/api/supplier-credit-notes',
            token: manager,
            expected: 404,
            body: { supplier_invoice_id: '11111111-1111-4111-8111-111111111111', credit_note_number: '0001-RBAC', issue_date: '2026-10-22', net_amount: 10, vat_amount: 2.1 }
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
