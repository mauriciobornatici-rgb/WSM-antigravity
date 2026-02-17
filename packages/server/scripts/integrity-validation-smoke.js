import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });

const baseUrl = process.env.SMOKE_API_URL || `http://localhost:${process.env.PORT || 3001}`;
const jwtSecret = process.env.JWT_SECRET;
const runMutation = process.env.SMOKE_MUTATION === '1';
const runReceptionFlow = process.env.SMOKE_RECEPTION_FLOW === '1';
const runCashFlow = process.env.SMOKE_CASH_FLOW === '1';

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
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

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
    return serialized.length > 220 ? `${serialized.slice(0, 220)}...` : serialized;
}

function isExpectedStatus(actual, expected) {
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
}

function expectedLabel(expected) {
    return Array.isArray(expected) ? expected.join(' or ') : String(expected);
}

let failures = 0;

function reportResult(name, res, expected) {
    if (isExpectedStatus(res.status, expected)) {
        console.log(`PASS: ${name} -> ${res.status}`);
        return;
    }
    failures += 1;
    console.log(`FAIL: ${name} -> expected ${expectedLabel(expected)}, got ${res.status}`);
    const body = summarizeBody(res.body);
    if (body) console.log(`      body: ${body}`);
}

function reportSkip(name, reason) {
    console.log(`SKIP: ${name} -> ${reason}`);
}

async function ensureHealth() {
    const health = await fetch(`${baseUrl}/api/health`);
    if (health.status !== 200) {
        console.error(`Health check failed: ${health.status}`);
        process.exit(1);
    }
}

async function runReadOnlyIntegrityChecks(adminToken) {
    const missingReceptionId = crypto.randomUUID();
    const missingClientId = crypto.randomUUID();
    const missingSupplierId = crypto.randomUUID();

    const checks = [
        {
            name: 'invalid reception id path is rejected',
            method: 'POST',
            endpoint: '/api/receptions/not-a-uuid/approve',
            expected: 400
        },
        {
            name: 'approve missing reception returns 404',
            method: 'POST',
            endpoint: `/api/receptions/${missingReceptionId}/approve`,
            expected: 404
        },
        {
            name: 'delete missing client returns 404',
            method: 'DELETE',
            endpoint: `/api/clients/${missingClientId}`,
            expected: 404
        },
        {
            name: 'delete missing supplier returns 404',
            method: 'DELETE',
            endpoint: `/api/suppliers/${missingSupplierId}`,
            expected: 404
        }
    ];

    for (const check of checks) {
        const res = await request(check.method, check.endpoint, adminToken, check.body);
        reportResult(check.name, res, check.expected);
    }
}

