import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { closePool, pool } from './helpers/qaDb.js';
import productImportService from '../domains/imports/ProductImportService.js';
import { clientImportService, supplierImportService } from '../domains/imports/PartyImportService.js';

test.after(async () => {
    await closePool();
});

const run = crypto.randomUUID().slice(0, 6).toUpperCase();
const freshCuit = (prefix) => `${prefix}${String(Date.now()).slice(-8)}${crypto.randomInt(0, 10)}`;
const dashed = (cuit) => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
const byRow = (response) => new Map(response.rows.map((row) => [row.row, row]));

test('products: preview says what happens with each row, and nothing is saved', async () => {
    const rows = [
        { row: 2, sku: `IMP-${run}-P1`, name: 'Preview QA', sale_price: 100 },
        { row: 3, sku: `IMP-${run}-P1`, name: 'Repetido', sale_price: 100 },
        { row: 4, sku: `IMP-${run}-P2`, name: 'Sin costo', sale_price: 100, stock: 5 },
        { row: 5, sku: `IMP-${run}-P3`, name: 'Ubicación', sale_price: 100, location: 'NO-EXISTE-QA' },
        { row: 6, sku: `IMP-${run}-P4`, name: 'IVA raro', sale_price: 100, vat_rate: 19 },
        { row: 7, sku: `IMP-${run}-P5`, name: 'Sin precio' },
    ];
    const preview = await productImportService.preview(rows);
    assert.deepEqual(preview.summary, { create: 1, update: 0, skip: 0, error: 5 });
    const result = byRow(preview);
    assert.match(result.get(3).errors[0], /SKU repetido en el archivo \(ya está en la fila 2\)/);
    assert.match(result.get(4).errors[0], /Para cargar Stock inicial indicá el Costo neto/);
    assert.match(result.get(5).errors[0], /"NO-EXISTE-QA" no existe/);
    assert.match(result.get(6).errors[0], /no es una alícuota válida/);
    assert.match(result.get(7).errors[0], /Falta el Precio de venta final/);
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM products WHERE sku LIKE ?', [`IMP-${run}-P%`]);
    assert.equal(Number(count), 0);
});

