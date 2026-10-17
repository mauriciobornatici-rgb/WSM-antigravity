import test from 'node:test';
import assert from 'node:assert/strict';

import { cellDecimal, cellText, isEmail, plainText, RowIssues, summarize } from '../domains/imports/importCells.js';
import { ProductImportService } from '../domains/imports/ProductImportService.js';
import { ClientImportService, SupplierImportService } from '../domains/imports/PartyImportService.js';
import { canImport } from '../routes/importRoutes.js';
import { previewImport, commitImport } from '../controllers/importController.js';
import productImportService from '../domains/imports/ProductImportService.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim();

// A database that answers each statement from `handler` and records every call.
function fakeDb(handler) {
    const calls = [];
    const lifecycle = [];
    const query = async (sql, params = []) => {
        const statement = norm(sql);
        calls.push({ statement, params });
        if (statement.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
        const answer = await handler(statement, params);
        return answer ?? [{ affectedRows: 1 }];
    };
    const connection = {
        query,
        beginTransaction: async () => { lifecycle.push('begin'); },
        commit: async () => { lifecycle.push('commit'); },
        rollback: async () => { lifecycle.push('rollback'); },
        release: () => { lifecycle.push('release'); },
    };
    return { db: { query, getConnection: async () => connection }, calls, lifecycle };
}

function silenceAudit(t) {
    const original = auditService.log;
    const audits = [];
    auditService.log = async (payload) => { audits.push(payload); };
    t.after(() => { auditService.log = original; });
    return audits;
}

test('cells are read the way a person in Argentina means them', () => {
    const value = (cell) => cellDecimal(cell).value;
    assert.equal(value('1.234,56'), 1234.56);
    assert.equal(value('1,234.56'), 1234.56);
    assert.equal(value('12.500'), 12500, 'a dot with three digits is a thousands mark');
    assert.equal(value('0.125'), 0.125, 'never after a 0');
    assert.equal(value('1.234.567'), 1234567);
    assert.equal(value('1,234,567'), 1234567);
    assert.equal(value('10.5'), 10.5);
    assert.equal(value('2,5'), 2.5);
    assert.equal(value('$ 12.100'), 12100);
    assert.equal(value('ARS 99'), 99);
    assert.equal(value('-5'), -5);
    assert.equal(value(1234.5), 1234.5);
    assert.equal(value(''), null);
    assert.equal(value(null), null);
    assert.ok(cellDecimal('abc').error);
    assert.ok(cellDecimal('1.2.3,4,5').error);
    assert.ok(cellDecimal(true).error);
    assert.ok(cellDecimal(Number.NaN).error);

    assert.equal(cellText(7790001234567), '7790001234567', 'a barcode read as a number keeps every digit');
    assert.equal(cellText(12.5), '12.5');
    assert.equal(cellText('  Remera   Dry  '), 'Remera Dry');
    assert.equal(cellText(''), null);
    assert.equal(cellText(true), null);
    assert.equal(cellText(Number.POSITIVE_INFINITY), null);
    assert.equal(plainText('  Categoría / Rubro!! '), 'categoria / rubro');
    assert.equal(isEmail('a@b.co'), true);
    assert.equal(isEmail('a@b'), false);

    const issues = new RowIssues();
    assert.equal(issues.decimal('-1', 'Stock'), null);
    assert.equal(issues.decimal('2,5', 'Stock', { integer: true }), null);
    assert.equal(issues.decimal('x', 'Costo'), null);
    assert.equal(issues.text('abcdef', 'SKU', 3), null);
    assert.equal(issues.text('abc', 'SKU', 3), 'abc');
    assert.equal(issues.decimal('99', 'Stock', { max: 10 }), null);
    assert.equal(issues.decimal(4132.231404958678, 'Costo', { decimals: 2 }), 4132.23, 'cents, as the column keeps it');
    assert.deepEqual(issues.errors, [
        'Stock: no puede ser menor que 0.',
        'Stock: tiene que ser un número entero.',
        'Costo: no es un número ("x").',
        'SKU: admite hasta 3 caracteres.',
        'Stock: 99 es demasiado grande (máximo 10).',
    ]);
    assert.deepEqual(summarize([{ action: 'create' }, { action: 'skip' }, { action: 'error' }, { action: 'create' }]), { create: 2, update: 0, skip: 1, error: 1 });
});

const EXISTING = {
    id: 'p-old', sku: 'OLD-1', name: 'Pelota', barcode: '111', sale_price: '1000.0000', vat_rate: '21.00', purchase_price: '500.00',
    category: 'Balones', category_option_id: 'opt-group-old', subcategory: 'Fútbol', subcategory_option_id: 'opt-sub-old',
    brand: null, size: null, color: null, location: null, supplier_id: null, stock_min: 0, description: null, deleted_at: null,
};

function productDb({ existing = [EXISTING], barcodes = [], locations = ['DEP-A1'], suppliers = [], stockOf = {} } = {}) {
    return fakeDb(async (statement, params) => {
        if (statement.startsWith('SELECT * FROM products WHERE sku IN')) return [existing.filter((row) => params[0].map((sku) => sku.toLowerCase()).includes(row.sku.toLowerCase()))];
        if (statement.startsWith('SELECT id, sku, barcode FROM products')) return [barcodes];
        if (statement.startsWith('SELECT code FROM warehouse_locations')) return [locations.filter((code) => params[0].map((value) => value.toLowerCase()).includes(code.toLowerCase())).map((code) => ({ code }))];
        if (statement.startsWith('SELECT id, name, tax_id FROM suppliers')) return [suppliers];
        if (statement.includes('FROM inventory WHERE product_id IN')) return [[]];
        if (statement.startsWith('SELECT * FROM products WHERE id IN')) return [existing.filter((row) => params[0].includes(row.id))];
        if (statement.startsWith('SELECT quantity FROM inventory WHERE product_id = ?')) return [stockOf[params[0]] ? [{ quantity: stockOf[params[0]] }] : []];
        if (statement.startsWith('SELECT id, name, active FROM product_catalog_options WHERE option_key')) return [[{ id: `opt-${params[0].slice(0, 6)}`, name: 'Valor', active: 1 }]];
        if (statement.includes('FROM product_families')) return [[{ id: 'family-1' }]];
        return undefined;
    });
}

test('product preview: create, skip, update and every row error, without writing', async () => {
    const { db, calls } = productDb({
        existing: [EXISTING, { ...EXISTING, id: 'p-del', sku: 'DEL-1', deleted_at: new Date() }],
        barcodes: [{ id: 'p-x', sku: 'OTHER', barcode: '999' }],
        suppliers: [{ id: 's-1', name: 'Distribuidora Sur', tax_id: '30-71234567-4' }],
    });
    const service = new ProductImportService({ db });
    const rows = [
        { row: 2, sku: 'NEW-1', name: 'Remera', sale_price: '12.100', cost: 5000, stock: 3, vat_rate: 0.105, location: 'dep-a1', supplier: '30712345674' },
        { row: 3, sku: 'old-1', name: 'Pelota', sale_price: 1210 },
        { row: 4, sku: 'DEL-1', name: 'Borrado', sale_price: 1 },
        { row: 5, sku: 'NEW-2', name: 'Con código ajeno', sale_price: 1, barcode: 999 },
        { row: 6, sku: 'NEW-3', name: 'Proveedor desconocido', sale_price: 0, supplier: 'Nadie SA' },
        { row: 7, sku: 'NEW-4', name: 'Sin categoría', sale_price: 1, subcategory: 'Remeras' },
        { row: 8, name: 'Sin SKU', sale_price: 1 },
        { row: 9, sku: 'NEW-5', sale_price: 1, supplier: 'distribuidora sur' },
    ];
    const preview = await service.preview(rows);
    const result = new Map(preview.rows.map((row) => [row.row, row]));
    assert.equal(result.get(2).action, 'create');
    assert.equal(result.get(3).action, 'skip');
    assert.match(result.get(3).warnings[0], /Ya existe: se saltea/);
    assert.match(result.get(4).errors[0], /producto dado de baja/);
    assert.match(result.get(5).errors[0], /ya lo tiene el producto OTHER/);
    assert.equal(result.get(6).action, 'create');
    assert.match(result.get(6).warnings.join(' '), /no está cargado; el producto queda sin proveedor/);
    assert.match(result.get(6).warnings.join(' '), /El precio de venta es 0/);
    assert.match(result.get(7).errors[0], /La subcategoría necesita la categoría/);
    assert.match(result.get(8).errors[0], /Falta el SKU/);
    assert.match(result.get(9).errors[0], /Falta el Nombre/);
    assert.equal(calls.some(({ statement }) => /^(INSERT|UPDATE)/.test(statement)), false, 'a preview never writes');

    const updating = await service.preview([{ row: 3, sku: 'OLD-1', stock: 4 }], { updateExisting: true });
    assert.equal(updating.rows[0].action, 'update');
    assert.match(updating.rows[0].warnings[0], /El stock de un producto existente no cambia/);
});

test('product commit: creates with opening stock and one entry for the batch, updates keeping the final price', async (t) => {
    const audits = silenceAudit(t);
    const entries = [];
    const originalEntry = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (connection, entry) => { entries.push(entry); return 'je-1'; };
    t.after(() => { accountingService.createJournalEntry = originalEntry; });

    const { db, calls, lifecycle } = productDb();
    const service = new ProductImportService({ db });
    const response = await service.commit([
        { row: 2, sku: 'NEW-1', name: 'Remera', family: 'Remera', category: 'Indumentaria', subcategory: 'Remeras', brand: 'Marca', size: 'M', color: 'Azul', sale_price: 12100, cost: 5000, stock: 3, location: 'DEP-A1' },
        { row: 3, sku: 'NEW-2', name: 'Medias', sale_price: 1000, cost: 250, stock: 2 },
        // A new VAT rate without a price keeps the final price (1210): only the net changes.
        { row: 4, sku: 'OLD-1', vat_rate: 10.5, category: 'Pelotas', cost: '500,00' },
    ], { updateExisting: true, batchId: '00000000-0000-4000-8000-000000000001' }, 'u-1');
    assert.deepEqual(response.summary, { create: 2, update: 1, skip: 0, error: 0 });
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);

    const inserts = calls.filter(({ statement }) => statement.startsWith('INSERT INTO products'));
    assert.equal(inserts.length, 2);
    const [first] = inserts;
    const columns = first.statement.match(/\(([^)]+)\)/)[1].split(', ');
    const product = Object.fromEntries(columns.map((column, index) => [column, first.params[index]]));
    assert.deepEqual([product.sale_price, product.purchase_price, product.vat_rate, product.location, product.origin], [10000, 5000, 21, 'DEP-A1', 'erp']);
    assert.ok(product.category_option_id && product.subcategory_option_id && product.size_option_id);
    assert.equal(calls.filter(({ statement }) => statement.startsWith('INSERT INTO product_catalog_options')).length, 6, 'the five values of row 2 and the new category of row 4, once each');
    const stock = calls.filter(({ statement }) => statement.startsWith('INSERT INTO inventory '));
    assert.deepEqual(stock.map(({ params }) => [params[2], params[3]]), [['DEP-A1', 3], ['General', 2]]);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].reference_type, 'product_import');
    assert.deepEqual(entries[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [['1.1.04.01', 15500, 0], ['3.1.03.01', 0, 15500]]);
    assert.match(entries[0].description, /Stock inicial importado: 2 productos \(importación 00000000\)/);

    const update = calls.find(({ statement }) => statement.startsWith('UPDATE products SET'));
    const setColumns = update.statement.match(/SET (.+) WHERE/)[1].split(', ').map((part) => part.split(' = ')[0]);
    const changes = Object.fromEntries(setColumns.map((column, index) => [column, update.params[index]]));
    assert.equal(changes.vat_rate, 10.5);
    assert.equal(changes.sale_price, 1095.0226, 'the final price 1210 stays: 1210 / 1,105');
    assert.equal(changes.purchase_price, undefined, 'the same cost is not a change');
    assert.equal(changes.subcategory, null, 'a new category drops the old subcategory');
    assert.ok(audits.some(({ action }) => action === 'IMPORT_PRODUCTS'));
    assert.ok(audits.some(({ action, old_values }) => action === 'UPDATE_PRODUCT' && old_values.vat_rate === '21.00'));
});

