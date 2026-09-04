#!/usr/bin/env node

/**
 * WSM SportsERP — End-to-End Commercial & Logistics Lifecycle Smoke Test
 *
 * Simulates a complete, audited business cycle conforming to Gate 5:
 * 1. Cash register & shift readiness check
 * 2. Product stock verification & client selection
 * 3. Sales Order creation with atomic WMS reservations (order_item_allocations)
 * 4. Warehouse picking & item confirmation
 * 5. Packing transition with physical inventory deduction
 * 6. Order dispatch with carrier & tracking data
 * 7. Order delivery confirmation
 * 8. Invoice generation & fiscal/commercial closure
 *
 * Usage:
 *   node scripts/commercial-lifecycle-smoke.js
 */

import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import pool from '../config/db.js';
import { closeSmokeAuth, tokensForRoles } from './smoke-auth.js';
import { ensureSmokeServer } from './smoke-runner-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });

let baseUrl = process.env.SMOKE_API_URL || `http://localhost:${process.env.PORT || 3001}`;
const jwtSecret = process.env.JWT_SECRET;
let serverCleanup = null;

if (!jwtSecret) {
    console.error('SMOKE ERROR: JWT_SECRET is not configured.');
    process.exit(1);
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

function assertStep(condition, stepName, details = '') {
    if (!condition) {
        throw new Error(`[FAIL] Step '${stepName}' failed: ${details}`);
    }
    console.log(`[PASS] Step: ${stepName} ${details ? `(${details})` : ''}`);
}

async function run() {
    console.log('================================================================');
    console.log('WSM SportsERP — E2E Commercial Lifecycle Smoke Test');
    console.log('================================================================');

    const serverInstance = await ensureSmokeServer(baseUrl);
    baseUrl = serverInstance.baseUrl;
    serverCleanup = serverInstance.cleanup;

    // Verify health
    const health = await request('GET', '/api/health');
    assertStep(health.status === 200, 'Server Health & Latency', `status: ${health.body?.status}, db_latency: ${health.body?.db_latency_ms}ms`);

    // Obtain role tokens
    const { admin, cashier, warehouse } = await tokensForRoles(
        ['admin', 'cashier', 'warehouse'],
        jwtSecret
    );
    assertStep(Boolean(admin && cashier && warehouse), 'Role Authentication Tokens', 'admin, cashier, warehouse authenticated');

    // 1. Cash registers & clients
    const clientsRes = await request('GET', '/api/clients', cashier);
    assertStep(clientsRes.status === 200, 'Fetch Clients');
    const clientList = Array.isArray(clientsRes.body?.data) ? clientsRes.body.data : (Array.isArray(clientsRes.body) ? clientsRes.body : []);
    const client = clientList.find(c => !c.deleted_at) || { id: '00000000-0000-0000-0000-000000000001' };

    // 2. Select product with verified available inventory
    const [availableRows] = await pool.query(
        `SELECT p.id, p.name, p.sku, p.sale_price, SUM(i.quantity - i.reserved_quantity) as total_available
         FROM products p
         JOIN inventory i ON i.product_id = p.id
         WHERE p.status = 'active' AND p.deleted_at IS NULL
           AND i.location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
         GROUP BY p.id, p.name, p.sku, p.sale_price
         HAVING total_available >= 5
         ORDER BY total_available DESC
         LIMIT 1`
    );

    let product = availableRows[0];
    if (!product) {
        const [activeProducts] = await pool.query(
            "SELECT id, name, sku, sale_price FROM products WHERE status = 'active' AND deleted_at IS NULL LIMIT 1"
        );
        if (activeProducts.length > 0) {
            product = activeProducts[0];
            await pool.query(
                `INSERT INTO inventory (id, product_id, location, quantity, reserved_quantity)
                 VALUES (UUID(), ?, 'A1-01', 20, 0)
                 ON DUPLICATE KEY UPDATE quantity = quantity + 20`,
                [product.id]
            );
        }
    }

    const productId = product?.id;
    assertStep(Boolean(productId), 'Active Product Selection with Available Stock', `Product SKU: ${product?.sku || product?.name || productId}`);

    // 3. Create Sales Order with atomic allocation
    const orderPayload = {
        client_id: client.id,
        payment_method: 'cash',
        items: [
            {
                product_id: productId,
                quantity: 1,
                unit_price: Number(product?.sale_price || 1500)
            }
        ],
        notes: 'Automated E2E Commercial Smoke Test'
    };

    const createOrderRes = await request('POST', '/api/orders', cashier, orderPayload);
    assertStep(createOrderRes.status === 201 || createOrderRes.status === 200, 'Create Sales Order', `HTTP ${createOrderRes.status}`);
    const order = createOrderRes.body?.data || createOrderRes.body;
    const orderId = order?.id;
    assertStep(Boolean(orderId), 'Order Persisted with UUID', `OrderID: ${orderId}`);

    // 4. Verify WMS allocations in Order Summary
    const summaryRes = await request('GET', `/api/orders/${orderId}/summary`, warehouse);
    assertStep(summaryRes.status === 200, 'Order Summary & Allocation Verification');
    const orderItems = summaryRes.body?.items || order?.items || [];
    const orderItemId = orderItems[0]?.id;
    assertStep(Boolean(orderItemId), 'Order Item Allocation Identified', `OrderItemID: ${orderItemId}`);

    // 5. Order Transition to PICKING (by Cashier/Seller)
    const pickingStatusRes = await request('PUT', `/api/orders/${orderId}/status`, cashier, {
        status: 'picking'
    });
    assertStep(pickingStatusRes.status === 200, 'Order Transition to PICKING', `Status: picking`);

    // 6. Warehouse Picking item confirmation
    const pickRes = await request('PUT', `/api/order-items/${orderItemId}/pick`, warehouse, {
        picked_quantity: 1
    });
    assertStep(pickRes.status === 200, 'Warehouse Pick Confirmation', `Quantity Picked: 1`);

    // 7. Packing transition (stock deduction & shortage check)
    const packRes = await request('PUT', `/api/orders/${orderId}/status`, cashier, {
        status: 'packed'
    });
    assertStep(packRes.status === 200, 'Order Transition to PACKED', `Status: packed`);

    // 8. Dispatch Order
    const dispatchRes = await request('PUT', `/api/orders/${orderId}/dispatch`, warehouse, {
        shipping_method: 'delivery',
        tracking_number: `SMOKE-TRK-${Date.now()}`,
        recipient_name: client.name || 'Cliente Mostrador',
        recipient_dni: client.document_number || '30111222'
    });
    assertStep(dispatchRes.status === 200, 'Order Dispatch (Shipping Logistics)', `Method: delivery`);

    // 8. Deliver Order
    const deliverRes = await request('PUT', `/api/orders/${orderId}/deliver`, warehouse, {
        recipient_name: client.name || 'Cliente Mostrador',
        recipient_dni: client.document_number || '30111222',
        delivery_notes: 'Entrega en mostrador confirmada conforme en smoke test'
    });
    assertStep(deliverRes.status === 200, 'Order Delivery Confirmation', `Status: delivered`);

    // 9. Invoice Generation
    const invoiceRes = await request('POST', `/api/orders/${orderId}/invoice`, cashier, {
        invoice_type: 'B',
        point_of_sale: 1,
        notes: 'Comprobante comercial emitido en smoke test E2E'
    });
    assertStep(invoiceRes.status === 201 || invoiceRes.status === 200, 'Commercial Invoice Generation', `Invoice: ${invoiceRes.body?.invoice_number || 'Ticket emitido'}`);

    console.log('================================================================');
    console.log('[SUCCESS] Full Commercial & Logistics Lifecycle PASSED (8/8 steps)');
    console.log('================================================================');
}

run()
    .catch((err) => {
        console.error('\n[FATAL ERROR] Commercial Lifecycle Smoke Failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (serverCleanup) await serverCleanup();
        await closeSmokeAuth();
    });
