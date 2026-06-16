import test from 'node:test';
import assert from 'node:assert/strict';

import { TraceabilityService } from '../services/traceability.service.js';

test('getTimeline normalizes product traceability events from existing operational sources', async () => {
    const queries = [];
    const db = {
        async query(sql, params) {
            const statement = String(sql);
            queries.push({ sql: statement, params });

            if (statement.includes('FROM inventory_movements')) {
                return [[
                    {
                        id: 'mov-1',
                        created_at: '2026-06-14T10:00:00.000Z',
                        type: 'receipt',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        from_location: null,
                        to_location: 'A-01',
                        quantity: 5,
                        reference_type: 'reception',
                        reference_id: 'rec-1',
                        user_name: 'Deposito'
                    }
                ]];
            }

            if (statement.includes('FROM product_batches')) {
                return [[
                    {
                        id: 'batch-1',
                        created_at: '2026-06-14T10:05:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        batch_number: 'L-2026',
                        quantity_initial: 5,
                        quantity_current: 5,
                        location: 'A-01',
                        supplier_id: 'sup-1'
                    }
                ]];
            }

            if (statement.includes('FROM serial_numbers')) {
                return [[
                    {
                        id: 'ser-1',
                        created_at: '2026-06-14T10:10:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        serial_number: 'SN-001',
                        status: 'available',
                        location: 'A-01'
                    }
                ]];
            }

            if (statement.includes('FROM audit_logs')) {
                return [[
                    {
                        id: 'aud-1',
                        created_at: '2026-06-14T10:15:00.000Z',
                        action: 'UPDATE_PRODUCT',
                        entity_type: 'product',
                        entity_id: 'prod-1',
                        user_name: 'Admin',
                        new_values: JSON.stringify({ location: 'A-01' })
                    }
                ]];
            }

            if (statement.includes('FROM order_items')) {
                return [[
                    {
                        id: 'ord-item-1',
                        order_id: 'ord-1',
                        created_at: '2026-06-14T11:00:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        quantity: 2,
                        unit_price: 100,
                        subtotal: 200,
                        customer_name: 'Club Norte',
                        order_status: 'confirmed',
                        payment_status: 'paid',
                        shipping_method: 'delivery',
                        tracking_number: 'TRK-001'
                    }
                ]];
            }

            if (statement.includes('FROM invoice_items')) {
                return [[
                    {
                        id: 'inv-item-1',
                        invoice_id: 'inv-1',
                        issue_date: '2026-06-14T11:10:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        quantity: 2,
                        unit_price: 100,
                        total_line: 242,
                        client_name: 'Club Norte',
                        invoice_type: 'B',
                        point_of_sale: 1,
                        invoice_number: 52,
                        invoice_status: 'issued',
                        payment_status: 'paid'
                    }
                ]];
            }

            if (statement.includes('FROM client_return_items')) {
                return [[
                    {
                        id: 'ret-item-1',
                        return_id: 'ret-1',
                        created_at: '2026-06-14T11:20:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        quantity: 1,
                        condition_status: 'review',
                        unit_price: 100,
                        customer_name: 'Club Norte',
                        return_status: 'pending',
                        reason: 'Cambio de talle'
                    }
                ]];
            }

            if (statement.includes('FROM warranty_claims')) {
                return [[
                    {
                        id: 'war-1',
                        created_at: '2026-06-14T11:30:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        customer_name: 'Club Norte',
                        serial_number: 'SN-001',
                        issue_description: 'Costura abierta',
                        status: 'initiated',
                        resolution_type: null
                    }
                ]];
            }

            if (statement.includes('FROM supplier_return_items')) {
                return [[
                    {
                        id: 'sup-ret-item-1',
                        return_id: 'sup-ret-1',
                        return_number: 'DR-0001',
                        date: '2026-06-14T11:40:00.000Z',
                        product_id: 'prod-1',
                        product_name: 'Botin Pro',
                        sku: 'BOT-PRO',
                        supplier_name: 'Proveedor Sur',
                        quantity: 1,
                        unit_cost: 55,
                        reason: 'Falla de fabrica',
                        return_status: 'approved'
                    }
                ]];
            }

            throw new Error(`Unexpected SQL: ${statement}`);
        }
    };

    const service = new TraceabilityService(db);
    const events = await service.getTimeline({ product_id: 'prod-1', limit: 10 });

    assert.equal(events.length, 9);
    assert.deepEqual(events.map((event) => event.source_table), [
        'supplier_return_items',
        'warranty_claims',
        'client_return_items',
        'invoice_items',
        'order_items',
        'audit_logs',
        'serial_numbers',
        'product_batches',
        'inventory_movements'
    ]);
    assert.deepEqual(events.map((event) => event.event_type), [
        'supplier_return',
        'warranty',
        'client_return',
        'invoice',
        'order',
        'audit',
        'serial',
        'batch',
        'inventory_movement'
    ]);
    assert.equal(events[0].title, 'Devolucion a proveedor DR-0001');
    assert.equal(events[0].description, 'Devolucion de 1 unidades a Proveedor Sur por Falla de fabrica');
    assert.equal(events[1].title, 'Garantia SN-001');
    assert.equal(events[1].metadata.issue_description, 'Costura abierta');
    assert.equal(events[2].title, 'Devolucion de cliente');
    assert.equal(events[2].reference_type, 'client_return');
    assert.equal(events[3].title, 'Factura B-0001-00000052');
    assert.equal(events[3].metadata.payment_status, 'paid');
    assert.equal(events[4].title, 'Pedido ord-1');
    assert.equal(events[4].metadata.tracking_number, 'TRK-001');
    assert.equal(events[5].title, 'UPDATE_PRODUCT');
    assert.equal(events[6].title, 'Serie SN-001');
    assert.equal(events[7].title, 'Lote L-2026');
    assert.equal(events[8].description, 'receipt de 5 unidades hacia A-01');
    assert.equal(events[8].reference_type, 'reception');
    assert.equal(events[8].actor_name, 'Deposito');

    assert.equal(queries.length, 9);
    for (const query of queries) {
        assert.deepEqual(query.params.slice(0, 1), ['prod-1']);
    }
});