test('product preview: what was read is shown, no opening stock where nothing is sold, a new cost on stock warns', async () => {
    const { db } = productDb({ locations: ['DEP-A1', 'Cuarentena'] });
    db.query = ((query) => async (sql, params) => {
        if (String(sql).includes('FROM inventory WHERE product_id IN')) return [[{ product_id: 'p-old', quantity: '7' }]];
        return query(sql, params);
    })(db.query);
    const service = new ProductImportService({ db });
    const preview = await service.preview([
        { row: 2, sku: 'NEW-1', name: 'Remera', sale_price: '12.100', cost: '4132,2314', stock: 2, location: 'cuarentena' },
        { row: 3, sku: 'NEW-2', name: 'Short', sale_price: '9.900,5', cost: 4000, stock: 1 },
        { row: 4, sku: 'OLD-1', cost: 600 },
        { row: 5, sku: 'NEW-3', name: 'Pesado', sale_price: 1, stock: 2e9 },
    ], { updateExisting: true });
    const result = new Map(preview.rows.map((row) => [row.row, row]));
    assert.match(result.get(2).errors[0], /no se puede cargar en "Cuarentena"/);
    assert.deepEqual(result.get(3).values, { sale_price: 9900.5, cost: 4000, stock: 1 });
    assert.deepEqual(result.get(2).values, { sale_price: 12100, cost: 4132.23, stock: 2 });
    assert.match(result.get(4).warnings.join(' '), /El costo cambia y hay 7 unidades en stock: se registra un asiento de revaluación \(ganancia por tenencia de \$700,00\)/);
    assert.match(result.get(5).errors[0], /Stock inicial: 2000000000 es demasiado grande/);
});

