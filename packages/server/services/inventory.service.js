import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { businessError } from '../utils/businessError.js';
import { normalizeProductImageUrl } from '../utils/imagePolicy.js';
import goodsReceptionService from '../domains/procurement/GoodsReceptionService.js';
import { NON_SELLABLE_LOCATIONS } from '../domains/inventory/StockLedger.js';
import accountingService from './accounting.service.js';
import inventoryValuation, {
    effectiveCost, isValuedLocation, repricedSalePrice, roundCost, valueCents,
} from '../domains/inventory/InventoryValuation.js';
import { hasPermission, PERMISSIONS } from '@wsm/common';

class InventoryService extends BaseService {
    constructor() {
        super('products');
    }

    normalizeBarcode(value) {
        if (typeof value !== 'string') return null;
        const sanitized = value.trim();
        return sanitized.length > 0 ? sanitized : null;
    }

    normalizeLocation(value) {
        if (typeof value !== 'string') return null;
        const sanitized = value.trim();
        return sanitized.length > 0 ? sanitized : null;
    }

    normalizeFamilyValue(value) {
        if (typeof value !== 'string') return null;
        const sanitized = value.trim().replace(/\s+/g, ' ');
        return sanitized.length > 0 ? sanitized : null;
    }

    async applyProductCatalogOptions(productData, previous = {}, connection = pool) {
        const definitions = [
            ['category_option_id', 'group', 'category'],
            ['subcategory_option_id', 'subgroup', 'subcategory'],
            ['brand_option_id', 'brand', 'brand'],
            ['size_option_id', 'size', 'size'],
            ['color_option_id', 'color', 'color']
        ];
        const requested = definitions.filter(([idField]) => Object.prototype.hasOwnProperty.call(productData, idField));
        if (requested.length === 0) return productData;

        const ids = requested.map(([idField]) => productData[idField]).filter(Boolean);
        const [rows] = ids.length > 0
            ? await connection.query('SELECT id, type, name, parent_id FROM product_catalog_options WHERE id IN (?)', [ids])
            : [[]];
        const optionsById = new Map(rows.map((row) => [row.id, row]));

        for (const [idField, expectedType, textField] of requested) {
            const optionId = productData[idField] || null;
            if (!optionId) {
                productData[idField] = null;
                productData[textField] = null;
                continue;
            }
            const option = optionsById.get(optionId);
            if (!option || option.type !== expectedType) {
                const error = new Error(`El valor seleccionado para ${textField} no es válido.`);
                error.statusCode = 400;
                throw error;
            }
            productData[textField] = option.name;
        }

        const subgroupId = productData.subcategory_option_id ?? previous.subcategory_option_id ?? null;
        if (subgroupId) {
            let subgroup = optionsById.get(subgroupId);
            if (!subgroup) {
                const [subgroupRows] = await connection.query(
                    "SELECT id, type, name, parent_id FROM product_catalog_options WHERE id = ? AND type = 'subgroup' LIMIT 1",
                    [subgroupId]
                );
                subgroup = subgroupRows[0];
            }
            const groupId = productData.category_option_id ?? previous.category_option_id ?? null;
            if (!subgroup || subgroup.parent_id !== groupId) {
                const error = new Error('El subgrupo seleccionado no pertenece al grupo indicado.');
                error.statusCode = 400;
                throw error;
            }
        }
        return productData;
    }

