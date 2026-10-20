import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import inventoryService from '../../services/inventory.service.js';
import accountingService from '../../services/accounting.service.js';
import { catalogOptionKey, normalizeCatalogOptionName } from '../../services/catalogOptions.service.js';
import { businessError } from '../../utils/businessError.js';
import { lineAmounts, netFromGross } from '../../utils/vatMath.js';
import { taxIdKey } from '../../utils/taxId.js';
import { IMPORT_COLUMNS } from '@wsm/common';
import { NON_SELLABLE_LOCATIONS } from '../inventory/StockLedger.js';
import inventoryValuation, { effectiveCost, repricedSalePrice, valueCents } from '../inventory/InventoryValuation.js';
import { codeKey, plainText, RowIssues, summarize } from './importCells.js';

const pesos = (value) => `$${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VAT_RATES = [0, 2.5, 5, 10.5, 21, 27];
const DEFAULT_VAT_RATE = 21;
// Where opening stock goes when the row names no location, as in the manual form.
const DEFAULT_LOCATION = 'General';
const HEADER = Object.fromEntries(IMPORT_COLUMNS.products.map((column) => [column.key, column.header]));

// The catalog values a product row can name, with the product columns they fill.
const CATALOG_FIELDS = [
    { type: 'group', field: 'category', idField: 'category_option_id' },
    { type: 'subgroup', field: 'subcategory', idField: 'subcategory_option_id' },
    { type: 'brand', field: 'brand', idField: 'brand_option_id' },
    { type: 'size', field: 'size', idField: 'size_option_id' },
    { type: 'color', field: 'color', idField: 'color_option_id' },
];

const lower = codeKey;

/**
 * Products from a spreadsheet, with the rules of the manual form (inventory.service
 * createProduct): the sale price is typed VAT-included and stored net, opening stock needs a
 * cost and enters with its ledger entry (ADR-017/018), each size or color is its own product
 * grouped in a family. A product that already exists (same SKU) is skipped, or updated with the
 * non-empty cells when asked: its stock never changes here (that is a count or an adjustment).
 */
export class ProductImportService {
    constructor({ db = pool } = {}) {
        this.db = db;
    }

    async preview(rows, { updateExisting = false, canEditCost = false } = {}) {
        const analysis = await this._analyze(this.db, rows, { updateExisting, canEditCost });
        return this._response(analysis);
    }

    // One batch of rows in one transaction: validated again (the preview is never trusted), saved,
    // and the opening stock of the batch posted in one entry.
    async commit(rows, { updateExisting = false, canEditCost = false, batchId }, userId = null) {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            const analysis = await this._analyze(connection, rows, { updateExisting, canEditCost, lock: true });
            const context = { options: new Map(), stock: [] };
            for (const item of analysis) {
                if (item.action === 'create') await this._create(connection, item, context, userId, batchId);
                else if (item.action === 'update') await this._update(connection, item, context, userId, batchId);
            }
            await this._postOpeningStock(connection, context.stock, batchId);
            const summary = summarize(analysis);
            await auditService.log({
                user_id: userId,
                action: 'IMPORT_PRODUCTS',
                entity_type: 'import',
                entity_id: batchId,
                new_values: { summary, opening_stock_products: context.stock.length },
            }, connection);
            await connection.commit();
            return this._response(analysis);
        } catch (error) {
            await connection.rollback();
            if (error?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, {
                    error: 'import_conflict',
                    message: 'Otro usuario cargó alguno de estos productos al mismo tiempo. Volvé a revisar el archivo e importalo de nuevo: lo ya cargado se saltea.',
                });
            }
            // Another import or sale working on the same rows: the batch was rolled back whole
            // and can be sent again (the screen retries it).
            if (error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando estos productos. Reintentá en unos segundos.' });
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    _parse(raw) {
        const issues = new RowIssues();
        const product = {
            row: raw.row,
            sku: issues.text(raw.sku, HEADER.sku, 100),
            name: issues.text(raw.name, HEADER.name, 255),
            barcode: issues.text(raw.barcode, HEADER.barcode, 100),
            family: issues.text(raw.family, HEADER.family, 255),
            category: issues.text(raw.category, HEADER.category, 100),
            subcategory: issues.text(raw.subcategory, HEADER.subcategory, 100),
            brand: issues.text(raw.brand, HEADER.brand, 100),
            size: issues.text(raw.size, HEADER.size, 50),
            color: issues.text(raw.color, HEADER.color, 50),
            vat_rate: this._vatRate(raw.vat_rate, issues),
            // Cents, as purchase_price and the movement store it: the entry is posted from the same value.
            cost: issues.decimal(raw.cost, HEADER.cost, { max: 1e11, decimals: 2 }),
            sale_price: issues.decimal(raw.sale_price, HEADER.sale_price, { max: 1e10, decimals: 2 }),
            stock: issues.decimal(raw.stock, HEADER.stock, { integer: true, max: 1e9 }),
            location: issues.text(raw.location, HEADER.location, 100),
            stock_min: issues.decimal(raw.stock_min, HEADER.stock_min, { integer: true, max: 1e9 }),
            supplier: issues.text(raw.supplier, HEADER.supplier, 255),
            description: issues.text(raw.description, HEADER.description, 2000),
        };
        if (!product.sku) issues.error(`Falta el ${HEADER.sku}.`);
        if (product.subcategory && !product.category) issues.error('La subcategoría necesita la categoría.');
        return { product, issues };
    }

    // "21", "10,5" or a percentage cell of Excel (0,21).
    _vatRate(value, issues) {
        const rate = issues.decimal(value, HEADER.vat_rate);
        if (rate == null) return null;
        const percent = rate > 0 && rate < 1 ? Math.round(rate * 1000) / 10 : rate;
        if (!VAT_RATES.includes(percent)) {
            issues.error(`${HEADER.vat_rate}: ${String(rate).replace('.', ',')} no es una alícuota válida (0, 2,5, 5, 10,5, 21 o 27).`);
            return null;
        }
        return percent;
    }

    async _analyze(db, rows, { updateExisting, canEditCost = false, lock = false }) {
        const parsed = rows.map((raw) => this._parse(raw));
        const firstSku = new Map();
        const firstBarcode = new Map();
        for (const { product, issues } of parsed) {
            if (product.sku) {
                const key = lower(product.sku);
                if (firstSku.has(key)) issues.error(`${HEADER.sku} repetido en el archivo (ya está en la fila ${firstSku.get(key)}).`);
                else firstSku.set(key, product.row);
            }
            if (product.barcode) {
                if (firstBarcode.has(product.barcode)) issues.error(`${HEADER.barcode} repetido en el archivo (ya está en la fila ${firstBarcode.get(product.barcode)}).`);
                else firstBarcode.set(product.barcode, product.row);
            }
        }

        const skus = parsed.map(({ product }) => product.sku).filter(Boolean);
        const barcodes = parsed.map(({ product }) => product.barcode).filter(Boolean);
        const locations = parsed.map(({ product }) => product.location).filter(Boolean);
        let [existingRows] = skus.length > 0
            ? await db.query('SELECT * FROM products WHERE sku IN (?)', [skus])
            : [[]];
        // Locked only when they may be updated (skipped rows block nobody): their stock first and
        // then the products, the order of a sale (L3 then L4), since a new cost revalues that stock
        // (ADR-027). Read again from the locked (current) data, not the transaction's snapshot.
        let lockedStock = new Map();
        if (lock && updateExisting && existingRows.length > 0) {
            const ids = existingRows.map((row) => row.id);
            lockedStock = await inventoryValuation.lockStock(db, ids);
            [existingRows] = await db.query('SELECT * FROM products WHERE id IN (?) ORDER BY id FOR UPDATE', [ids]);
        }
        const existingBySku = new Map(existingRows.map((row) => [lower(row.sku), row]));
        const [barcodeRows] = barcodes.length > 0
            ? await db.query('SELECT id, sku, barcode FROM products WHERE barcode IN (?) AND deleted_at IS NULL', [barcodes])
            : [[]];
        const barcodeOwner = new Map(barcodeRows.map((row) => [row.barcode, row]));
        const [locationRows] = locations.length > 0
            ? await db.query('SELECT code FROM warehouse_locations WHERE active = TRUE AND code IN (?)', [locations])
            : [[]];
        const locationByName = new Map(locationRows.map((row) => [lower(row.code), row.code]));
        locationByName.set(lower(DEFAULT_LOCATION), DEFAULT_LOCATION);
        const suppliers = parsed.some(({ product }) => product.supplier) ? await this._suppliers(db) : null;
        // Valued stock of the products that may be updated: a new cost on goods in stock is warned
        // about. Saving uses the rows locked above.
        const updatable = updateExisting ? existingRows.filter((row) => !row.deleted_at).map((row) => row.id) : [];
        const [stockRows] = updatable.length > 0 && !lock
            ? await db.query(
                'SELECT product_id, location, quantity FROM inventory WHERE product_id IN (?)',
                [updatable]
            )
            : [[]];
        const stockByProduct = lock ? lockedStock : new Map();
        if (!lock) {
            for (const row of stockRows) {
                if (!stockByProduct.has(row.product_id)) stockByProduct.set(row.product_id, []);
                stockByProduct.get(row.product_id).push(row);
            }
        }
        const nonSellable = new Set(NON_SELLABLE_LOCATIONS.map(lower));

        return parsed.map(({ product, issues }) => {
            const existing = product.sku ? existingBySku.get(lower(product.sku)) : null;
            const item = { row: product.row, key: product.sku || '', product, existing: existing || null, issues };

            if (existing?.deleted_at) {
                issues.error(`Ese ${HEADER.sku} es de un producto dado de baja: usá otro ${HEADER.sku}.`);
            } else if (existing && !updateExisting) {
                // Skipped: the rest of the row does not matter.
                return this._finish(item, 'skip', [`Ya existe: se saltea. Marcá "Actualizar los que ya existen" para cambiar sus datos.`]);
            }

            if (product.barcode) {
                const owner = barcodeOwner.get(product.barcode);
                if (owner && lower(owner.sku) !== lower(product.sku || '')) {
                    issues.error(`${HEADER.barcode}: ya lo tiene el producto ${owner.sku}.`);
                }
            }
            if (product.location) {
                const code = locationByName.get(lower(product.location));
                if (code) product.location = code;
                else issues.error(`${HEADER.location}: "${product.location}" no existe. Cargala en Inventario o dejá la celda vacía.`);
            }
            if (product.supplier && suppliers) {
                item.supplierId = this._findSupplier(suppliers, product.supplier);
                if (!item.supplierId) issues.warn(`${HEADER.supplier}: "${product.supplier}" no está cargado; el producto queda sin proveedor.`);
            }

            if (!existing) {
                if (!product.name) issues.error(`Falta el ${HEADER.name}.`);
                if (product.sale_price == null) issues.error(`Falta el ${HEADER.sale_price}.`);
                else if (product.sale_price === 0) issues.warn('El precio de venta es 0.');
                // ADR-018: opening stock is valued at cost.
                if (product.stock > 0 && !(product.cost > 0)) {
                    issues.error(`Para cargar ${HEADER.stock} indicá el ${HEADER.cost}.`);
                }
                // Opening stock is goods to sell: never in quarantine, waste or returns to suppliers.
                if (product.stock > 0 && product.location && nonSellable.has(lower(product.location))) {
                    issues.error(`${HEADER.stock}: no se puede cargar en "${product.location}" (no es una ubicación de venta).`);
                }
            } else {
                if (product.stock != null) {
                    issues.warn(`El stock de un producto existente no cambia con la importación: se ajusta con un conteo.`);
                }
                item.stockRows = stockByProduct.get(existing.id) || [];
                const oldCost = effectiveCost(existing);
                if (product.cost != null && oldCost !== product.cost) {
                    if (!canEditCost) {
                        issues.error(`${HEADER.cost}: cambiar el costo de un producto existente lo puede hacer un gerente o un administrador (revalúa el stock). Dejá la celda vacía para no cambiarlo.`);
                    } else {
                        this._warnCostChange(issues, existing, item.stockRows, oldCost, product);
                    }
                }
            }

            // What was read, so a price a thousand times off is seen before saving.
            item.values = { sale_price: product.sale_price, cost: product.cost, stock: product.stock };
            if (issues.errors.length > 0) return this._finish(item, 'error');
            return this._finish(item, existing ? 'update' : 'create');
        });
    }

    // ADR-027: what a new cost does, before saving it: the revaluation of the stock (from cost 0,
    // an opening adjustment, D6) and the sale price that follows the cost (D1).
    _warnCostChange(issues, existing, stockRows, oldCost, product) {
        const quantity = inventoryValuation.valuedQuantity(stockRows);
        if (quantity > 0) {
            const amount = (valueCents(quantity, product.cost) - valueCents(quantity, oldCost)) / 100;
            issues.warn(oldCost > 0
                ? `El costo cambia y hay ${quantity} unidades en stock: se registra un asiento de revaluación (${amount >= 0 ? 'ganancia' : 'pérdida'} por tenencia de ${pesos(Math.abs(amount))}).`
                : `El producto no tenía costo y hay ${quantity} unidades en stock: se registran por ${pesos(amount)} como ajuste de inventario inicial.`);
        }
        if (Number(existing.auto_update_price ?? 1) === 1 && this._typedSalePrice(existing, product) === undefined) {
            const repriced = repricedSalePrice({ salePrice: existing.sale_price, vatRate: existing.vat_rate, oldCost, newCost: product.cost });
            if (repriced != null) {
                issues.warn(`El precio de venta acompaña al costo: pasa a ${pesos(lineAmounts(1, repriced, existing.vat_rate).gross)} final (mantiene el margen).`);
            }
        }
    }

    // The net sale price a row sets, as the form does (ADR-015): the final price is what the person
    // sees. A final price equal to the current one keeps the stored net (no rounding drift), and a
    // new VAT rate without a price keeps the final price. Undefined when the row changes nothing.
    _typedSalePrice(existing, product) {
        const oldRate = Number(existing.vat_rate ?? DEFAULT_VAT_RATE);
        const newRate = product.vat_rate ?? oldRate;
        const currentFinal = lineAmounts(1, existing.sale_price, oldRate).gross;
        const typedFinal = product.sale_price ?? currentFinal;
        if (typedFinal === lineAmounts(1, existing.sale_price, newRate).gross) return undefined;
        return netFromGross(typedFinal, newRate);
    }

    _finish(item, action, extraWarnings = []) {
        item.action = action;
        item.errors = action === 'skip' ? [] : item.issues.errors;
        item.warnings = [...extraWarnings, ...(action === 'skip' ? [] : item.issues.warnings)];
        return item;
    }

    async _suppliers(db) {
        const [rows] = await db.query('SELECT id, name, tax_id FROM suppliers WHERE deleted_at IS NULL');
        const byTaxId = new Map();
        const byName = new Map();
        for (const row of rows) {
            const key = taxIdKey(row.tax_id);
            if (key) byTaxId.set(key, row.id);
            byName.set(plainText(row.name), row.id);
        }
        return { byTaxId, byName };
    }

    // By CUIT (with or without dashes) when the cell looks like one, otherwise by exact name.
    _findSupplier(suppliers, value) {
        const key = taxIdKey(value);
        if (/^\d{7,}$/.test(key) && suppliers.byTaxId.has(key)) return suppliers.byTaxId.get(key);
        return suppliers.byName.get(plainText(value)) || null;
    }

    // The catalog value with that name, created when missing (same key as the catalog screen,
    // so it is found again and never duplicated).
    async _catalogOption(connection, context, type, rawName, parentId, userId) {
        const name = normalizeCatalogOptionName(rawName);
        if (!name) return null;
        const optionKey = catalogOptionKey(type, name, parentId);
        if (context.options.has(optionKey)) return context.options.get(optionKey);
        const id = crypto.randomUUID();
        // ON DUPLICATE KEY (not IGNORE): only "already exists" is tolerated, any other error stops.
        const [inserted] = await connection.query(
            `INSERT INTO product_catalog_options
                (id, option_key, type, name, normalized_name, parent_id, active, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, 0, ?)
             ON DUPLICATE KEY UPDATE id = id`,
            [id, optionKey, type, name, name.toLocaleLowerCase('es-AR'), parentId, userId || null]
        );
        if (Number(inserted?.affectedRows) === 1) {
            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_PRODUCT_CATALOG_OPTION',
                entity_type: 'product_catalog_option',
                entity_id: id,
                new_values: { type, name, parent_id: parentId, source: 'import' },
            }, connection);
        }
        // A locking read: it sees a value another import committed after this transaction began.
        const [[option]] = await connection.query(
            'SELECT id, name, active FROM product_catalog_options WHERE option_key = ? FOR SHARE',
            [optionKey]
        );
        context.options.set(optionKey, option);
        return option;
    }

    // Catalog ids and names for the catalog cells a row brings (null = the row does not set it).
    async _catalogValues(connection, context, product, userId, item) {
        const values = {};
        for (const { type, field, idField } of CATALOG_FIELDS) {
            if (!product[field]) continue;
            const parentId = type === 'subgroup' ? values.category_option_id : null;
            const option = await this._catalogOption(connection, context, type, product[field], parentId, userId);
            values[idField] = option.id;
            values[field] = option.name;
            if (option.active === 0 || option.active === false) {
                item?.warnings.push(`${HEADER[field]} "${option.name}" está desactivada en el catálogo: se usa igual.`);
            }
        }
        return values;
    }

    async _create(connection, item, context, userId, batchId) {
        const { product } = item;
        const vatRate = product.vat_rate ?? DEFAULT_VAT_RATE;
        const catalog = await this._catalogValues(connection, context, product, userId, item);
        const familyId = await inventoryService.resolveProductFamily(product.family, {
            name: product.name, size: catalog.size, color: catalog.color, brand: catalog.brand, category: catalog.category,
        }, connection);
        const id = crypto.randomUUID();
        const data = {
            id,
            sku: product.sku,
            barcode: product.barcode,
            name: product.name,
            description: product.description,
            category: catalog.category ?? null,
            subcategory: catalog.subcategory ?? null,
            category_option_id: catalog.category_option_id ?? null,
            subcategory_option_id: catalog.subcategory_option_id ?? null,
            brand_option_id: catalog.brand_option_id ?? null,
            size_option_id: catalog.size_option_id ?? null,
            color_option_id: catalog.color_option_id ?? null,
            family_id: familyId,
            brand: catalog.brand ?? null,
            size: catalog.size ?? null,
            color: catalog.color ?? null,
            location: product.location,
            purchase_price: product.cost ?? 0,
            // One cost (ADR-027): cost_price mirrors it.
            cost_price: product.cost ?? 0,
            sale_price: netFromGross(product.sale_price, vatRate),
            vat_rate: vatRate,
            stock_min: product.stock_min ?? 0,
            supplier_id: item.supplierId || null,
            origin: 'erp',
        };
        const columns = Object.keys(data);
        await connection.query(
            `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            columns.map((column) => data[column])
        );

        const stock = product.stock || 0;
        if (stock > 0) {
            const location = product.location || DEFAULT_LOCATION;
            await connection.query(
                `INSERT INTO inventory (id, product_id, location, quantity)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                [crypto.randomUUID(), id, location, stock]
            );
            const movementId = crypto.randomUUID();
            await connection.query(
                `INSERT INTO inventory_movements (
                    id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                ) VALUES (?, 'initial_stock', ?, ?, ?, ?, 'Stock inicial importado', 'product', ?, ?)`,
                [movementId, id, location, stock, product.cost, id, userId || null]
            );
            context.stock.push({ value: lineAmounts(stock, product.cost, 0).net, movementId });
        }

        await auditService.log({
            user_id: userId,
            action: 'CREATE_PRODUCT',
            entity_type: 'product',
            entity_id: id,
            new_values: { ...data, stock_initial: stock, source: 'import', batch_id: batchId },
        }, connection);
    }

    async _update(connection, item, context, userId, batchId) {
        const { product, existing } = item;
        const changes = {};
        // Only cells with a value change something, and only when it differs (5000 = "5000.00").
        const set = (column, value) => {
            if (value == null) return;
            const same = typeof value === 'number'
                ? Number(existing[column] ?? NaN) === value
                : String(value) === String(existing[column] ?? '');
            if (!same) changes[column] = value;
        };
        set('name', product.name);
        set('barcode', product.barcode);
        set('description', product.description);
        set('stock_min', product.stock_min);
        set('location', product.location);
        set('supplier_id', item.supplierId);
        // ADR-027: a new cost is saved with the revaluation of the stock, after the other changes.
        const newCost = product.cost != null && product.cost !== effectiveCost(existing) ? product.cost : null;

        const catalog = await this._catalogValues(connection, context, product, userId, item);
        for (const [column, value] of Object.entries(catalog)) set(column, value);
        // A new category without a subcategory leaves none: the old one belonged to the old category.
        const categoryChanged = catalog.category && lower(catalog.category) !== lower(existing.category || '');
        if (categoryChanged && !product.subcategory && (existing.subcategory_option_id || existing.subcategory)) {
            changes.subcategory_option_id = null;
            changes.subcategory = null;
        }
        if (product.family || catalog.size || catalog.color) {
            const familyId = await inventoryService.resolveProductFamily(product.family, {
                name: product.name || existing.name,
                size: catalog.size ?? existing.size,
                color: catalog.color ?? existing.color,
                brand: catalog.brand ?? existing.brand,
                category: catalog.category ?? existing.category,
            }, connection);
            set('family_id', familyId);
        }

        set('sale_price', this._typedSalePrice(existing, product));
        const oldRate = Number(existing.vat_rate ?? DEFAULT_VAT_RATE);
        const newRate = product.vat_rate ?? oldRate;
        if (newRate !== oldRate) changes.vat_rate = newRate;

        if (Object.keys(changes).length === 0 && newCost == null) {
            item.warnings.push('No había nada distinto para actualizar.');
            return;
        }
        const columns = Object.keys(changes);
        if (columns.length > 0) {
            await connection.query(
                `UPDATE products SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
                [...columns.map((column) => changes[column]), existing.id]
            );
        }
        // A price typed in the row wins; otherwise it follows the cost if the product says so (D1).
        const costChange = newCost == null ? null : await inventoryService.changeProductCost(connection, {
            product: { ...existing, ...changes, sale_price: existing.sale_price },
            stockRows: item.stockRows || [],
            newCost,
            salePrice: changes.sale_price,
            userId,
            source: 'import',
            details: { batch_id: batchId },
        });
        const changed = { ...changes };
        if (costChange) {
            changed.purchase_price = costChange.cost;
            if (costChange.salePrice != null) changed.sale_price = costChange.salePrice;
        }
        await auditService.log({
            user_id: userId,
            action: 'UPDATE_PRODUCT',
            entity_type: 'product',
            entity_id: existing.id,
            old_values: Object.fromEntries(Object.keys(changed).map((column) => [column, existing[column] ?? null])),
            new_values: { ...changed, source: 'import', batch_id: batchId },
        }, connection);
    }

    // The opening stock of the batch in one entry: goods the business already had enter
    // inventory at cost against the adjustment account (ADR-017/018), as each manual creation does.
    async _postOpeningStock(connection, stock, batchId) {
        const total = stock.reduce((sum, line) => sum + line.value, 0);
        const amount = Math.round(total * 100) / 100;
        if (!(amount > 0)) return;
        const entryId = await accountingService.createJournalEntry(connection, {
            date: new Date(),
            description: `Stock inicial importado: ${stock.length} producto${stock.length === 1 ? '' : 's'} (importación ${String(batchId).slice(0, 8)})`,
            reference_type: 'product_import',
            reference_id: batchId,
            lines: [
                { account_code: '1.1.04.01', debit: amount, credit: 0, notes: 'Mercadería existente al alta' },
                { account_code: '3.1.03.01', debit: 0, credit: amount, notes: 'Ajuste por inventario inicial' },
            ],
        });
        // The movements keep the entry that valued them (ADR-027).
        await inventoryValuation.linkMovements(connection, stock.map((line) => line.movementId), entryId);
    }

    _response(analysis) {
        return {
            summary: summarize(analysis),
            rows: analysis.map(({ row, action, key, errors, warnings, values }) => ({
                row, action, key, errors, warnings, ...(values && action !== 'skip' ? { values } : {}),
            })),
        };
    }
}

export default new ProductImportService();