test('product commit: a catalog value that is turned off is used, with a warning; a new one is audited', async (t) => {
    const audits = silenceAudit(t);
    const { db } = fakeDb(async (statement) => {
        if (statement.startsWith('INSERT INTO product_catalog_options')) return [{ affectedRows: 0 }];
        if (statement.startsWith('SELECT id, name, active FROM product_catalog_options')) return [[{ id: 'opt-old', name: 'Vieja', active: 0 }]];
        if (statement.includes('FROM product_families')) return [[{ id: 'family-1' }]];
        return statement.startsWith('SELECT') ? [[]] : undefined;
    });
    const response = await new ProductImportService({ db }).commit([{ row: 2, sku: 'N-1', name: 'Gorra', sale_price: 100, brand: 'vieja' }], { batchId: 'b' });
    assert.match(response.rows[0].warnings.join(' '), /Marca "Vieja" está desactivada en el catálogo: se usa igual/);
    assert.equal(audits.some(({ action }) => action === 'CREATE_PRODUCT_CATALOG_OPTION'), false, 'it already existed');
});

test('product commit: a new cost on goods in stock is revalued with its entry; stock locked before the products', async (t) => {
    const audits = silenceAudit(t);
    const entries = [];
    const originalEntry = accountingService.createJournalEntry;
    accountingService.createJournalEntry = async (connection, entry) => { entries.push(entry); return 'je-r'; };
    t.after(() => { accountingService.createJournalEntry = originalEntry; });
    const { db, calls } = productDb({ stockOf: { 'p-old': 7 } });
    await new ProductImportService({ db }).commit([{ row: 2, sku: 'OLD-1', cost: 600 }], { updateExisting: true, batchId: 'b-9' }, 'u-1');
    const order = calls.map(({ statement }) => statement);
    const stockLock = order.findIndex((statement) => statement.startsWith('SELECT id FROM inventory WHERE product_id IN'));
    const productLock = order.findIndex((statement) => statement.startsWith('SELECT * FROM products WHERE id IN'));
    assert.ok(stockLock >= 0 && stockLock < productLock, 'the order of a sale: stock, then the product');
    assert.deepEqual(entries[0].lines.map(({ account_code, debit, credit }) => [account_code, debit, credit]), [['1.1.04.01', 700, 0], ['4.2.02.01', 0, 700]]);
    const revalued = audits.find(({ action }) => action === 'REVALUE_STOCK');
    assert.deepEqual([revalued.new_values.source, revalued.new_values.batch_id, revalued.new_values.amount], ['import', 'b-9', 700]);
});