    async resolveProductFamily(rawFamilyName, productData = {}, connection = pool) {
        const size = this.normalizeFamilyValue(productData.size);
        const color = this.normalizeFamilyValue(productData.color);
        const explicitFamilyName = this.normalizeFamilyValue(rawFamilyName);
        const familyName = explicitFamilyName || ((size || color) ? this.normalizeFamilyValue(productData.name) : null);
        if (!familyName) return null;

        const brand = this.normalizeFamilyValue(productData.brand);
        const category = this.normalizeFamilyValue(productData.category);
        const imageUrl = normalizeProductImageUrl(productData.image_url);

        const [existingRows] = await connection.query(`
            SELECT id
            FROM product_families
            WHERE deleted_at IS NULL
              AND LOWER(TRIM(name)) = LOWER(?)
              AND LOWER(TRIM(COALESCE(brand, ''))) = LOWER(?)
              AND LOWER(TRIM(COALESCE(category, ''))) = LOWER(?)
            LIMIT 1
        `, [familyName, brand || '', category || '']);

        if (existingRows[0]?.id) {
            if (imageUrl) {
                await connection.query(
                    'UPDATE product_families SET image_url = COALESCE(image_url, ?) WHERE id = ?',
                    [imageUrl, existingRows[0].id]
                );
            }
            return existingRows[0].id;
        }

        const familyKey = crypto
            .createHash('sha256')
            .update(`manual|${familyName.toLowerCase()}|${(brand || '').toLowerCase()}|${(category || '').toLowerCase()}`)
            .digest('hex');
        const familyId = crypto.randomUUID();

        await connection.query(`
            INSERT INTO product_families (id, family_key, name, brand, category, image_url)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                brand = VALUES(brand),
                category = VALUES(category),
                image_url = COALESCE(product_families.image_url, VALUES(image_url))
        `, [familyId, familyKey, familyName, brand, category, imageUrl]);

        // A locking read: inside a transaction it sees the family another request committed
        // meanwhile (a plain read could miss it and return an id that was never inserted).
        const [resolvedRows] = await connection.query(
            'SELECT id FROM product_families WHERE family_key = ? AND deleted_at IS NULL LIMIT 1 FOR SHARE',
            [familyKey]
        );
        return resolvedRows[0]?.id || familyId;
    }

    async ensureUniqueBarcode(rawBarcode, excludeId = null, connection = pool) {
        const barcode = this.normalizeBarcode(rawBarcode);
        if (!barcode) return null;

        let query = 'SELECT id FROM products WHERE barcode = ? AND deleted_at IS NULL';
        const params = [barcode];
        if (excludeId) {
            query += ' AND id <> ?';
            params.push(excludeId);
        }
        query += ' LIMIT 1';

        const [rows] = await connection.query(query, params);
        if (rows.length > 0) {
            const err = new Error('El codigo de barras ya existe en otro producto.');
            err.statusCode = 409;
            err.status = 'fail';
            err.errorCode = 'DUPLICATE_BARCODE';
            throw err;
        }

        return barcode;
    }

    async getProductsWithInventoryStock(filters = {}, options = {}) {
        let query = `
            SELECT
                p.*,
                family.name AS family_name,
                family.image_url AS family_image_url,
                COALESCE(inv.total_quantity - inv.total_reserved, 0) AS inventory_stock_current
            FROM products p
            LEFT JOIN product_families family ON family.id = p.family_id AND family.deleted_at IS NULL
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS total_quantity, SUM(reserved_quantity) AS total_reserved
                FROM inventory
                WHERE location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
                GROUP BY product_id
            ) inv ON inv.product_id = p.id
            WHERE p.deleted_at IS NULL
        `;
        const params = [];

        if (filters.supplier_id) {
            query += ' AND p.supplier_id = ?';
            params.push(filters.supplier_id);
        }

        let total = null;
        if (options.includeTotal) {
            let countQuery = 'SELECT COUNT(*) AS total FROM products p WHERE p.deleted_at IS NULL';
            const countParams = [];
            if (filters.supplier_id) {
                countQuery += ' AND p.supplier_id = ?';
                countParams.push(filters.supplier_id);
            }
            const [countRows] = await pool.query(countQuery, countParams);
            total = Number(countRows[0]?.total || 0);
        }

        query += ' ORDER BY p.created_at DESC';
        if (options.limit != null) {
            query += ' LIMIT ?';
            params.push(Number(options.limit));
            if (options.offset != null) {
                query += ' OFFSET ?';
                params.push(Number(options.offset));
            }
        }

        const [rows] = await pool.query(query, params);
        const mappedRows = rows.map((row) => {
            const { inventory_stock_current, ...product } = row;
            return {
                ...product,
                stock_current: Number(inventory_stock_current || 0)
            };
        });

        if (options.includeTotal) {
            return { rows: mappedRows, total: total ?? mappedRows.length };
        }

        return mappedRows;
    }

