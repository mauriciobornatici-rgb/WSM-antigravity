import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrderSchema, manualInvoiceSchema } from '@wsm/common';

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