test('product commit: a deadlock with another import answers 409 busy (the batch can be sent again)', async (t) => {
    silenceAudit(t);
    const locked = fakeDb(async (statement) => {
        if (statement.startsWith('INSERT INTO products')) throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' });
        return statement.startsWith('SELECT') ? [[]] : undefined;
    });
    await assert.rejects(
        () => new ProductImportService({ db: locked.db }).commit([{ row: 2, sku: 'X', name: 'X', sale_price: 1 }], { batchId: 'b' }),
        (error) => error.statusCode === 409 && error.errorCode === 'busy'
    );
});

test('product commit: nothing to change, nothing written; a duplicate SKU from someone else rolls back with 409', async (t) => {
    silenceAudit(t);
    const { db, calls } = productDb();
    const service = new ProductImportService({ db });
    const same = await service.commit([{ row: 2, sku: 'OLD-1', name: 'Pelota', sale_price: 1210 }], { updateExisting: true, batchId: 'b' });
    assert.match(same.rows[0].warnings.join(' '), /No había nada distinto/);
    assert.equal(calls.some(({ statement }) => statement.startsWith('UPDATE products')), false);

    const failing = fakeDb(async (statement) => {
        if (statement.startsWith('INSERT INTO products')) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        return statement.startsWith('SELECT') ? [[]] : undefined;
    });
    await assert.rejects(
        () => new ProductImportService({ db: failing.db }).commit([{ row: 2, sku: 'X', name: 'X', sale_price: 1 }], { batchId: 'b' }),
        (error) => error.statusCode === 409 && error.errorCode === 'import_conflict'
    );
    assert.deepEqual(failing.lifecycle, ['begin', 'rollback', 'release']);
    const broken = fakeDb(async () => { throw new Error('boom'); });
    await assert.rejects(() => new ProductImportService({ db: broken.db }).commit([{ row: 2, sku: 'X' }], { batchId: 'b' }), /boom/);
});

