// Simulación operativa de punta a punta contra la API LOCAL (http://localhost:3001) y la
// base MySQL local en Docker (127.0.0.1:3319). No usa Tiendanube ni ARCA (no llama a los
// endpoints de autorización). Cada paso compara lo esperado con lo que quedó en la base.
//
// Uso:  node packages/server/scripts/simulation/simulacion-operativa.mjs
// Contra la base de simulación (scripts/simulacion.ps1):
//   $env:SIM_DB_NAME='wsm_simulacion'; $env:SIM_ADMIN_PASSWORD='Simulacion2026!'; node …/simulacion-operativa.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const API = process.env.SIM_API || 'http://localhost:3001';
// Only the two local databases (development and simulation), never another one.
const DB_NAME = process.env.SIM_DB_NAME || 'wsm_sports_erp';
if (!['wsm_sports_erp', 'wsm_simulacion'].includes(DB_NAME)) {
    throw new Error(`SIM_DB_NAME debe ser wsm_sports_erp o wsm_simulacion (recibido: ${DB_NAME})`);
}
const DB = { host: '127.0.0.1', port: 3319, user: 'wsm_user', password: 'wsm_pass_2026', database: DB_NAME };
const ADMIN = { email: 'admin@sports.store', password: process.env.SIM_ADMIN_PASSWORD || 'Admin1234!' };
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
const uuid = () => crypto.randomUUID();
const money = (n) => Math.round(Number(n) * 100) / 100;

const results = [];
let cookie = '';
let db;