async function runSoftDeleteMutationChecks(adminToken) {
    const ts = Date.now();

    const clientPayload = {
        name: `Smoke Client ${ts}`,
        tax_id: `SMK-C-${ts}`,
        email: `smoke-client-${ts}@example.com`,
        phone: '0000000000',
        address: 'Smoke Street 1',
        credit_limit: 0
    };

    const createClient = await request('POST', '/api/clients', adminToken, clientPayload);
    reportResult('create temp client', createClient, 200);
    if (!isExpectedStatus(createClient.status, 200) || !createClient.body?.id) {
        reportSkip('client soft-delete checks', 'client could not be created');
    } else {
        const clientId = createClient.body.id;

        const getBeforeDelete = await request('GET', `/api/clients/${clientId}`, adminToken);
        reportResult('get temp client before delete', getBeforeDelete, 200);

        const deleteClient = await request('DELETE', `/api/clients/${clientId}`, adminToken);
        reportResult('soft-delete temp client', deleteClient, 200);

        const getAfterDelete = await request('GET', `/api/clients/${clientId}`, adminToken);
        reportResult('deleted client is no longer retrievable', getAfterDelete, 404);

        const listClients = await request('GET', '/api/clients', adminToken);
        if (listClients.status === 200 && Array.isArray(listClients.body)) {
            const found = listClients.body.some((row) => row.id === clientId);
            if (!found) {
                console.log('PASS: deleted client is hidden from list -> 200');
            } else {
                failures += 1;
                console.log('FAIL: deleted client is hidden from list -> expected hidden, but found');
            }
        } else {
            failures += 1;
            console.log(`FAIL: list clients after delete -> expected 200, got ${listClients.status}`);
        }
    }

    const supplierPayload = {
        name: `Smoke Supplier ${ts}`,
        tax_id: `SMK-S-${ts}`,
        contact_name: 'Smoke Contact',
        email: `smoke-supplier-${ts}@example.com`,
        phone: '0000000000',
        address: 'Smoke Avenue 2'
    };

    const createSupplier = await request('POST', '/api/suppliers', adminToken, supplierPayload);
    reportResult('create temp supplier', createSupplier, 200);
    if (!isExpectedStatus(createSupplier.status, 200) || !createSupplier.body?.id) {
        reportSkip('supplier soft-delete checks', 'supplier could not be created');
    } else {
        const supplierId = createSupplier.body.id;

        const deleteSupplier = await request('DELETE', `/api/suppliers/${supplierId}`, adminToken);
        reportResult('soft-delete temp supplier', deleteSupplier, 200);

        const listSuppliers = await request('GET', '/api/suppliers', adminToken);
        if (listSuppliers.status === 200 && Array.isArray(listSuppliers.body)) {
            const found = listSuppliers.body.some((row) => row.id === supplierId);
            if (!found) {
                console.log('PASS: deleted supplier is hidden from list -> 200');
            } else {
                failures += 1;
                console.log('FAIL: deleted supplier is hidden from list -> expected hidden, but found');
            }
        } else {
            failures += 1;
            console.log(`FAIL: list suppliers after delete -> expected 200, got ${listSuppliers.status}`);
        }
    }
}

