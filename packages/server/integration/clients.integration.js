import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool } from './helpers/qaDb.js';
import clientService from '../services/client.service.js';
import supplierService from '../domains/procurement/SupplierService.js';

test.after(async () => {
    await closePool();
});

// A fresh, valid-looking CUIT for each run (the QA database keeps rows between runs).
function freshCuit(prefix = '27') {
    return `${prefix}${String(Date.now()).slice(-8)}${crypto.randomInt(0, 10)}`;
}

const dashed = (cuit) => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;

test('AUD-012: two customers saved at once with the same CUIT, typed differently, create only one', async () => {
    const cuit = freshCuit();
    const results = await Promise.allSettled([
        clientService.createClient({ body: { name: 'QA CUIT uno', tax_id: cuit } }),
        clientService.createClient({ body: { name: 'QA CUIT dos', tax_id: ` ${dashed(cuit)} ` } }),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    const refused = results.find(({ status }) => status === 'rejected');
    assert.equal(refused.reason.statusCode, 409);
    assert.equal(refused.reason.errorCode, 'duplicate_tax_id');
    const [[{ count }]] = await pool.query(
        "SELECT COUNT(*) AS count FROM clients WHERE REPLACE(REPLACE(tax_id, '-', ''), ' ', '') = ? AND deleted_at IS NULL",
        [cuit]
    );
    assert.equal(Number(count), 1);
    // The CUIT is stored as typed (trimmed), not rewritten.
    const created = results.find(({ status }) => status === 'fulfilled').value;
    assert.ok([cuit, dashed(cuit)].includes(created.tax_id));
});

test('AUD-012: customers without a CUIT are never duplicates of each other', async () => {
    const first = await clientService.createClient({ body: { name: 'QA sin CUIT 1', tax_id: '' } });
    const second = await clientService.createClient({ body: { name: 'QA sin CUIT 2', tax_id: '  ' } });
    assert.deepEqual([first.tax_id, second.tax_id], [null, null]);
});

test('AUD-009: a stale edit form is refused, and a sale moving the balance does not make it stale', async () => {
    const created = await clientService.createClient({ body: { name: 'QA Edición', tax_id: freshCuit('20'), credit_limit: 1000 } });
    const expected = {
        name: created.name, tax_id: created.tax_id, email: null, phone: null, address: null,
        credit_limit: 1000, tax_condition_id: null,
    };
    // A sale on account moves the balance and the points meanwhile: not an edit.
    await pool.query('UPDATE clients SET current_account_balance = 50, loyalty_points = 3 WHERE id = ?', [created.id]);
    const first = await clientService.updateClient({ id: created.id, body: { name: 'QA Edición A', tax_id: created.tax_id, credit_limit: 1000, expected } });
    assert.equal(first.name, 'QA Edición A');

    // The second person still has the form loaded before the first save.
    await assert.rejects(
        () => clientService.updateClient({ id: created.id, body: { name: 'QA Edición B', tax_id: created.tax_id, credit_limit: 1000, expected } }),
        (error) => error.statusCode === 409 && error.errorCode === 'client_changed'
    );
    const [[row]] = await pool.query('SELECT name FROM clients WHERE id = ?', [created.id]);
    assert.equal(row.name, 'QA Edición A', 'the first save is kept');

    // Deleted meanwhile (nothing invoiced, so its account is settled): 404, never an empty answer.
    await clientService.deleteClient({ id: created.id });
    await assert.rejects(
        () => clientService.updateClient({ id: created.id, body: { name: 'QA tarde', tax_id: created.tax_id } }),
        (error) => error.statusCode === 404
    );
});

test('AUD-012: a supplier CUIT typed with dashes is the same supplier', async () => {
    const cuit = freshCuit('30');
    await supplierService.createSupplier({ name: 'QA Proveedor CUIT', tax_id: cuit }, null);
    await assert.rejects(
        () => supplierService.createSupplier({ name: 'QA Proveedor CUIT bis', tax_id: dashed(cuit) }, null),
        (error) => error.statusCode === 409 && error.errorCode === 'duplicate_tax_id'
    );
});
