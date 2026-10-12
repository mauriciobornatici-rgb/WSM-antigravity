import test from 'node:test';
import assert from 'node:assert/strict';

import { clientReturnCreateSchema, createOrderSchema, createProductSchema, creditNoteCreateSchema, manualInvoiceSchema, orderPaymentLineSchema } from '@wsm/common';

test('manual credit note contract preserves the idempotency key (ADR-012)', () => {
    // Zod drops unknown keys: a stale @wsm/common build would silently disable idempotency.
    const parsed = creditNoteCreateSchema.parse({
        idempotency_key: '0a252ca9-9af2-455d-89d7-87150716f8ae',
        client_id: '15f5fb57-8da7-4ce1-bd88-c7fc9da7a638',
        amount: 100
    });

    assert.equal(parsed.idempotency_key, '0a252ca9-9af2-455d-89d7-87150716f8ae');
});

test('POS order contract preserves the idempotency key', () => {
    const parsed = createOrderSchema.parse({
        idempotency_key: '0a252ca9-9af2-455d-89d7-87150716f8ae',
        payment_method: 'cash',
        items: [{ product_id: '15f5fb57-8da7-4ce1-bd88-c7fc9da7a638', quantity: 1 }]
    });

    assert.equal(parsed.idempotency_key, '0a252ca9-9af2-455d-89d7-87150716f8ae');
});

test('manual invoice contract preserves split payments', () => {
    const parsed = manualInvoiceSchema.parse({
        payment_method: 'cash',
        payments: [
            { method: 'cash', amount: 100 },
            { method: 'credit_card', amount: 200 }
        ],
        items: [{ description: 'Producto', quantity: 1, unit_price: 300 }]
    });

    assert.equal(parsed.payments?.length, 2);
    assert.equal(parsed.payments?.[1]?.method, 'credit_card');
});

test('order contract accepts a date-only delivery and mixed payments', () => {
    const parsed = createOrderSchema.parse({
        payment_method: 'cash',
        payments: [
            { method: 'cash', amount: 100 },
            { method: 'debit_card', amount: 200 }
        ],
        estimated_delivery: '2026-08-24',
        items: [{ product_id: '15f5fb57-8da7-4ce1-bd88-c7fc9da7a638', quantity: 1 }]
    });

    assert.equal(parsed.estimated_delivery, '2026-08-24');
    assert.equal(parsed.payments?.length, 2);
});

test('return contract accepts supplier routing status used by the UI', () => {
    const parsed = clientReturnCreateSchema.parse({
        client_id: '15f5fb57-8da7-4ce1-bd88-c7fc9da7a638',
        items: [{
            product_id: 'a5a252ca-9af2-455d-89d7-87150716f8ae',
            quantity: 1,
            condition_status: 'supplier_rma'
        }]
    });

    assert.equal(parsed.items?.[0]?.condition_status, 'supplier_rma');
});

test('product contract preserves optional commercial attributes and image URL', () => {
    const parsed = createProductSchema.parse({
        sku: 'QA-ATTR-001',
        name: 'Camiseta QA',
        family_name: 'Camiseta Essential',
        brand: 'Marca QA',
        size: 'M',
        color: 'Azul',
        image_url: 'http://localhost:3001/uploads/products/qa.jpg'
    });

    assert.equal(parsed.brand, 'Marca QA');
    assert.equal(parsed.family_name, 'Camiseta Essential');
    assert.equal(parsed.size, 'M');
    assert.equal(parsed.color, 'Azul');
    assert.match(parsed.image_url || '', /uploads\/products/);
});

test('cheque payment contract requires instrument details only for cheques', () => {
    assert.equal(orderPaymentLineSchema.parse({ method: 'cash', amount: 1 }).method, 'cash');
    assert.throws(
        () => orderPaymentLineSchema.parse({ method: 'check', amount: 1 }),
        (error) => error.issues?.some((issue) => issue.path?.[0] === 'check')
    );
    const parsed = orderPaymentLineSchema.parse({
        method: 'check', amount: 10,
        check: { issuer_name: 'Ana', bank_name: 'Banco', check_number: '1', due_date: '2026-09-01' }
    });
    assert.equal(parsed.check?.check_number, '1');
});

test('POS order contract preserves total_amount, item unit_price and vat_rate', () => {
    const parsed = createOrderSchema.parse({
        idempotency_key: '0a252ca9-9af2-455d-89d7-87150716f8ae',
        customer_name: 'Consumidor final',
        payment_method: 'cash',
        total_amount: 1452000,
        payments: [{ method: 'cash', amount: 1452000 }],
        items: [{
            product_id: '15f5fb57-8da7-4ce1-bd88-c7fc9da7a638',
            quantity: 1,
            unit_price: 1200000,
            vat_rate: 21.00
        }]
    });

    assert.equal(parsed.total_amount, 1452000);
    assert.equal(parsed.items[0].unit_price, 1200000);
    assert.equal(parsed.items[0].vat_rate, 21.00);
    assert.equal(parsed.payments?.[0].amount, 1452000);
});