test('products: import creates them with the manual rules (net price, opening stock with its entry, catalog, family)', async () => {
    const location = `QA-IMP-${run}`;
    await pool.query('INSERT INTO warehouse_locations (id, code, name, active) VALUES (?, ?, ?, TRUE)', [crypto.randomUUID(), location, 'Ubicación QA importación']);
    const supplierCuit = freshCuit('30');
    await supplierImportService.commit([{ row: 2, name: `Proveedor importado ${run}`, tax_id: supplierCuit, category: 'Indumentaria' }], { batchId: crypto.randomUUID() });

    const rows = [
        {
            row: 2, sku: `IMP-${run}-M`, name: 'Remera Dry QA', family: `Remera Dry QA ${run}`, category: `Indumentaria ${run}`,
            subcategory: 'Remeras', brand: `Marca ${run}`, size: 'M', color: 'Azul', vat_rate: 21, cost: '5.000', sale_price: '12.100',
            stock: 10, location: location.toLowerCase(), barcode: 7790000000000 + crypto.randomInt(1, 99999), supplier: dashed(supplierCuit),
        },
        { row: 3, sku: `IMP-${run}-L`, name: 'Remera Dry QA', family: `Remera Dry QA ${run}`, category: `Indumentaria ${run}`, brand: `Marca ${run}`, size: 'L', color: 'Azul', cost: 5000, sale_price: 12100 },
        // A percentage cell of Excel (0,105) and a final price typed with a comma.
        { row: 4, sku: `IMP-${run}-Q`, name: 'Botella QA', vat_rate: 0.105, sale_price: '1.050,00' },
    ];
    const batchId = crypto.randomUUID();
    const response = await productImportService.commit(rows, { batchId }, null);
    assert.deepEqual(response.summary, { create: 3, update: 0, skip: 0, error: 0 });

    const [products] = await pool.query('SELECT * FROM products WHERE sku LIKE ? ORDER BY sku', [`IMP-${run}-%`]);
    const bySku = new Map(products.map((product) => [product.sku, product]));
    const medium = bySku.get(`IMP-${run}-M`);
    assert.equal(Number(medium.sale_price), 10000, 'the final price is stored net');
    assert.equal(Number(medium.purchase_price), 5000);
    assert.equal(medium.location, location, 'the location code as it is loaded');
    assert.equal(medium.origin, 'erp');
    assert.ok(medium.supplier_id, 'linked to the supplier found by its CUIT');
    assert.equal(Number(bySku.get(`IMP-${run}-Q`).vat_rate), 10.5);
    assert.equal(Number(bySku.get(`IMP-${run}-Q`).sale_price), 950.2262);
    assert.equal(medium.family_id, bySku.get(`IMP-${run}-L`).family_id, 'sizes of the same article share the family');

    // Catalog values were created once and linked (the subcategory under its category).
    const [options] = await pool.query(
        'SELECT id, type, name, parent_id FROM product_catalog_options WHERE id IN (?)',
        [[medium.category_option_id, medium.subcategory_option_id, medium.brand_option_id, medium.size_option_id, medium.color_option_id]]
    );
    const optionByType = new Map(options.map((option) => [option.type, option]));
    assert.deepEqual([...optionByType.keys()].sort(), ['brand', 'color', 'group', 'size', 'subgroup']);
    assert.equal(optionByType.get('subgroup').parent_id, optionByType.get('group').id);
    assert.equal(bySku.get(`IMP-${run}-L`).category_option_id, medium.category_option_id);

    // Opening stock: only the one with stock, at cost, with one entry for the batch.
    const [[stock]] = await pool.query('SELECT location, quantity FROM inventory WHERE product_id = ?', [medium.id]);
    assert.deepEqual([stock.location, Number(stock.quantity)], [location, 10]);
    const [[movement]] = await pool.query("SELECT quantity, unit_cost FROM inventory_movements WHERE product_id = ? AND type = 'initial_stock'", [medium.id]);
    assert.deepEqual([Number(movement.quantity), Number(movement.unit_cost)], [10, 5000]);
    const [lines] = await pool.query(
        `SELECT jel.account_code, jel.debit, jel.credit FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.reference_type = 'product_import' AND je.reference_id = ? ORDER BY jel.account_code`,
        [batchId]
    );
    assert.deepEqual(lines.map((line) => [line.account_code, Number(line.debit), Number(line.credit)]), [
        ['1.1.04.01', 50000, 0],
        ['3.1.03.01', 0, 50000],
    ]);
    const [[audit]] = await pool.query("SELECT new_values FROM audit_logs WHERE action = 'IMPORT_PRODUCTS' AND entity_id = ?", [batchId]);
    assert.ok(audit, 'the batch is audited');

    // Again: skipped. Asked to update: only what differs changes, the stock never.
    const again = await productImportService.preview(rows);
    assert.deepEqual(again.summary, { create: 0, update: 0, skip: 3, error: 0 });
    const updateRows = [{ ...rows[0], sale_price: 13310, stock: 99 }, rows[1]];
    const updated = await productImportService.commit(updateRows, { updateExisting: true, batchId: crypto.randomUUID() }, null);
    assert.deepEqual(updated.summary, { create: 0, update: 2, skip: 0, error: 0 });
    assert.match(byRow(updated).get(2).warnings.join(' '), /El stock de un producto existente no cambia/);
    assert.match(byRow(updated).get(3).warnings.join(' '), /No había nada distinto/);
    const [[after]] = await pool.query('SELECT sale_price FROM products WHERE id = ?', [medium.id]);
    assert.equal(Number(after.sale_price), 11000);
    const [[stockAfter]] = await pool.query('SELECT SUM(quantity) AS quantity FROM inventory WHERE product_id = ?', [medium.id]);
    assert.equal(Number(stockAfter.quantity), 10);
});

test('clients: CUIT with or without dashes, VAT condition words, Responsable Inscripto rule, skip or update', async () => {
    const ri = freshCuit('30');
    const rows = [
        { row: 2, name: `Club Importado ${run}`, tax_id: dashed(ri), tax_condition: 'Resp. Inscripto', credit_limit: '500.000' },
        { row: 3, name: `Consumidor ${run}`, tax_condition: 'CF', email: 'cliente@ejemplo.com' },
        { row: 4, name: `Inscripto sin CUIT ${run}`, tax_condition: 'Responsable Inscripto' },
        { row: 5, name: `Correo malo ${run}`, email: 'no-es-un-correo' },
        { row: 6, name: `Repetido ${run}`, tax_id: ri },
        { row: 7, name: `Condición rara ${run}`, tax_condition: 'Jubilado' },
    ];
    const preview = await clientImportService.preview(rows);
    assert.deepEqual(preview.summary, { create: 2, update: 0, skip: 0, error: 4 });
    const result = byRow(preview);
    assert.match(result.get(4).errors[0], /Un Responsable Inscripto necesita el CUIT/);
    assert.match(result.get(5).errors[0], /no es un correo válido/);
    assert.match(result.get(6).errors[0], /repetido en el archivo \(ya está en la fila 2\)/);
    assert.match(result.get(7).errors[0], /"Jubilado" no es válida/);

    await clientImportService.commit([rows[0], rows[1]], { batchId: crypto.randomUUID() }, null);
    const [[club]] = await pool.query('SELECT * FROM clients WHERE name = ?', [`Club Importado ${run}`]);
    assert.deepEqual([club.tax_condition_id, Number(club.credit_limit), club.tax_id], ['tc_RespInscripto', 500000, dashed(ri)]);

    // The same CUIT typed without dashes is the same client: skipped, or updated when asked.
    const same = [{ row: 2, name: `Club Importado ${run}`, tax_id: ri, credit_limit: 750000 }];
    assert.deepEqual((await clientImportService.preview(same)).summary, { create: 0, update: 0, skip: 1, error: 0 });
    await clientImportService.commit(same, { updateExisting: true, batchId: crypto.randomUUID() }, null);
    const [[updated]] = await pool.query('SELECT credit_limit, tax_condition_id FROM clients WHERE id = ?', [club.id]);
    assert.deepEqual([Number(updated.credit_limit), updated.tax_condition_id], [750000, 'tc_RespInscripto'], 'an empty cell erases nothing');

    // Without CUIT the exact name is the client: importing the file again (after a cut, say)
    // never creates it twice.
    const again = await clientImportService.commit([rows[1]], { batchId: crypto.randomUUID() }, null);
    assert.equal(again.rows[0].action, 'skip');
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM clients WHERE name = ? AND deleted_at IS NULL', [`Consumidor ${run}`]);
    assert.equal(Number(count), 1);
});