async function runReceptionFlowChecks(adminToken) {
    const supplierId = process.env.SMOKE_SUPPLIER_ID;
    const productId = process.env.SMOKE_PRODUCT_ID;

    if (!supplierId || !productId) {
        reportSkip('reception flow checks', 'set SMOKE_SUPPLIER_ID and SMOKE_PRODUCT_ID');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const createPO = await request('POST', '/api/purchase-orders', adminToken, {
        supplier_id: supplierId,
        order_date: today,
        items: [
            {
                product_id: productId,
                quantity_ordered: 1,
                unit_cost: 1
            }
        ],
        notes: 'smoke reception flow'
    });
    reportResult('create purchase order for reception flow', createPO, 200);
    if (!isExpectedStatus(createPO.status, 200) || !createPO.body?.id) {
        reportSkip('reception flow approval checks', 'purchase order could not be created');
        return;
    }

    const createReception = await request('POST', '/api/receptions', adminToken, {
        purchase_order_id: createPO.body.id,
        supplier_id: supplierId,
        remito_number: `SMK-${Date.now()}`,
        items: [
            {
                product_id: productId,
                quantity_expected: 1,
                quantity_received: 1,
                unit_cost: 1,
                location_assigned: 'Smoke'
            }
        ],
        notes: 'smoke reception flow'
    });
    reportResult('create reception for approval flow', createReception, 200);
    if (!isExpectedStatus(createReception.status, 200) || !createReception.body?.id) {
        reportSkip('reception flow approval checks', 'reception could not be created');
        return;
    }

    const receptionId = createReception.body.id;
    const approveFirst = await request('POST', `/api/receptions/${receptionId}/approve`, adminToken, {});
    reportResult('first reception approval succeeds', approveFirst, 200);

    const approveSecond = await request('POST', `/api/receptions/${receptionId}/approve`, adminToken, {});
    reportResult('second reception approval is blocked', approveSecond, 400);
}

function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

async function resolveCashRegisterId(cashierToken) {
    if (process.env.SMOKE_CASH_REGISTER_ID) return process.env.SMOKE_CASH_REGISTER_ID;

    const registers = await request('GET', '/api/cash-registers', cashierToken);
    if (registers.status !== 200 || !Array.isArray(registers.body)) return null;

    const open = registers.body.find((r) => r.status === 'open' && r.current_shift_id);
    if (open?.id) return open.id;
    return null;
}

async function runCashFlowChecks(cashierToken) {
    const registerId = await resolveCashRegisterId(cashierToken);
    if (!registerId) {
        reportSkip('cash flow checks', 'set SMOKE_CASH_REGISTER_ID or open a cash register');
        return;
    }

    const shiftBefore = await request('GET', `/api/cash-registers/${registerId}/shift`, cashierToken);
    reportResult('cash flow: get open shift before adjustments', shiftBefore, 200);
    if (!isExpectedStatus(shiftBefore.status, 200)) return;

    const initialExpected = asNumber(shiftBefore.body?.expected_balance);
    const amount = 7.25;
    const ts = Date.now();

    const income = await request('POST', '/api/cash-transactions', cashierToken, {
        register_id: registerId,
        type: 'income',
        amount,
        reason: `smoke income ${ts}`,
        notes: 'integrity smoke'
    });
    reportResult('cash flow: create income adjustment', income, 200);
    if (!isExpectedStatus(income.status, 200)) return;

    const shiftAfterIncome = await request('GET', `/api/cash-registers/${registerId}/shift`, cashierToken);
    reportResult('cash flow: read shift after income', shiftAfterIncome, 200);
    if (!isExpectedStatus(shiftAfterIncome.status, 200)) return;

    const expectedAfterIncome = asNumber(shiftAfterIncome.body?.expected_balance);
    const deltaIncome = expectedAfterIncome - initialExpected;
    if (Math.abs(deltaIncome - amount) <= 0.01) {
        console.log(`PASS: cash flow: expected balance increased by ${amount.toFixed(2)} -> ${(deltaIncome).toFixed(2)}`);
    } else {
        failures += 1;
        console.log(`FAIL: cash flow: expected balance increase mismatch -> expected +${amount.toFixed(2)}, got ${deltaIncome.toFixed(2)}`);
    }

    const expense = await request('POST', '/api/cash-transactions', cashierToken, {
        register_id: registerId,
        type: 'expense',
        amount,
        reason: `smoke expense ${ts}`,
        notes: 'integrity smoke'
    });
    reportResult('cash flow: create expense adjustment', expense, 200);
    if (!isExpectedStatus(expense.status, 200)) return;

    const shiftAfterExpense = await request('GET', `/api/cash-registers/${registerId}/shift`, cashierToken);
    reportResult('cash flow: read shift after expense', shiftAfterExpense, 200);
    if (!isExpectedStatus(shiftAfterExpense.status, 200)) return;

    const expectedAfterExpense = asNumber(shiftAfterExpense.body?.expected_balance);
    const deltaFinal = expectedAfterExpense - initialExpected;
    if (Math.abs(deltaFinal) <= 0.01) {
        console.log(`PASS: cash flow: expected balance returned to baseline -> ${deltaFinal.toFixed(2)}`);
    } else {
        failures += 1;
        console.log(`FAIL: cash flow: expected balance baseline mismatch -> expected 0.00, got ${deltaFinal.toFixed(2)}`);
    }
}

async function run() {
    await ensureHealth();
    const adminToken = tokenForRole('admin');
    const cashierToken = tokenForRole('cashier');

    await runReadOnlyIntegrityChecks(adminToken);

    if (runMutation) {
        await runSoftDeleteMutationChecks(adminToken);
    } else {
        reportSkip('soft-delete mutation checks', 'set SMOKE_MUTATION=1');
    }

    if (runReceptionFlow) {
        await runReceptionFlowChecks(adminToken);
    } else {
        reportSkip('reception approval flow checks', 'set SMOKE_RECEPTION_FLOW=1');
    }

    if (runCashFlow) {
        await runCashFlowChecks(cashierToken);
    } else {
        reportSkip('cash flow checks', 'set SMOKE_CASH_FLOW=1');
    }

    if (failures > 0) {
        console.error(`Integrity smoke failed with ${failures} failing checks.`);
        process.exit(1);
    }

    console.log('Integrity smoke passed.');
}

run().catch((err) => {
    console.error('Integrity smoke execution error:', err.message);
    process.exit(1);
});