    async getInventoryWithDetails() {
        const [rows] = await pool.query(`
            SELECT i.*, p.name AS product_name, p.sku, p.category
            FROM inventory i
            LEFT JOIN products p ON i.product_id = p.id
            ORDER BY p.name ASC, i.location ASC
        `);
        return rows;
    }

    async getProductStock(productId) {
        const [rows] = await pool.query(`
            SELECT SUM(quantity) AS total_stock
            FROM inventory
            WHERE product_id = ? AND location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
        `, [productId]);
        return Number(rows[0]?.total_stock || 0);
    }

    async createProduct(productData, userId) {
        const id = crypto.randomUUID();
        const normalized = { ...productData };
        const rawStockInitial = Number(normalized.stock_initial ?? 0);
        const stockInitial = Number.isFinite(rawStockInitial) ? Math.max(0, Math.floor(rawStockInitial)) : 0;
        delete normalized.stock_initial;

        // ADR-018: opening stock is valued at cost (inventory and ledger move together): without a
        // cost it would enter stock without its entry and later sales would credit inventory
        // that was never debited.
        const openingCost = Number(normalized.purchase_price ?? normalized.cost_price ?? 0);
        if (stockInitial > 0 && !(openingCost > 0)) {
            throw businessError(400, {
                error: 'initial_stock_requires_cost',
                message: 'Para cargar stock inicial indicá el precio de compra (costo) del producto.'
            });
        }

        if (normalized.cost_price != null && normalized.purchase_price == null) {
            normalized.purchase_price = normalized.cost_price;
        }
        delete normalized.cost_price;
        // Cents, as the column stores it: the opening-stock entry is posted from the same value
        // the product and the movement keep (a 3-decimal cost left the ledger a cent off).
        if (normalized.purchase_price != null) {
            normalized.purchase_price = Math.round((Number(normalized.purchase_price) + Number.EPSILON) * 100) / 100;
        }
        for (const flag of ['auto_update_cost', 'auto_update_price']) {
            if (Object.prototype.hasOwnProperty.call(normalized, flag)) normalized[flag] = normalized[flag] ? 1 : 0;
        }
        normalized.barcode = await this.ensureUniqueBarcode(normalized.barcode);
        normalized.location = this.normalizeLocation(normalized.location);
        // Opening stock is goods to sell, as in the import: never in quarantine, waste or returns to
        // suppliers (in Mermas it would be valued in the ledger and not in the stock, ADR-027).
        if (stockInitial > 0 && NON_SELLABLE_LOCATIONS.includes(normalized.location)) {
            throw businessError(400, {
                error: 'initial_stock_location',
                message: `El stock inicial no se puede cargar en "${normalized.location}": no es una ubicación de venta.`
            });
        }
        normalized.image_url = normalizeProductImageUrl(normalized.image_url);
        await this.applyProductCatalogOptions(normalized);
        const familyName = normalized.family_name;
        delete normalized.family_name;
        normalized.family_id = await this.resolveProductFamily(familyName, normalized);

        // ADR-017: where the product was created (the ERP), so price fixes never have to guess.
        const data = { id, ...normalized, origin: 'erp' };
        const result = await this.create(data);

        if (stockInitial > 0) {
            const initialLocation = normalized.location || 'General';
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                await connection.query(
                    `INSERT INTO inventory (id, product_id, location, quantity)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                    [crypto.randomUUID(), id, initialLocation, stockInitial]
                );
                const movementId = crypto.randomUUID();
                await connection.query(
                    `INSERT INTO inventory_movements (
                        id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                    ) VALUES (?, 'initial_stock', ?, ?, ?, ?, ?, 'product', ?, ?)`,
                    [
                        movementId,
                        id,
                        initialLocation,
                        stockInitial,
                        Number(normalized.purchase_price || 0),
                        'Stock inicial al crear el producto',
                        id,
                        userId || null
                    ]
                );
                // Every stock movement leaves its entry (ADR-013): the opening stock is valued at cost.
                const entryId = await accountingService.postInitialStock(connection, {
                    productId: id,
                    quantity: stockInitial,
                    unitCost: Number(normalized.purchase_price || 0),
                    description: `Stock inicial de ${normalized.name || normalized.sku || 'producto'}`,
                });
                await inventoryValuation.linkMovements(connection, [movementId], entryId);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        }

        await auditService.log({
            user_id: userId,
            action: 'CREATE_PRODUCT',
            entity_type: 'product',
            entity_id: id,
            new_values: { ...data, stock_initial: stockInitial }
        });

        return result;
    }

    /**
     * ADR-027 (usuario, 2026-10-17): the stock is valued at the product's cost and sales post their
     * cost of goods sold with it. A new cost changes the product and revalues the units in stock
     * in the same transaction; with auto_update_price on and no price typed, the sale price follows
     * the cost keeping the markup (D1). The caller holds the product's stock rows (L3, `stockRows`)
     * and the product FOR UPDATE (L4), and passes it as `product`. Returns what changed, or null.
     */
    async changeProductCost(connection, { product, stockRows, newCost, salePrice = undefined, userId = null, source, details = {} }) {
        if (newCost == null) return null;
        const oldCost = effectiveCost(product);
        const cost = roundCost(newCost);
        if (cost === oldCost) return null;
        const changes = { purchase_price: cost };
        // A price typed together with the cost wins; otherwise it follows the cost if the product says so.
        const priceTyped = salePrice !== undefined && salePrice !== null
            && Math.round(Number(salePrice) * 10000) !== Math.round(Number(product.sale_price || 0) * 10000);
        if (!priceTyped && Number(product.auto_update_price ?? 1) === 1) {
            const repriced = repricedSalePrice({ salePrice: product.sale_price, vatRate: product.vat_rate, oldCost, newCost: cost });
            if (repriced != null) changes.sale_price = repriced;
        }
        await connection.query(
            `UPDATE products SET ${Object.keys(changes).map((column) => `${this._validateColumn(column)} = ?`).join(', ')} WHERE id = ?`,
            [...Object.values(changes), product.id]
        );
        const revaluation = await inventoryValuation.revalue(connection, {
            product, rows: stockRows, newCost: cost, userId, source, details,
        });
        return { oldCost, cost, salePrice: changes.sale_price ?? null, revaluation };
    }

    /**
     * The manual product edit, in one transaction, so a new cost and its revaluation (ADR-027) are
     * saved together. The stock rows are locked before the product, in the same order as a sale
     * (L3 then L4). Changing the cost of an existing product takes a manager or an admin (D5).
     */
    async updateProduct(id, body, userId = null, ipAddress = null, actorRole = null) {
        const data = { ...body };
        const hasFamilyName = Object.prototype.hasOwnProperty.call(data, 'family_name');
        const familyName = data.family_name;
        delete data.family_name;
        if (data.cost_price != null && data.purchase_price == null) data.purchase_price = data.cost_price;
        delete data.cost_price;
        delete data.stock_initial;
        // Checked before touching the database (a data: URL is refused).
        if (Object.prototype.hasOwnProperty.call(data, 'image_url')) data.image_url = normalizeProductImageUrl(data.image_url);
        const newCost = data.purchase_price != null ? roundCost(data.purchase_price) : null;
        delete data.purchase_price;
        for (const flag of ['auto_update_cost', 'auto_update_price']) {
            if (Object.prototype.hasOwnProperty.call(data, flag)) data[flag] = data[flag] ? 1 : 0;
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const stockRows = newCost != null
                ? (await inventoryValuation.lockStock(connection, [id])).get(id)
                : [];
            const [rows] = await connection.query('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id]);
            const previous = rows[0];
            if (!previous) {
                await connection.rollback();
                return null;
            }
            // The form sends the cost it shows: the stored one is no change (a product whose cost
            // still lives in cost_price has purchase_price 0, and saving it must not zero the stock).
            const costChanges = newCost != null && newCost !== roundCost(previous.purchase_price)
                && newCost !== effectiveCost(previous);
            const costPolicyChanges = Object.prototype.hasOwnProperty.call(data, 'auto_update_cost')
                && data.auto_update_cost !== Number(previous.auto_update_cost ?? 1);
            if ((costChanges || costPolicyChanges) && !hasPermission(actorRole, PERMISSIONS.PRODUCTS_COST_EDIT)) {
                throw businessError(403, {
                    error: 'cost_edit_not_allowed',
                    message: 'Cambiar el costo de un producto (o si se actualiza solo) lo puede hacer un gerente o un administrador: revalúa el stock.'
                });
            }
            await this.applyProductCatalogOptions(data, previous, connection);
            if (Object.prototype.hasOwnProperty.call(data, 'barcode')) {
                data.barcode = await this.ensureUniqueBarcode(data.barcode, id, connection);
            }
            if (Object.prototype.hasOwnProperty.call(data, 'location')) data.location = this.normalizeLocation(data.location);
            if (hasFamilyName) data.family_id = await this.resolveProductFamily(familyName, { ...previous, ...data }, connection);

            const columns = Object.keys(data);
            if (columns.length > 0) {
                await connection.query(
                    `UPDATE products SET ${columns.map((column) => `${this._validateColumn(column)} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
                    [...columns.map((column) => data[column]), id]
                );
            }
            if (costChanges) {
                // The price policy just saved applies to this change too.
                const product = { ...previous, ...data, sale_price: previous.sale_price };
                await this.changeProductCost(connection, {
                    product, stockRows, newCost, salePrice: data.sale_price, userId, source: 'product_edit',
                });
            }
            const [[updated]] = await connection.query('SELECT * FROM products WHERE id = ?', [id]);
            await auditService.log({
                user_id: userId,
                action: 'UPDATE_PRODUCT',
                entity_type: 'product',
                entity_id: id,
                old_values: previous,
                new_values: updated,
                ip_address: ipAddress,
            }, connection);
            await connection.commit();
            return updated;
        } catch (error) {
            await connection.rollback();
            if (error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando este producto. Reintentá en unos segundos.' });
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    async getMovements(filters = {}, options = {}) {
        let query = `
            SELECT im.*, p.name AS product_name, p.sku
            FROM inventory_movements im
            LEFT JOIN products p ON im.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.product_id) {
            query += ' AND im.product_id = ?';
            params.push(filters.product_id);
        }
        if (filters.type) {
            query += ' AND im.type = ?';
            params.push(filters.type);
        }
        if (filters.start_date) {
            query += ' AND DATE(im.created_at) >= DATE(?)';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            query += ' AND DATE(im.created_at) <= DATE(?)';
            params.push(filters.end_date);
        }

        query += ' ORDER BY im.created_at DESC';

        if (options.limit) {
            query += ' LIMIT ?';
            params.push(Number(options.limit));
        }

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async recordMovement(movementData, userId) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO inventory_movements
            (id, type, product_id, from_location, to_location, quantity,
             unit_cost, reason, reference_type, reference_id, notes, performed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            movementData.type,
            movementData.product_id,
            movementData.from_location || null,
            movementData.to_location || null,
            movementData.quantity,
            movementData.unit_cost || 0,
            movementData.reason || null,
            movementData.reference_type || 'manual',
            movementData.reference_id || null,
            movementData.notes || null,
            movementData.performed_by || userId || null
        ]);

        await auditService.log({
            user_id: userId,
            action: 'INVENTORY_MOVEMENT',
            entity_type: 'inventory',
            entity_id: movementData.product_id,
            new_values: movementData
        });

        // Trigger Tienda Nube sync asynchronously
        // We do this without await so it doesn't block the database transaction
        setImmediate(async () => {
            try {
                // ADR-019: available stock (physical minus reserved), only when it changed.
                const tiendanubeService = (await import('./tiendanube.service.js')).default;
                await tiendanubeService.pushAvailableStock([movementData.product_id]);
            } catch (err) {
                console.error('[TiendaNube Sync] Error calculating stock for sync:', err);
            }
        });

        return { id, ...movementData };
    }

    async getProductMovements(productId) {
        return this.getMovements({ product_id: productId });
    }

    async getBatches({ product_id, status } = {}) {
        let query = `
            SELECT b.*, p.name AS product_name
            FROM product_batches b
            JOIN products p ON b.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (product_id) {
            query += ' AND b.product_id = ?';
            params.push(product_id);
        }
        if (status) {
            query += ' AND b.status = ?';
            params.push(status);
        }

        query += ' ORDER BY b.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createBatch(data) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO product_batches (
                id, product_id, batch_number, manufacturing_date, expiration_date,
                supplier_id, quantity_initial, quantity_current, location, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            data.product_id,
            data.batch_number,
            data.manufacturing_date || null,
            data.expiration_date || null,
            data.supplier_id || null,
            data.quantity_initial,
            data.quantity_initial,
            data.location || null,
            data.notes || null
        ]);

        return { id };
    }

    async updateBatch(id, data) {
        await pool.query(
            `UPDATE product_batches SET quantity_current = ?, status = COALESCE(?, status) WHERE id = ?`,
            [data.quantity_current, data.status || null, id]
        );
        const [rows] = await pool.query('SELECT * FROM product_batches WHERE id = ?', [id]);
        return rows[0] || null;
    }

    async getSerials({ product_id, status } = {}) {
        let query = `
            SELECT s.*, p.name AS product_name
            FROM serial_numbers s
            JOIN products p ON s.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (product_id) {
            query += ' AND s.product_id = ?';
            params.push(product_id);
        }
        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }

        query += ' ORDER BY s.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createSerialNumber(data) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO serial_numbers (
                id, product_id, serial_number, batch_id, location, status, warranty_expiration
            ) VALUES (?, ?, ?, ?, ?, 'available', ?)
        `, [
            id,
            data.product_id,
            data.serial_number,
            data.batch_id || null,
            data.location || null,
            data.warranty_months
                ? new Date(Date.now() + data.warranty_months * 30 * 24 * 60 * 60 * 1000)
                : null
        ]);
        return { id };
    }

    async updateSerialNumber(id, data) {
        const allowed = ['status', 'sold_to_client_id', 'sold_in_order_id', 'location'];
        const keys = Object.keys(data).filter((k) => allowed.includes(k));
        if (keys.length === 0) return null;

        const setClause = keys.map((k) => `${k} = ?`).join(', ');
        const values = keys.map((k) => data[k]);

        await pool.query(`UPDATE serial_numbers SET ${setClause} WHERE id = ?`, [...values, id]);
        const [rows] = await pool.query('SELECT * FROM serial_numbers WHERE id = ?', [id]);
        return rows[0] || null;
    }

    async processReceptionApproval(receptionId, options = {}) {
        return goodsReceptionService.processReceptionApproval(receptionId, options);
    }

    async transferStock(productId, fromLocation, toLocation, quantity, userId) {
        const qty = Number(quantity);
        if (!qty || qty <= 0) {
            throw businessError(400, { error: 'invalid_quantity', message: 'La cantidad a transferir debe ser mayor a cero.' });
        }

        const normalizedFrom = String(fromLocation || 'General').trim();
        const normalizedTo = String(toLocation || 'General').trim();

        if (normalizedFrom === normalizedTo) {
            throw businessError(400, { error: 'same_location', message: 'La ubicación de origen y destino no pueden ser iguales.' });
        }

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();
            // Every row of the product in one ordered statement (L3, ADR-027): origin and destination
            // together, the same order as a sale or a revaluation.
            const productRows = (await inventoryValuation.lockStock(connection, [productId])).get(productId) || [];
            const sourceRows = productRows.filter((row) => row.location === normalizedFrom);

            if (sourceRows.length === 0) {
                throw businessError(409, { error: 'insufficient_stock', message: `Stock insuficiente en ${normalizedFrom}. Requerido: ${qty}, Disponible: 0 (Físico: 0, Reservado: 0)` });
            }

            const physicalQty = sourceRows[0].quantity;
            const reservedQty = sourceRows[0].reserved_quantity || 0;
            const availableQty = physicalQty - reservedQty;

            if (availableQty < qty) {
                throw businessError(409, { error: 'insufficient_stock', message: `Stock disponible insuficiente en ${normalizedFrom}. Requerido: ${qty}, Disponible: ${availableQty} (Físico: ${physicalQty}, Reservado: ${reservedQty})` });
            }

            const sourceId = sourceRows[0].id;
            const remainingQty = sourceRows[0].quantity - qty;

            // Keep the row at quantity 0 instead of deleting it: order_item_allocations
            // references inventory rows with ON DELETE RESTRICT (migration 044), so
            // deleting a depleted row would break the FK for any prior allocation.
            await connection.query('UPDATE inventory SET quantity = ? WHERE id = ?', [remainingQty, sourceId]);

            const targetRows = productRows.filter((row) => row.location === normalizedTo);

            if (targetRows.length > 0) {
                await connection.query(
                    'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                    [qty, targetRows[0].id]
                );
            } else {
                await connection.query(
                    'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                    [crypto.randomUUID(), productId, normalizedTo, qty]
                );
            }

            // D3 (ADR-027): goods moved to Mermas are a loss now; brought back, the loss is
            // recovered at today's cost. Between valued locations nothing changes in value.
            const fromValued = isValuedLocation(normalizedFrom);
            const toValued = isValuedLocation(normalizedTo);
            const unitCost = fromValued !== toValued
                ? (await inventoryValuation.lockCosts(connection, [productId])).get(productId)?.cost || 0
                : 0;

            const movementId = crypto.randomUUID();
            await connection.query(`
                INSERT INTO inventory_movements (
                    id, type, product_id, from_location, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                ) VALUES (?, 'transfer', ?, ?, ?, ?, ?, 'Internal location transfer', 'transfer', ?, ?)
            `, [
                movementId,
                productId,
                normalizedFrom,
                normalizedTo,
                qty,
                unitCost,
                movementId,
                userId || null
            ]);
            if (fromValued !== toValued) {
                const value = valueCents(qty, unitCost) / 100;
                const toWaste = !toValued;
                const entryId = await accountingService.createJournalEntryIfAny(connection, {
                    date: new Date(),
                    description: toWaste
                        ? `Pase a ${normalizedTo}: ${qty} u. dadas por perdidas`
                        : `Recupero desde ${normalizedFrom}: ${qty} u. vuelven al stock valuado`,
                    reference_type: 'transfer',
                    reference_id: movementId,
                    lines: toWaste
                        ? [
                            { account_code: '5.1.02.02', debit: value, credit: 0, notes: 'Mercadería dada de baja (Mermas)' },
                            { account_code: '1.1.04.01', debit: 0, credit: value, notes: 'Salida del stock valuado' },
                        ]
                        : [
                            { account_code: '1.1.04.01', debit: value, credit: 0, notes: 'Mercadería recuperada' },
                            { account_code: '5.1.02.02', debit: 0, credit: value, notes: 'Recupero de mermas' },
                        ],
                });
                await inventoryValuation.linkMovements(connection, [movementId], entryId);
            }

            await auditService.log({
                user_id: userId || null,
                action: 'INVENTORY_LOCATION_TRANSFER',
                entity_type: 'inventory',
                entity_id: productId,
                new_values: {
                    product_id: productId,
                    from_location: normalizedFrom,
                    to_location: normalizedTo,
                    quantity: qty,
                    movement_id: movementId
                }
            }, connection);

            await connection.commit();
            return { success: true, movementId };
        } catch (error) {
            await connection.rollback();
            if (error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando este producto. Reintentá en unos segundos.' });
            }
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new InventoryService();