test('clients: two imports saving the same CUIT at once create it once', async () => {
    const cuit = freshCuit('20');
    const [first, second] = await Promise.allSettled([
        clientImportService.commit([{ row: 2, name: `Simultáneo A ${run}`, tax_id: cuit }], { batchId: crypto.randomUUID() }, null),
        clientImportService.commit([{ row: 2, name: `Simultáneo B ${run}`, tax_id: dashed(cuit) }], { batchId: crypto.randomUUID() }, null),
    ]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(second.status, 'fulfilled');
    const actions = [first.value.rows[0].action, second.value.rows[0].action].sort();
    assert.deepEqual(actions, ['create', 'skip']);
    const [[{ count }]] = await pool.query(
        "SELECT COUNT(*) AS count FROM clients WHERE REPLACE(tax_id, '-', '') = ? AND deleted_at IS NULL",
        [cuit]
    );
    assert.equal(Number(count), 1);
});

test('ADR-027: a new cost on goods in stock is revalued (import and manual edit), the ledger stays at stock × cost', async () => {
    const { default: inventoryService } = await import('../services/inventory.service.js');
    const sku = `IMP-${run}-REV`;
    const batchId = crypto.randomUUID();
    await productImportService.commit([{ row: 2, sku, name: 'Revaluada QA', sale_price: 3000, cost: 1000, stock: 10 }], { batchId }, null);
    const [[product]] = await pool.query('SELECT id FROM products WHERE sku = ?', [sku]);

    const raised = await productImportService.commit([{ row: 2, sku, cost: '1.200' }], { updateExisting: true, batchId: crypto.randomUUID() }, null);
    assert.match(raised.rows[0].warnings.join(' '), /asiento de revaluación \(ganancia por tenencia de \$2\.000,00\)/);
    await inventoryService.updateProduct(product.id, { purchase_price: 900 }, null);

    const [[initial]] = await pool.query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS net FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.reference_type = 'product_import' AND je.reference_id = ? AND jel.account_code = '1.1.04.01'`,
        [batchId]
    );
    const [revaluations] = await pool.query(
        `SELECT jel.account_code, jel.debit, jel.credit FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.reference_type = 'stock_revaluation' AND je.reference_id = ? ORDER BY je.entry_number, jel.account_code`,
        [product.id]
    );
    assert.deepEqual(revaluations.map((line) => [line.account_code, Number(line.debit), Number(line.credit)]), [
        ['1.1.04.01', 2000, 0], ['4.2.02.01', 0, 2000],
        ['1.1.04.01', 0, 3000], ['4.2.02.01', 3000, 0],
    ]);
    const inventoryValue = Number(initial.net) + revaluations
        .filter((line) => line.account_code === '1.1.04.01')
        .reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0);
    assert.equal(inventoryValue, 10 * 900, 'the ledger matches the stock at the current cost');
    const [[{ revalued }]] = await pool.query("SELECT COUNT(*) AS revalued FROM audit_logs WHERE action = 'REVALUE_STOCK' AND entity_id = ?", [product.id]);
    assert.equal(Number(revalued), 2);
});

test('suppliers: the category (rubro) is saved and a CUIT already loaded is recognized', async () => {
    const cuit = freshCuit('33');
    await supplierImportService.commit([{ row: 2, name: `Textil Importada ${run}`, tax_id: cuit, contact_name: 'Ana', category: 'Indumentaria' }], { batchId: crypto.randomUUID() }, null);
    const [[supplier]] = await pool.query('SELECT category, contact_name FROM suppliers WHERE tax_id = ?', [cuit]);
    assert.deepEqual([supplier.category, supplier.contact_name], ['Indumentaria', 'Ana']);
    const again = await supplierImportService.preview([{ row: 2, name: 'Otro nombre', tax_id: dashed(cuit) }]);
    assert.equal(again.rows[0].action, 'skip');
});