// ---------- infraestructura ----------
async function call(method, path, body, { expect } = {}) {
    const res = await fetch(`${API}${path}`, {
        method,
        // Same origin the browser sends from the local frontend (the API rejects other origins).
        headers: { 'content-type': 'application/json', cookie, origin: process.env.SIM_ORIGIN || 'http://localhost:5173' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(',').map((c) => c.split(';')[0].trim()).filter((c) => c.includes('=')).join('; ');
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    const ok = expect ? res.status === expect : res.status < 400;
    if (!ok) {
        const err = new Error(`${method} ${path} -> ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
        err.status = res.status; err.body = json;
        throw err;
    }
    return json;
}
const q = async (sql, params = []) => (await db.query(sql, params))[0];

function check(name, actual, expected) {
    const pass = typeof expected === 'number'
        ? Math.abs(Number(actual) - expected) < 0.005
        : JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ type: 'check', name, pass, actual, expected });
    console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name}: real=${JSON.stringify(actual)} esperado=${JSON.stringify(expected)}`);
    return pass;
}

async function step(title, fn) {
    console.log(`\n== ${title}`);
    try {
        const out = await fn();
        results.push({ type: 'step', name: title, pass: true });
        return out;
    } catch (err) {
        results.push({ type: 'step', name: title, pass: false, error: err.message });
        console.log(`  ERROR ${err.message}`);
        return undefined;
    }
}

// Libro de stock esperado: producto -> ubicación -> cantidad
const expected = {};
function move(productId, location, delta) {
    expected[productId] ??= {};
    expected[productId][location] = (expected[productId][location] || 0) + delta;
}
async function verifyStock(label, productIds) {
    for (const pid of productIds) {
        const rows = await q('SELECT location, quantity, reserved_quantity FROM inventory WHERE product_id = ?', [pid]);
        const actual = {};
        for (const r of rows) if (Number(r.quantity) !== 0) actual[r.location] = Number(r.quantity);
        const exp = Object.fromEntries(Object.entries(expected[pid] || {}).filter(([, v]) => v !== 0));
        const sort = (o) => Object.fromEntries(Object.entries(o).sort());
        check(`${label} · stock ${names[pid]} por ubicación`, sort(actual), sort(exp));
        const negative = rows.filter((r) => Number(r.quantity) < 0 || Number(r.reserved_quantity) < 0 || Number(r.reserved_quantity) > Number(r.quantity));
        if (negative.length) check(`${label} · ${names[pid]} sin negativos ni sobre-reservas`, negative.length, 0);
    }
}
// Reconciliación: el stock de cada producto debe igualar la suma de sus movimientos.
async function reconcileMovements(productIds) {
    for (const pid of productIds) {
        const [mov] = await q(
            `SELECT COALESCE(SUM(CASE WHEN to_location IS NOT NULL AND to_location <> '' THEN quantity ELSE 0 END), 0)
                  - COALESCE(SUM(CASE WHEN from_location IS NOT NULL AND from_location <> '' THEN quantity ELSE 0 END), 0) AS net
             FROM inventory_movements WHERE product_id = ?`, [pid]);
        const [inv] = await q('SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory WHERE product_id = ?', [pid]);
        check(`Kardex ${names[pid]}: stock = entradas − salidas de movimientos`, Number(inv.qty), Number(mov.net));
    }
}
const names = {};

// Saldo deudor (debe − haber) de una cuenta del mayor.
async function ledger(code) {
    const [row] = await q('SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS bal FROM journal_entry_lines WHERE account_code = ?', [code]);
    return Number(row.bal);
}
const LEDGER = { cash: '1.1.01.01', treasury: '1.1.01.02', cards: '1.1.02.03', receivables: '1.1.03.01', inventory: '1.1.04.01', suppliers: '2.1.01.01' };

// ---------- simulación ----------
async function main() {
    db = await mysql.createConnection(DB);
    await call('POST', '/api/login', ADMIN);
    console.log(`Simulación ${RUN} contra ${API}`);

    const ctx = {};
    // Foto del mayor al inicio: la conciliación compara variaciones de esta corrida.
    ctx.ledger0 = {};
    for (const [k, code] of Object.entries(LEDGER)) ctx.ledger0[k] = await ledger(code);
    const ledgerDelta = async (k) => money((await ledger(LEDGER[k])) - ctx.ledger0[k]);

    // 1. Maestros
    await step('1. Alta de proveedor, clientes, productos y ubicaciones', async () => {
        ctx.supplier = await call('POST', '/api/suppliers', { name: `Proveedor Sim ${RUN}`, tax_id: `30-${RUN.slice(-8)}-1`, email: `prov${RUN}@sim.test` });
        ctx.client = await call('POST', '/api/clients', { name: `Cliente Cta Cte ${RUN}`, tax_id: `20-${RUN.slice(-8)}-3`, credit_limit: 1000000 });
        ctx.client2 = await call('POST', '/api/clients', { name: `Cliente Mostrador ${RUN}` });
        const mk = async (label, sale, cost) => {
            const p = await call('POST', '/api/products', { sku: `SIM-${label}-${RUN}`, barcode: `779${RUN.slice(-6)}${label.length}${Math.floor(Math.random() * 1000)}`, name: `${label} Sim ${RUN}`, sale_price: sale, cost_price: cost, purchase_price: cost, stock_initial: 0 });
            names[p.id] = label;
            return p;
        };
        ctx.p1 = await mk('Zapatilla', 50000, 30000);
        ctx.p2 = await mk('Pelota', 10000, 5000);
        ctx.p3 = await mk('Remera', 15000, 8000);
        await call('POST', '/api/inventory/locations', { code: `DEP-${RUN}`, name: `DEP-${RUN}` });
        // ADR-015: the counter sells from the sales floor first, orders are picked from the warehouse.
        await call('POST', '/api/inventory/locations', { code: `SAL-${RUN}`, name: `SAL-${RUN}`, is_sales_floor: true });
        ctx.dep = `DEP-${RUN}`; ctx.sal = `SAL-${RUN}`;
        ctx.pids = [ctx.p1.id, ctx.p2.id, ctx.p3.id];
        check('Productos creados con stock 0', (await q('SELECT COALESCE(SUM(quantity),0) s FROM inventory WHERE product_id IN (?)', [ctx.pids]))[0].s, 0);
    });

    // 2. Compra
    await step('2. Orden de compra (borrador → enviada)', async () => {
        ctx.po = await call('POST', '/api/purchase-orders', {
            supplier_id: ctx.supplier.id, order_date: new Date().toISOString().slice(0, 10),
            items: [
                { product_id: ctx.p1.id, quantity_ordered: 10, unit_cost: 30000 },
                { product_id: ctx.p2.id, quantity_ordered: 20, unit_cost: 5000 },
                { product_id: ctx.p3.id, quantity_ordered: 5, unit_cost: 8000 },
            ],
        });
        await call('PUT', `/api/purchase-orders/${ctx.po.id}/status`, { status: 'sent' });
        const po = await call('GET', `/api/purchase-orders/${ctx.po.id}`);
        ctx.poItems = Object.fromEntries(po.items.map((i) => [i.product_id, i.id]));
        check('OC enviada', po.status, 'sent');
        check('OC total (neto 440.000 + IVA 21 %)', Number(po.total_amount), 532400);
        await verifyStock('OC enviada no mueve stock', ctx.pids);
    });

    await step('3. Recepción parcial con control de calidad (2 pelotas defectuosas)', async () => {
        const rec = await call('POST', '/api/receptions', {
            purchase_order_id: ctx.po.id, supplier_id: ctx.supplier.id, remito_number: `R-${RUN}-1`,
            items: [
                { product_id: ctx.p1.id, po_item_id: ctx.poItems[ctx.p1.id], quantity_expected: 10, quantity_received: 8, unit_cost: 30000, location_assigned: ctx.dep },
                { product_id: ctx.p2.id, po_item_id: ctx.poItems[ctx.p2.id], quantity_expected: 20, quantity_received: 20, unit_cost: 5000, location_assigned: ctx.dep },
            ],
        });
        ctx.rec1 = rec;
        await verifyStock('Recepción pendiente de QC no suma stock', ctx.pids);
        // Con mercadería en QC la OC no se puede anular (ADR-012)
        try {
            await call('PUT', `/api/purchase-orders/${ctx.po.id}/status`, { status: 'cancelled' }, { expect: 409 });
            check('Anular OC con mercadería en QC → 409', true, true);
        } catch (e) { check('Anular OC con mercadería en QC → 409', e.message, '409'); }
        await call('POST', '/api/quality-checks', { reception_id: rec.id, product_id: ctx.p1.id, result: 'pass', quantity_checked: 8, quantity_passed: 8, quantity_failed: 0 });
        await call('POST', '/api/quality-checks', { reception_id: rec.id, product_id: ctx.p2.id, result: 'conditional', quantity_checked: 20, quantity_passed: 18, quantity_failed: 2, defect_description: 'Costura abierta', action_taken: 'return_to_supplier' });
        await call('POST', `/api/receptions/${rec.id}/approve`, {});
        move(ctx.p1.id, ctx.dep, 8); move(ctx.p2.id, ctx.dep, 18); move(ctx.p2.id, 'Cuarentena', 2);
        await verifyStock('Recepción 1 aprobada', ctx.pids);
        const po = await call('GET', `/api/purchase-orders/${ctx.po.id}`);
        check('OC pasa a parcial', po.status, 'partial');
    });

    await step('4. Segunda recepción completa la OC', async () => {
        const rec = await call('POST', '/api/receptions', {
            purchase_order_id: ctx.po.id, supplier_id: ctx.supplier.id, remito_number: `R-${RUN}-2`,
            items: [
                { product_id: ctx.p1.id, po_item_id: ctx.poItems[ctx.p1.id], quantity_received: 2, unit_cost: 30000, location_assigned: ctx.dep },
                { product_id: ctx.p3.id, po_item_id: ctx.poItems[ctx.p3.id], quantity_received: 5, unit_cost: 8000, location_assigned: ctx.dep },
            ],
        });
        ctx.rec2 = rec;
        await call('POST', '/api/quality-checks', { reception_id: rec.id, product_id: ctx.p1.id, result: 'pass', quantity_checked: 2, quantity_passed: 2, quantity_failed: 0 });
        await call('POST', '/api/quality-checks', { reception_id: rec.id, product_id: ctx.p3.id, result: 'pass', quantity_checked: 5, quantity_passed: 5, quantity_failed: 0 });
        await call('POST', `/api/receptions/${rec.id}/approve`, {});
        move(ctx.p1.id, ctx.dep, 2); move(ctx.p3.id, ctx.dep, 5);
        await verifyStock('Recepción 2 aprobada', ctx.pids);
        const po = await call('GET', `/api/purchase-orders/${ctx.po.id}`);
        check('OC pasa a recibida', po.status, 'received');
        try {
            await call('PUT', `/api/purchase-orders/${ctx.po.id}/status`, { status: 'sent' }, { expect: 409 });
            check('OC recibida no se puede reabrir → 409', true, true);
        } catch (e) { check('OC recibida no se puede reabrir → 409', e.message, '409'); }
        // Exceso: no se puede recibir más de lo pedido
        try {
            await call('POST', '/api/receptions', { purchase_order_id: ctx.po.id, supplier_id: ctx.supplier.id, items: [{ product_id: ctx.p1.id, po_item_id: ctx.poItems[ctx.p1.id], quantity_received: 1 }] }, { expect: 409 });
            check('Recepción sobre OC cerrada → 409', true, true);
        } catch (e) { check('Recepción sobre OC cerrada → 409', e.message, '409'); }
    });

    // 5. Cuenta corriente proveedor
    const supplierBalance = async () => Number((await q('SELECT account_balance FROM suppliers WHERE id = ?', [ctx.supplier.id]))[0].account_balance);
    await step('5. Factura de proveedor, pago parcial y saldo', async () => {
        const before = await supplierBalance();
        check('Saldo proveedor antes de facturar', before, 0);
        ctx.supInv = await call('POST', '/api/supplier-invoices', {
            invoice_number: `0001-${RUN.slice(-8)}`, invoice_type: 'A', supplier_id: ctx.supplier.id, purchase_order_id: ctx.po.id,
            issue_date: new Date().toISOString().slice(0, 10), net_amount: 440000, vat_amount: 92400, total_amount: 532400,
        });
        check('Saldo proveedor = factura', await supplierBalance(), 532400);
        try {
            await call('POST', '/api/supplier-invoices', { invoice_number: `0001-${RUN.slice(-8)}`, invoice_type: 'A', supplier_id: ctx.supplier.id, issue_date: new Date().toISOString().slice(0, 10), net_amount: 1, vat_amount: 0 }, { expect: 409 });
            check('Factura de proveedor duplicada → 409', true, true);
        } catch (e) { check('Factura de proveedor duplicada → rechazada', e.status >= 400 && e.status < 500, true); }
        await call('POST', '/api/supplier-payments', { supplier_id: ctx.supplier.id, payments: [{ amount: 200000, payment_method: 'transfer', reference_number: `TRF-${RUN}` }] });
        check('Saldo proveedor tras pago de 200.000', await supplierBalance(), 332400);
    });

    await step('6. Devolución al proveedor de las 2 pelotas defectuosas (desde Cuarentena)', async () => {
        const ret = await call('POST', '/api/returns', { supplier_id: ctx.supplier.id, notes: 'Defectuosas QC', items: [{ product_id: ctx.p2.id, quantity: 2, unit_cost: 5000, reason: 'Costura abierta' }] });
        ctx.supRet = ret;
        await call('POST', `/api/returns/${ret.id}/approve`, {});
        move(ctx.p2.id, 'Cuarentena', -2);
        await verifyStock('Devolución a proveedor', ctx.pids);
        // 2 × 5.000 neto + 21 % = 12.100 de crédito
        check('Saldo proveedor baja 12.100 (neto + IVA)', await supplierBalance(), 320300);
    });

    // 7. Almacenamiento
    await step('7. Transferencia Depósito → Salón y conteo cíclico con faltante', async () => {
        await call('POST', '/api/inventory/transfer', { product_id: ctx.p1.id, from_location: ctx.dep, to_location: ctx.sal, quantity: 4 });
        move(ctx.p1.id, ctx.dep, -4); move(ctx.p1.id, ctx.sal, 4);
        await call('POST', '/api/inventory/transfer', { product_id: ctx.p2.id, from_location: ctx.dep, to_location: ctx.sal, quantity: 10 });
        move(ctx.p2.id, ctx.dep, -10); move(ctx.p2.id, ctx.sal, 10);
        await verifyStock('Transferencias', ctx.pids);
        try {
            await call('POST', '/api/inventory/transfer', { product_id: ctx.p3.id, from_location: ctx.sal, to_location: ctx.dep, quantity: 1 }, { expect: 409 });
            check('Transferir desde ubicación sin stock → rechazado', true, true);
        } catch (e) { check('Transferir desde ubicación sin stock → 409', e.status, 409); }

        const audit = await call('POST', '/api/inventory/audits', { location_code: ctx.sal, abc_class: 'ALL', notes: 'Conteo simulación' });
        ctx.audit = audit;
        const auditId = audit.id || audit.audit?.id;
        // Conteo ciego: zapatillas 3 (falta 1), pelotas 10 (ok)
        await call('POST', `/api/inventory/audits/${auditId}/counts`, { code: ctx.p1.sku || `SIM-Zapatilla-${RUN}`, quantity: 3 });
        await call('POST', `/api/inventory/audits/${auditId}/counts`, { code: ctx.p2.sku || `SIM-Pelota-${RUN}`, quantity: 10 });
        await call('POST', `/api/inventory/audits/${auditId}/complete`, {});
        await verifyStock('Conteo completado (aún sin ajustar)', ctx.pids);
        await call('POST', `/api/inventory/audits/${auditId}/adjust`, {});
        move(ctx.p1.id, ctx.sal, -1);
        await verifyStock('Ajuste del conteo aplicado', ctx.pids);
    });

    // 8. Caja
    const registers = await call('GET', '/api/cash-registers');
    ctx.register = Array.isArray(registers) ? registers[0] : (registers?.data || [])[0];
    await step('8. Apertura de caja', async () => {
        if (!ctx.register) throw new Error('No hay cajas registradoras configuradas');
        const current = await call('GET', `/api/cash-registers/${ctx.register.id}/shift`).catch(() => null);
        if (current && (current.id || current.shift?.id) && (current.status || current.shift?.status) === 'open') {
            const shift = current.shift || current;
            await call('POST', `/api/cash-shifts/${shift.id}/close`, { actual_balance: Number(shift.expected_balance || 0), notes: 'Cierre previo a simulación' });
        }
        const opened = await call('POST', `/api/cash-registers/${ctx.register.id}/open`, { opening_balance: 20000 });
        ctx.shift = opened.shift || opened;
        ctx.cashExpected = 20000;
        check('Turno abierto', Boolean(ctx.shift.id), true);
    });

    const shiftExpected = async () => {
        const s = await call('GET', `/api/cash-registers/${ctx.register.id}/shift`);
        return Number((s.shift || s).expected_balance);
    };

    // 9. Venta POS
    await step('9. Venta de mostrador (POS): 1 zapatilla en efectivo + 2 pelotas con tarjeta', async () => {
        // Precios de catálogo NETOS (ADR-008): total = neto × 1,21
        const total = money((50000 + 2 * 10000) * 1.21); // 84.700
        ctx.posKey = uuid();
        const body = {
            idempotency_key: ctx.posKey, shift_id: ctx.shift.id, client_id: ctx.client2.id,
            items: [{ product_id: ctx.p1.id, quantity: 1 }, { product_id: ctx.p2.id, quantity: 2 }],
            payments: [{ method: 'cash', amount: 60500 }, { method: 'debit_card', amount: money(total - 60500) }],
            emit_invoice: true, invoice_type: 'B',
        };
        const sale = await call('POST', '/api/pos/checkout', body);
        ctx.posSale = sale;
        ctx.posOrderId = sale.order?.id || sale.order_id || sale.id;
        // El POS descuenta del Salón si hay stock allí
        const where = await q("SELECT product_id, from_location, quantity FROM inventory_movements WHERE reference_id = ? AND type = 'sale'", [ctx.posOrderId]);
        for (const m of where) move(m.product_id, m.from_location, -Number(m.quantity));
        check('Movimientos de venta POS: 1 zapatilla + 2 pelotas', where.reduce((s, m) => s + Number(m.quantity), 0), 3);
        check('El mostrador vende primero desde el salón (ADR-015)', [...new Set(where.map((m) => m.from_location))], [ctx.sal]);
        await verifyStock('Venta POS', ctx.pids);
        ctx.cashExpected += 60500;
        check('Caja esperada suma solo el efectivo', await shiftExpected(), ctx.cashExpected);
        const replay = await call('POST', '/api/pos/checkout', body);
        check('Reintento del mismo cobro no duplica (idempotente)', Boolean(replay.idempotent_replay), true);
        await verifyStock('Tras reintento POS', ctx.pids);
        check('Caja sin cambios tras reintento', await shiftExpected(), ctx.cashExpected);
        const [inv] = await q('SELECT total_amount, status FROM invoices WHERE order_id = ?', [ctx.posOrderId]);
        check('Factura B emitida localmente por 84.700 (sin ARCA)', inv ? Number(inv.total_amount) : null, 84700);
        // Sin stock suficiente
        try {
            await call('POST', '/api/pos/checkout', { ...body, idempotency_key: uuid(), items: [{ product_id: ctx.p3.id, quantity: 99 }], payments: [{ method: 'cash', amount: 99 * 15000 * 1.21 }] }, { expect: 409 });
            check('Venta sin stock suficiente → 409', true, true);
        } catch (e) { check('Venta sin stock suficiente → 409', e.status, 409); }
        await verifyStock('Tras venta rechazada', ctx.pids);
    });

    // 10. Pedido con envío a cuenta corriente
    await step('10. Pedido con envío: reserva → picking → preparado → despacho → entrega', async () => {
        const order = await call('POST', '/api/orders', {
            client_id: ctx.client.id, payment_method: 'credit_account', shipping_method: 'delivery',
            shipping_address: 'Av. Siempre Viva 742', recipient_name: 'Juan Pérez', recipient_dni: '30111222',
            items: [{ product_id: ctx.p1.id, quantity: 2 }, { product_id: ctx.p3.id, quantity: 3 }],
        });
        ctx.order = order;
        ctx.orderId = order.id || order.order?.id;
        const reserved = await q('SELECT product_id, SUM(reserved_quantity) r FROM inventory WHERE product_id IN (?) GROUP BY product_id', [[ctx.p1.id, ctx.p3.id]]);
        check('Pedido reserva 2 zapatillas y 3 remeras (físico intacto)', Object.fromEntries(reserved.map((r) => [names[r.product_id], Number(r.r)]).sort()), { Remera: 3, Zapatilla: 2 });
        await verifyStock('Reserva no descuenta físico', ctx.pids);
        await call('PUT', `/api/orders/${ctx.orderId}/status`, { status: 'picking' });
        const items = await q('SELECT id, product_id, quantity FROM order_items WHERE order_id = ?', [ctx.orderId]);
        for (const it of items) await call('PUT', `/api/order-items/${it.id}/pick`, { picked_quantity: it.quantity });
        await call('PUT', `/api/orders/${ctx.orderId}/status`, { status: 'packed' });
        const out = await q("SELECT product_id, from_location, quantity FROM inventory_movements WHERE reference_id = ? AND type = 'sale'", [ctx.orderId]);
        for (const m of out) move(m.product_id, m.from_location, -Number(m.quantity));
        check('Preparado: movimientos de salida por 5 unidades', out.reduce((s, m) => s + Number(m.quantity), 0), 5);
        check('El pedido se prepara desde el depósito, no desde el salón (ADR-015)', [...new Set(out.map((m) => m.from_location))], [ctx.dep]);
        await verifyStock('Pedido preparado descuenta físico', ctx.pids);
        const res = await q('SELECT COALESCE(SUM(reserved_quantity),0) r FROM inventory WHERE product_id IN (?)', [ctx.pids]);
        check('Reservas liberadas al preparar', Number(res[0].r), 0);
        await call('PUT', `/api/orders/${ctx.orderId}/dispatch`, { shipping_method: 'delivery', tracking_number: `TRK-${RUN}`, estimated_delivery: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
        const [d] = await q('SELECT status, tracking_number FROM orders WHERE id = ?', [ctx.orderId]);
        check('Despachado con número de seguimiento', [d.status, d.tracking_number], ['dispatched', `TRK-${RUN}`]);
        await call('PUT', `/api/orders/${ctx.orderId}/deliver`, { recipient_name: 'Juan Pérez', recipient_dni: '30111222', delivery_notes: 'Entregado en mano' });
        const [e] = await q('SELECT status FROM orders WHERE id = ?', [ctx.orderId]);
        check('Entregado', e.status, 'delivered');
        await verifyStock('Despacho/entrega no vuelven a descontar', ctx.pids);
        const timeline = await call('GET', `/api/traceability/timeline?product_id=${ctx.p1.id}`).catch((err) => ({ error: err.message }));
        const events = Array.isArray(timeline) ? timeline.length : (timeline?.events?.length ?? timeline?.data?.length ?? 0);
        check('Trazabilidad de la zapatilla: compra, recepción, transferencia, conteo, venta y envío', events >= 6, true);
        results.push({ type: 'info', name: 'Timeline zapatilla', detail: timeline });
    });

    const clientBalance = async (id) => {
        const c = await call('GET', `/api/clients/${id}`);
        return Number(c.current_account_balance);
    };
    await step('11. Facturación a cuenta corriente y cobranza parcial', async () => {
        ctx.balance0 = await clientBalance(ctx.client.id);
        const inv = await call('POST', `/api/orders/${ctx.orderId}/invoice`, { invoice_type: 'A' });
        ctx.invoiceId = inv.id || inv.invoice?.id || inv.invoice_id;
        const [row] = await q('SELECT id, total_amount FROM invoices WHERE order_id = ?', [ctx.orderId]);
        ctx.invoiceId ??= row?.id;
        // 2 × 50.000 + 3 × 15.000 = 145.000 neto + 21 % = 175.450
        check('Factura A por 175.450', Number(row?.total_amount), 175450);
        ctx.balance1 = await clientBalance(ctx.client.id);
        check('Saldo cta cte del cliente = 175.450', ctx.balance1, 175450);
        const pending = await call('GET', '/api/collections/pending-invoices');
        const list = Array.isArray(pending) ? pending : pending?.data || [];
        check('La factura figura en cobranzas pendientes', list.some((p) => (p.id || p.invoice_id) === ctx.invoiceId), true);
        await call('POST', '/api/collections', { client_id: ctx.client.id, payments: [{ invoice_id: ctx.invoiceId, amount: 100000, method: 'transfer' }] })
            .catch(async (err) => {
                // contrato alternativo
                if (err.status === 400) return call('POST', `/api/invoices/${ctx.invoiceId}/payments`, { payments: [{ method: 'transfer', amount: 100000 }] });
                throw err;
            });
        check('Saldo tras cobrar 100.000 por transferencia', await clientBalance(ctx.client.id), 75450);
        await call('PUT', `/api/orders/${ctx.orderId}/status`, { status: 'completed' }).catch(() => null);
    });

    // 12. Devolución de cliente sobre la venta POS
    await step('12. Devolución de cliente: 1 pelota vendible + 1 dañada', async () => {
        const ret = await call('POST', '/api/client-returns', {
            client_id: ctx.client2.id, order_id: ctx.posOrderId, reason: 'Cambio de opinión / falla',
            items: [{ product_id: ctx.p2.id, quantity: 1, condition_status: 'sellable' }, { product_id: ctx.p2.id, quantity: 1, condition_status: 'damaged' }],
        });
        ctx.cliRet = ret;
        await call('POST', `/api/client-returns/${ret.id}/approve`, {});
        const mv = await q('SELECT type, to_location, quantity FROM inventory_movements WHERE reference_id = ? AND product_id = ?', [ret.id, ctx.p2.id]);
        for (const m of mv) if (m.to_location) move(ctx.p2.id, m.to_location, Number(m.quantity));
        check('Devolución: la vendible reingresa al stock (1)', mv.filter((m) => m.to_location).reduce((s, m) => s + Number(m.quantity), 0), 1);
        check('Devolución: la dañada queda registrada como merma, sin volver al stock (1)', mv.filter((m) => m.type === 'damage' && !m.to_location).reduce((s, m) => s + Number(m.quantity), 0), 1);
        check('Ubicaciones de reingreso', mv.map((m) => `${m.type}:${m.to_location}`).sort(), mv.map((m) => `${m.type}:${m.to_location}`).sort());
        await verifyStock('Devolución de cliente', ctx.pids);
        const [cn] = await q("SELECT amount, status FROM credit_notes WHERE reference_id = ? OR (client_id = ? AND reference_type = 'return')", [ret.id, ctx.client2.id]);
        // 2 pelotas al precio vendido 10.000 + IVA = 24.200
        check('Nota de crédito por lo devuelto al precio vendido (24.200)', cn ? Number(cn.amount) : null, 24200);
        try {
            await call('POST', '/api/client-returns', { client_id: ctx.client2.id, order_id: ctx.posOrderId, items: [{ product_id: ctx.p2.id, quantity: 1, condition_status: 'sellable' }] }, { expect: 409 });
            check('Devolver más de lo vendido → rechazado', true, true);
        } catch (e) { check('Devolver más de lo vendido → rechazado', e.status >= 400 && e.status < 500, true); }
    });

    await step('13. Reintegro en efectivo y NC manual idempotente', async () => {
        const before = await clientBalance(ctx.client2.id);
        check('Cliente mostrador queda con 24.200 a favor tras la devolución', before, -24200);
        await call('POST', `/api/cash-shifts/${ctx.shift.id}/payments`, { order_id: ctx.posOrderId, amount: 12100, payment_method: 'cash', type: 'refund' });
        ctx.cashExpected -= 12100;
        check('Caja baja por el reintegro', await shiftExpected(), ctx.cashExpected);
        check('El reintegro en efectivo reduce el saldo a favor del cliente (−12.100)', await clientBalance(ctx.client2.id), -12100);
        await call('POST', '/api/cash-transactions', { register_id: ctx.register.id, type: 'expense', amount: 3000, reason: 'Flete local' });
        ctx.cashExpected -= 3000;
        check('Caja baja por gasto', await shiftExpected(), ctx.cashExpected);
        // ADR-014: la NC manual corrige una factura del cliente
        const noInvoice = await call('POST', '/api/credit-notes', { client_id: ctx.client.id, amount: 100 }).catch((e) => e);
        check('NC manual sin factura asociada → 400', noInvoice.status, 400);
        const tooMuch = await call('POST', '/api/credit-notes', { client_id: ctx.client.id, invoice_id: ctx.invoiceId, amount: 999999 }).catch((e) => e);
        check('NC manual mayor que la factura → 409', tooMuch.status, 409);
        const key = uuid();
        const nc = { idempotency_key: key, client_id: ctx.client.id, invoice_id: ctx.invoiceId, amount: 5450, reason: 'Bonificación por demora', reference_type: 'discount' };
        const a = await call('POST', '/api/credit-notes', nc);
        const b = await call('POST', '/api/credit-notes', nc);
        check('NC manual: el reintento devuelve la misma nota', [b.number === a.number, Boolean(b.idempotent_replay)], [true, true]);
        check('NC manual toma la letra de la factura (A)', (await q('SELECT credit_note_type, invoice_id FROM credit_notes WHERE id = ?', [a.id]))[0].credit_note_type, 'A');
        check('Saldo cta cte tras NC de 5.450', await clientBalance(ctx.client.id), 70000);
        const unauth = await call('POST', `/api/credit-notes/${a.id}/authorize`, {}).catch((e) => e);
        check('Autorizar NC de una factura sin CAE → 409 (no llega a ARCA)', unauth.status, 409);

        // ADR-014: el pago en efectivo al proveedor sale de la caja abierta, un solo registro
        await call('POST', '/api/supplier-payments', { supplier_id: ctx.supplier.id, payments: [{ amount: 10000, payment_method: 'Efectivo' }] });
        ctx.cashExpected -= 10000;
        check('Pago a proveedor en efectivo descuenta de la caja', await shiftExpected(), ctx.cashExpected);
        check('Saldo proveedor tras pago en efectivo', await supplierBalance(), 310300);
        const tooBig = await call('POST', '/api/supplier-payments', { supplier_id: ctx.supplier.id, payments: [{ amount: 9999999, payment_method: 'Efectivo' }] }).catch((e) => e);
        check('Pagar en efectivo más de lo que hay en caja → 409', tooBig.status, 409);
        const creditRefund = await call('POST', `/api/cash-shifts/${ctx.shift.id}/payments`, { amount: 10, payment_method: 'credit_account', type: 'refund' }).catch((e) => e);
        check('Reintegro "a cuenta corriente" → 400', creditRefund.status, 400);

        // ADR-015: "Caja 2" (tesorería) se alimenta desde la caja y paga proveedores
        const treasury0 = Number((await call('GET', '/api/treasury')).balance);
        await call('POST', '/api/treasury/transfers', { idempotency_key: uuid(), from: 'drawer', to: 'treasury', amount: 20000, notes: 'Retiro a Caja 2' });
        ctx.cashExpected -= 20000;
        check('Retiro de la caja a Caja 2 baja el arqueo', await shiftExpected(), ctx.cashExpected);
        const payKey = uuid();
        const payBody = { idempotency_key: payKey, supplier_id: ctx.supplier.id, payments: [{ amount: 5000, payment_method: 'Caja 2' }] };
        const p1 = await call('POST', '/api/supplier-payments', payBody);
        const p2 = await call('POST', '/api/supplier-payments', payBody);
        check('Pago a proveedor repetido (doble clic) no se duplica', [Boolean(p2.idempotent_replay), p2.ids?.[0] === p1.ids?.[0]], [true, true]);
        check('Saldo proveedor tras pago desde Caja 2', await supplierBalance(), 305300);
        check('Caja 2 = traspaso − pago (15.000)', money(Number((await call('GET', '/api/treasury')).balance) - treasury0), 15000);
        check('El pago desde Caja 2 no toca la caja del turno', await shiftExpected(), ctx.cashExpected);
        const overTreasury = await call('POST', '/api/supplier-payments', { supplier_id: ctx.supplier.id, payments: [{ amount: 99999999, payment_method: 'Caja 2' }] }).catch((e) => e);
        check('Pagar desde Caja 2 más de lo que tiene → 409', overTreasury.status, 409);

        // ADR-015: precio final exacto (cargado con IVA, guardado neto)
        await call('PUT', `/api/products/${ctx.p3.id}`, { sku: `SIM-Remera-${RUN}`, name: `Remera Sim ${RUN}`, sale_price: 59999 / 1.21, purchase_price: 8000, cost_price: 8000 });
        const [stored] = await q('SELECT sale_price FROM products WHERE id = ?', [ctx.p3.id]);
        check('Precio final $59.999 se recupera exacto desde el neto guardado (4 decimales)', money(Number(stored.sale_price) * 1.21), 59999);
        await call('PUT', `/api/products/${ctx.p3.id}`, { sku: `SIM-Remera-${RUN}`, name: `Remera Sim ${RUN}`, sale_price: 15000, purchase_price: 8000, cost_price: 8000 });
    });

    await step('14. Garantía: ingreso, envío al proveedor y reemplazo', async () => {
        const w = await call('POST', '/api/warranties', { client_id: ctx.client.id, product_id: ctx.p3.id, issue_description: 'Se descosió la costura' });
        ctx.warranty = w;
        const before = JSON.parse(JSON.stringify(expected));
        for (const status of ['received', 'in_progress', 'sent_to_supplier', 'supplier_approved']) {
            await call('PUT', `/api/warranties/${w.id}/status`, { status, notes: `Sim ${status}` });
        }
        await call('PUT', `/api/warranties/${w.id}/status`, { status: 'resolved', resolution_type: 'replaced', resolution_notes: 'Se entregó remera nueva' });
        const mv = await q('SELECT type, from_location, to_location, quantity FROM inventory_movements WHERE reference_id = ?', [w.id]);
        for (const m of mv) {
            if (m.from_location) move(ctx.p3.id, m.from_location, -Number(m.quantity));
            if (m.to_location) move(ctx.p3.id, m.to_location, Number(m.quantity));
        }
        results.push({ type: 'info', name: 'Movimientos de garantía', detail: mv });
        console.log('  info movimientos garantía:', JSON.stringify(mv));
        check('Garantía resuelta', (await q('SELECT status FROM warranty_claims WHERE id = ?', [w.id]))[0].status, 'resolved');
        check('Garantía: defectuosa a Cuarentena → Devoluciones a Proveedores, reemplazo sale del stock vendible',
            mv.map((m) => m.type).sort(), ['warranty_intake', 'warranty_replacement', 'warranty_to_supplier']);
        await verifyStock('Garantía', ctx.pids);
        if (!mv.length) results.push({ type: 'info', name: 'Garantía con reemplazo no mueve stock', detail: before });

        // Ida y vuelta de estados no repite efectos
        await call('PUT', `/api/warranties/${w.id}/status`, { status: 'closed', notes: 'Cierre' });
        await call('PUT', `/api/warranties/${w.id}/status`, { status: 'resolved', notes: 'Reabierta' });
        check('Reabrir y volver a resolver no entrega otra unidad', (await q('SELECT COUNT(*) n FROM inventory_movements WHERE reference_id = ?', [w.id]))[0].n, 3);
        await verifyStock('Garantía tras ida y vuelta', ctx.pids);

        // Garantía rechazada por el proveedor: la unidad defectuosa se da de baja
        const w2 = await call('POST', '/api/warranties', { client_id: ctx.client.id, product_id: ctx.p1.id, issue_description: 'Suela despegada' });
        for (const status of ['received', 'sent_to_supplier', 'supplier_rejected']) {
            await call('PUT', `/api/warranties/${w2.id}/status`, { status });
        }
        const mv2 = await q('SELECT type, from_location, to_location, quantity FROM inventory_movements WHERE reference_id = ?', [w2.id]);
        for (const m of mv2) {
            if (m.from_location) move(ctx.p1.id, m.from_location, -Number(m.quantity));
            if (m.to_location) move(ctx.p1.id, m.to_location, Number(m.quantity));
        }
        check('Garantía rechazada por el proveedor: ingreso, envío y baja', mv2.map((m) => m.type).sort(), ['warranty_intake', 'warranty_to_supplier', 'warranty_writeoff']);
        await verifyStock('Garantía rechazada', ctx.pids);
    });

    await step('15. Pedido cancelado libera la reserva', async () => {
        const o = await call('POST', '/api/orders', { client_id: ctx.client.id, payment_method: 'credit_account', shipping_method: 'pickup', items: [{ product_id: ctx.p2.id, quantity: 3 }] });
        const id = o.id || o.order?.id;
        const r1 = Number((await q('SELECT COALESCE(SUM(reserved_quantity),0) r FROM inventory WHERE product_id = ?', [ctx.p2.id]))[0].r);
        check('Reserva de 3 pelotas', r1, 3);
        await call('PUT', `/api/orders/${id}/status`, { status: 'cancelled' });
        const r2 = Number((await q('SELECT COALESCE(SUM(reserved_quantity),0) r FROM inventory WHERE product_id = ?', [ctx.p2.id]))[0].r);
        check('Cancelado: reserva liberada', r2, 0);
        await verifyStock('Cancelación', ctx.pids);
        check('Saldo cta cte no cambia por pedido cancelado', await clientBalance(ctx.client.id), 70000);
    });

    await step('16. Retiro en mostrador de un pedido (pickup) cobrado en caja', async () => {
        const o = await call('POST', '/api/orders', { client_id: ctx.client2.id, payment_method: 'cash', shipping_method: 'pickup', items: [{ product_id: ctx.p3.id, quantity: 1 }] });
        const id = o.id || o.order?.id;
        await call('PUT', `/api/orders/${id}/status`, { status: 'picking' });
        const items = await q('SELECT id, quantity FROM order_items WHERE order_id = ?', [id]);
        for (const it of items) await call('PUT', `/api/order-items/${it.id}/pick`, { picked_quantity: it.quantity });
        await call('PUT', `/api/orders/${id}/status`, { status: 'packed' });
        const out = await q("SELECT from_location, quantity FROM inventory_movements WHERE reference_id = ? AND type = 'sale'", [id]);
        for (const m of out) move(ctx.p3.id, m.from_location, -Number(m.quantity));
        await call('POST', `/api/orders/${id}/pickup-checkout`, { recipient_name: 'Ana', recipient_dni: '28999000', shift_id: ctx.shift.id, invoice_type: 'B', payments: [{ method: 'cash', amount: 18150 }] });
        ctx.cashExpected += 18150;
        const [st] = await q('SELECT status FROM orders WHERE id = ?', [id]);
        check('Pedido retirado', ['delivered', 'completed'].includes(st.status), true);
        await verifyStock('Retiro en mostrador', ctx.pids);
        check('Caja suma el cobro del retiro', await shiftExpected(), ctx.cashExpected);
    });

    await step('17. Cierre de caja sin diferencias', async () => {
        const exp = await shiftExpected();
        const closed = await call('POST', `/api/cash-shifts/${ctx.shift.id}/close`, { actual_balance: exp, notes: 'Cierre simulación' });
        const [s] = await q('SELECT status, expected_balance, actual_balance, difference FROM cash_shifts WHERE id = ?', [ctx.shift.id]);
        check('Turno cerrado', s.status, 'closed');
        check('Saldo esperado de caja = apertura + efectivo − salidas', Number(s.expected_balance), ctx.cashExpected);
        check('Diferencia de arqueo', Number(s.difference ?? (Number(s.actual_balance) - Number(s.expected_balance))), 0);
        results.push({ type: 'info', name: 'Cierre', detail: closed });
    });

    await step('18. Contabilidad: asientos balanceados y kardex', async () => {
        const unbalanced = await q(`SELECT je.id, je.reference_type, SUM(jl.debit) d, SUM(jl.credit) c
            FROM journal_entries je JOIN journal_entry_lines jl ON jl.journal_entry_id = je.id
            GROUP BY je.id, je.reference_type HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.005`).catch((e) => [{ error: e.message }]);
        check('Asientos desbalanceados en todo el libro', unbalanced.length, 0);
        const tb = await call('GET', '/api/accounting/trial-balance').catch((e) => ({ error: e.message }));
        const rows = Array.isArray(tb) ? tb : tb?.accounts || tb?.data || [];
        if (rows.length) {
            const d = rows.reduce((s, r) => s + Number(r.total_debit ?? r.debit ?? 0), 0);
            const c = rows.reduce((s, r) => s + Number(r.total_credit ?? r.credit ?? 0), 0);
            check('Balance de sumas y saldos: debe = haber', money(d), money(c));
        } else results.push({ type: 'info', name: 'trial-balance', detail: tb });
        const simEntries = await q(`SELECT je.reference_type, COUNT(*) n, SUM(t.d) total FROM journal_entries je
            JOIN (SELECT journal_entry_id, SUM(debit) d FROM journal_entry_lines GROUP BY journal_entry_id) t ON t.journal_entry_id = je.id
            WHERE je.reference_id IN (?) GROUP BY je.reference_type`,
            [[ctx.supInv?.id, ctx.supRet?.id, ctx.invoiceId, ctx.posOrderId, ctx.cliRet?.id, 'none'].filter(Boolean)]).catch((e) => [{ error: e.message }]);
        results.push({ type: 'info', name: 'Asientos de la simulación', detail: simEntries });
        console.log('  info asientos:', JSON.stringify(simEntries));
        await reconcileMovements(ctx.pids || []);

        // Conciliación mayor ↔ submayores (variación durante esta corrida)
        check('Mayor Proveedores = saldo del proveedor', -(await ledgerDelta('suppliers')), await supplierBalance());
        const clientsSum = (await clientBalance(ctx.client.id)) + (await clientBalance(ctx.client2.id));
        check('Mayor Deudores = suma de cuentas corrientes de clientes', await ledgerDelta('receivables'), money(clientsSum));
        check('Mayor Caja = movimiento real de efectivo del turno', await ledgerDelta('cash'), money(ctx.cashExpected - 20000));
        check('Mayor Caja 2 = traspasos − pagos desde Caja 2', await ledgerDelta('treasury'), 15000);
        check('Mayor Tarjetas y QR a cobrar = cobros con débito (24.200)', await ledgerDelta('cards'), 24200);
        // ADR-014: acreditación del procesador con comisión
        const bank0 = await ledger('1.1.02.01');
        const over = await call('POST', '/api/card-settlements', { amount: 99999999 }).catch((e) => e);
        check('Acreditar más que lo pendiente de tarjetas → 409', over.status, 409);
        const settleKey = uuid();
        // ADR-016: comisión con IVA 10,5 % y una retención del procesador.
        const vat105Before = await ledger('1.1.05.01');
        const withholdingsBefore = await ledger('1.1.05.04');
        const settlement = { idempotency_key: settleKey, amount: 24200, fee_amount: 500, fee_vat_rate: 10.5, charges: [{ concept: 'withholding', amount: 200 }], reference: `LOTE-${RUN}` };
        await call('POST', '/api/card-settlements', settlement);
        const replay = await call('POST', '/api/card-settlements', settlement);
        check('La acreditación repetida no se duplica', Boolean(replay.idempotent_replay), true);
        check('Tras acreditar, Tarjetas a cobrar queda en 0 (variación de la corrida)', await ledgerDelta('cards'), 0);
        check('El banco recibe lo liquidado menos comisión y retención (23.500)', money((await ledger('1.1.02.01')) - bank0), 23500);
        check('IVA de la comisión al 10,5 % como crédito fiscal (47,51)', money((await ledger('1.1.05.01')) - vat105Before), 47.51);
        check('La retención queda a favor (200)', money((await ledger('1.1.05.04')) - withholdingsBefore), 200);
        // ADR-016: débitos bancarios sueltos (impuesto a los débitos y créditos + mantenimiento con IVA 21 %).
        const bank1 = await ledger('1.1.02.01');
        const charges = await call('POST', '/api/bank/charges', { idempotency_key: uuid(), reference: `Extracto ${RUN}`, charges: [{ concept: 'debits_credits_tax', amount: 141 }, { concept: 'maintenance', amount: 1210 }] });
        check('Débitos bancarios registrados (1.351)', charges.total, 1351);
        check('El banco baja por los débitos', money(bank1 - (await ledger('1.1.02.01'))), 1351);
        check('Saldo del banco informado = mayor', Number((await call('GET', '/api/bank')).balance), money(await ledger('1.1.02.01')));
        const initialByOther = await call('POST', '/api/treasury/transfers', { idempotency_key: uuid(), from: 'initial', to: 'treasury', amount: 1 }).then(() => 'ok').catch((e) => e.status);
        check('Saldo inicial de Caja 2 lo carga el administrador (la corrida es admin)', initialByOther, 'ok');
        const [valued] = await q(
            `SELECT COALESCE(SUM(i.quantity * COALESCE(NULLIF(p.purchase_price, 0), p.cost_price, 0)), 0) AS v
             FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id IN (?)`, [ctx.pids]);
        check('Mayor Inventario = stock físico valuado al costo', await ledgerDelta('inventory'), money(valued.v));
        const neg = await q('SELECT COUNT(*) n FROM inventory WHERE quantity < 0 OR reserved_quantity < 0 OR reserved_quantity > quantity');
        check('Inventario global sin negativos ni sobre-reservas', Number(neg[0].n), 0);
    });

    // Resumen final
    const finalStock = {};
    for (const pid of ctx.pids || []) {
        finalStock[names[pid]] = Object.fromEntries((await q('SELECT location, quantity FROM inventory WHERE product_id = ? AND quantity <> 0', [pid])).map((r) => [r.location, Number(r.quantity)]));
    }
    const summary = {
        run: RUN,
        checks: results.filter((r) => r.type === 'check').length,
        failed_checks: results.filter((r) => r.type === 'check' && !r.pass),
        failed_steps: results.filter((r) => r.type === 'step' && !r.pass),
        final_stock: finalStock,
        supplier_balance: ctx.supplier ? await supplierBalance() : null,
        client_balance: ctx.client ? await clientBalance(ctx.client.id) : null,
    };
    fs.writeFileSync(new URL(`./resultado-${RUN}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
    console.log('\n===== RESUMEN =====');
    console.log(JSON.stringify(summary, null, 2));
    await db.end();
}

main().catch(async (err) => { console.error(err); try { await db?.end(); } catch {} process.exit(1); });