const CLIENT = { id: 'c-1', name: 'Club SA', tax_id: '30-71234567-4', tax_condition_id: 'tc_RespInscripto', email: null, phone: null, address: null, credit_limit: '1000.00' };

// `existing`: found by CUIT; `others`: every other row, found by name when a row has no CUIT.
function partyDb({ existing = [CLIENT], others = [] } = {}) {
    return fakeDb(async (statement) => {
        if (/^SELECT \* FROM (clients|suppliers) WHERE deleted_at IS NULL$/.test(statement)) return [[...existing, ...others]];
        if (statement.startsWith('SELECT * FROM clients') || statement.startsWith('SELECT * FROM suppliers')) return [existing];
        return undefined;
    });
}

test('client preview: VAT condition words, the Responsable Inscripto rule, duplicates and names without CUIT', async () => {
    const twins = [{ id: 'c-a', name: 'Ana Gómez' }, { id: 'c-b', name: 'ana gomez' }];
    const { db } = partyDb({ others: [{ id: 'c-j', name: 'Juan Pérez', tax_id: null }, ...twins] });
    const service = new ClientImportService({ db });
    const preview = await service.preview([
        { row: 2, name: 'Club SA', tax_id: '30712345674' },
        { row: 3, name: 'Juan Perez', tax_condition: 'consumidor final' },
        { row: 4, name: 'Juan Perez' },
        { row: 5, name: 'Mono', tax_condition: 'Monotributo', email: 'x' },
        { row: 6, name: 'RI sin CUIT', tax_condition: 'RI' },
        { row: 7, name: 'Raro', tax_condition: 'Jubilado' },
        { row: 8, name: 'X', tax_id: '20-11111111-1' },
        { row: 9, name: 'Otro', tax_id: '20111111111' },
        { row: 10, name: 'Límite malo', credit_limit: 'mucho' },
        { row: 11, name: 'Ana Gomez' },
        { row: 12, name: 'Nueva Persona' },
        { row: 13, name: 'nueva persona' },
    ]);
    const result = new Map(preview.rows.map((row) => [row.row, row]));
    assert.equal(result.get(2).action, 'skip');
    // Without CUIT, the exact name is the client: importing again never duplicates it.
    assert.equal(result.get(3).action, 'skip');
    assert.match(result.get(3).warnings[0], /Ya existe \(Juan Pérez\) \(mismo nombre, sin CUIT \/ DNI/);
    assert.equal(result.get(4).action, 'skip', 'the same existing client again');
    assert.equal(result.get(11).action, 'skip');
    assert.match(result.get(11).warnings[0], /Ya hay 2 con ese nombre/);
    assert.equal(result.get(12).action, 'create');
    assert.match(result.get(13).errors[0], /Mismo nombre que la fila 12 y ninguna tiene CUIT \/ DNI/);
    assert.match(result.get(5).errors[0], /no es un correo válido/);
    assert.match(result.get(6).errors[0], /Un Responsable Inscripto necesita el CUIT/);
    assert.match(result.get(7).errors[0], /"Jubilado" no es válida \(Consumidor Final, Responsable Inscripto, Monotributista, Exento\)/);
    assert.match(result.get(8).errors[0], /Falta el Nombre o razón social/);
    assert.match(result.get(9).errors[0], /repetido en el archivo \(ya está en la fila 8\)/);
    assert.match(result.get(10).errors[0], /Límite de crédito: no es un número/);

    // Updating: the condition kept from the stored client still needs the CUIT it has.
    const updating = await service.preview([
        { row: 2, name: 'Club SA', tax_id: '30-71234567-4', credit_limit: 2000 },
        { row: 3, name: 'Juan Pérez', phone: '351 1234' },
        { row: 4, name: 'Ana Gomez', phone: '351 9999' },
    ], { updateExisting: true });
    const updated = new Map(updating.rows.map((row) => [row.row, row]));
    assert.equal(updated.get(2).action, 'update');
    assert.equal(updated.get(3).action, 'update', 'found by its name');
    assert.match(updated.get(4).errors[0], /Hay 2 con ese nombre y la fila no tiene CUIT \/ DNI/);
});

test('client and supplier commit: locks every CUIT in order, creates, updates only what differs, audits the batch', async (t) => {
    const audits = silenceAudit(t);
    const { db, calls, lifecycle } = partyDb();
    const service = new ClientImportService({ db });
    const response = await service.commit([
        { row: 2, name: 'Club SA', tax_id: '30-71234567-4', credit_limit: '2.000', email: 'admin@club.com' },
        { row: 3, name: 'Nuevo', tax_id: '20-22222222-2', tax_condition: 'Exento' },
        { row: 4, name: 'Sin CUIT' },
    ], { updateExisting: true, batchId: 'batch-1' }, 'u-1');
    assert.deepEqual(response.summary, { create: 2, update: 1, skip: 0, error: 0 });
    assert.deepEqual(calls.filter(({ statement }) => statement.startsWith('SELECT GET_LOCK')).map(({ params }) => params[0]), [
        'client_tax_id:20222222222', 'client_tax_id:30712345674', 'clients_import_name:sin cuit',
    ]);
    assert.ok(calls.some(({ statement }) => statement.endsWith('ORDER BY id FOR UPDATE')), 'clients to update are locked and read again');
    const update = calls.find(({ statement }) => statement.startsWith('UPDATE clients SET'));
    assert.match(update.statement, /SET email = \?, credit_limit = \? WHERE/);
    assert.deepEqual(update.params, ['admin@club.com', 2000, 'c-1']);
    const inserts = calls.filter(({ statement }) => statement.startsWith('INSERT INTO clients'));
    assert.deepEqual(inserts.map(({ params }) => params.slice(1)), [
        ['Nuevo', '20-22222222-2', null, null, null, 0, 'tc_Exento'],
        ['Sin CUIT', null, null, null, null, 0, null],
    ]);
    assert.deepEqual(lifecycle, ['begin', 'commit', 'release']);
    assert.ok(audits.some(({ action, entity_id }) => action === 'IMPORT_CLIENTS' && entity_id === 'batch-1'));

    const unchanged = await new ClientImportService({ db: partyDb().db }).commit([{ row: 2, name: 'Club SA', tax_id: '30712345674' }], { updateExisting: true, batchId: 'b' });
    assert.match(unchanged.rows[0].warnings.join(' '), /No había nada distinto/);

    const suppliers = partyDb({ existing: [] });
    const supplierResponse = await new SupplierImportService({ db: suppliers.db }).commit([
        { row: 2, name: 'Textil SRL', tax_id: '30-33333333-3', contact_name: 'Ana', category: 'Indumentaria' },
    ], { batchId: 'b' }, null);
    assert.equal(supplierResponse.summary.create, 1);
    const supplierInsert = suppliers.calls.find(({ statement }) => statement.startsWith('INSERT INTO suppliers'));
    assert.match(supplierInsert.statement, /\(id, name, tax_id, contact_name, email, phone, address, category\)/);
    assert.equal(suppliers.calls.find(({ statement }) => statement.startsWith('SELECT GET_LOCK')).params[0], 'supplier_tax_id:30333333333');
    assert.ok(audits.some(({ action }) => action === 'IMPORT_SUPPLIERS'));
});

test('import permission: each kind of data needs its own permission, an unknown kind is 404', () => {
    const respond = (entity, role) => {
        let status = null;
        let passed = false;
        const res = { status(code) { status = code; return this; }, json() { return this; } };
        canImport({ params: { entity }, user: { role } }, res, () => { passed = true; });
        return passed ? 'next' : status;
    };
    assert.equal(respond('products', 'warehouse'), 'next');
    assert.equal(respond('products', 'cashier'), 403);
    assert.equal(respond('clients', 'cashier'), 'next');
    assert.equal(respond('clients', 'warehouse'), 403);
    assert.equal(respond('suppliers', 'manager'), 'next');
    assert.equal(respond('suppliers', 'cashier'), 403);
    assert.equal(respond('constructor', 'admin'), 404);
    assert.equal(respond('orders', 'admin'), 404);
});

test('import controller hands the rows to the service of the entity', async (t) => {
    const original = { preview: productImportService.preview, commit: productImportService.commit };
    const seen = [];
    productImportService.preview = async (rows, options) => { seen.push(['preview', rows.length, options]); return { summary: {}, rows: [] }; };
    productImportService.commit = async (rows, options, userId) => { seen.push(['commit', rows.length, options, userId]); return { summary: {}, rows: [] }; };
    t.after(() => Object.assign(productImportService, original));
    const call = (handler, req) => new Promise((resolve, reject) => handler(req, { json: resolve }, (error) => (error ? reject(error) : resolve())));
    await call(previewImport, { params: { entity: 'products' }, body: { rows: [{ row: 2 }], update_existing: true } });
    await call(commitImport, { params: { entity: 'products' }, body: { rows: [{ row: 2 }], update_existing: false, batch_id: 'b-1' }, user: { id: 'u-9' } });
    assert.deepEqual(seen, [
        ['preview', 1, { updateExisting: true }],
        ['commit', 1, { updateExisting: false, batchId: 'b-1' }, 'u-9'],
    ]);
});
