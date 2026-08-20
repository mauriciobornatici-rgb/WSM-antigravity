import test from 'node:test';
import assert from 'node:assert/strict';
import { schemas } from '../middleware/validationMiddleware.js';

const validQualityCheck = {
    reception_id: '11111111-1111-4111-8111-111111111111',
    product_id: '22222222-2222-4222-8222-222222222222',
    result: 'conditional',
    quantity_checked: 10,
    quantity_passed: 8,
    quantity_failed: 2,
    defect_description: 'Costura dañada'
};

test('quality check requires quantities to reconcile and defects to be described', () => {
    const parsed = schemas.qualityCheck.parse({ body: validQualityCheck });
    assert.equal(parsed.body.quantity_passed, 8);

    assert.throws(() => schemas.qualityCheck.parse({
        body: { ...validQualityCheck, quantity_checked: 9 }
    }));
    assert.throws(() => schemas.qualityCheck.parse({
        body: { ...validQualityCheck, defect_description: '' }
    }));
    assert.throws(() => schemas.qualityCheck.parse({
        body: { ...validQualityCheck, result: 'pass' }
    }));
});
