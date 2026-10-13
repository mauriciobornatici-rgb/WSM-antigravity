import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSchema } from '@wsm/common';

test('client VAT condition: only known ids, and A-type customers need an 11-digit CUIT (ADR-021, AUD-009)', () => {
    assert.equal(clientSchema.safeParse({ name: 'Ana', tax_id: '28999000' }).success, true);
    assert.equal(clientSchema.safeParse({ name: 'Ana', tax_id: '28999000', tax_condition_id: 'tc_ConsFinal' }).success, true);
    assert.equal(clientSchema.safeParse({ name: 'Ana', tax_id: '28999000', tax_condition_id: null }).success, true);
    assert.equal(clientSchema.safeParse({ name: 'Ana', tax_id: '1', tax_condition_id: 'tc_Inventada' }).success, false);

    const ri = clientSchema.safeParse({ name: 'Club', tax_id: '28999000', tax_condition_id: 'tc_RespInscripto' });
    assert.equal(ri.success, false);
    assert.deepEqual(ri.error.issues[0].path, ['tax_id']);
    assert.match(ri.error.issues[0].message, /CUIT \(11 dígitos\)/);
    assert.equal(clientSchema.safeParse({ name: 'Club', tax_condition_id: 'tc_Monotributo' }).success, false);
    assert.equal(clientSchema.safeParse({ name: 'Club', tax_id: '30-71234567-4', tax_condition_id: 'tc_RespInscripto' }).success, true);
    assert.equal(clientSchema.safeParse({ name: 'Club', tax_id: '20123456789', tax_condition_id: 'tc_Monotributo' }).success, true);
});
