import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { normalizeProductImageUrl } from '../utils/imagePolicy.js';
import accountingService from './accounting.service.js';
import goodsReceptionService from '../domains/procurement/GoodsReceptionService.js';

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

        const [resolvedRows] = await connection.query(
            'SELECT id FROM product_families WHERE family_key = ? AND deleted_at IS NULL LIMIT 1',
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

        if (normalized.cost_price != null && normalized.purchase_price == null) {
            normalized.purchase_price = normalized.cost_price;
        }
        delete normalized.cost_price;
        normalized.barcode = await this.ensureUniqueBarcode(normalized.barcode);
        normalized.location = this.normalizeLocation(normalized.location);
        normalized.image_url = normalizeProductImageUrl(normalized.image_url);
        const familyName = normalized.family_name;
        delete normalized.family_name;
        normalized.family_id = await this.resolveProductFamily(familyName, normalized);

        const data = { id, ...normalized };
        const result = await this.create(data);

        if (stockInitial > 0) {
            const initialLocation = normalized.location || 'General';
            await pool.query(
                `INSERT INTO inventory (id, product_id, location, quantity)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                [crypto.randomUUID(), id, initialLocation, stockInitial]
            );

            await pool.query(
                `INSERT INTO inventory_movements (
                    id, type, product_id, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                ) VALUES (?, 'initial_stock', ?, ?, ?, ?, ?, 'product', ?, ?)`,
                [
                    crypto.randomUUID(),
                    id,
                    initialLocation,
                    stockInitial,
                    Number(normalized.purchase_price || 0),
                    'Initial stock on product creation',
                    id,
                    userId || null
                ]
            );
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
                const totalStock = await this.getProductStock(movementData.product_id);
                const tiendanubeService = (await import('./tiendanube.service.js')).default;
                await tiendanubeService.syncStock(movementData.product_id, totalStock);
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
            throw new Error('La cantidad a transferir debe ser mayor a cero.');
        }

        const normalizedFrom = String(fromLocation || 'General').trim();
        const normalizedTo = String(toLocation || 'General').trim();

        if (normalizedFrom === normalizedTo) {
            throw new Error('La ubicación de origen y destino no pueden ser iguales.');
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const [sourceRows] = await connection.query(
                'SELECT id, quantity, reserved_quantity FROM inventory WHERE product_id = ? AND location = ? FOR UPDATE',
                [productId, normalizedFrom]
            );

            if (sourceRows.length === 0) {
                throw new Error(`Stock insuficiente en ${normalizedFrom}. Requerido: ${qty}, Disponible: 0 (Físico: 0, Reservado: 0)`);
            }

            const physicalQty = sourceRows[0].quantity;
            const reservedQty = sourceRows[0].reserved_quantity || 0;
            const availableQty = physicalQty - reservedQty;

            if (availableQty < qty) {
                throw new Error(`Stock disponible insuficiente en ${normalizedFrom}. Requerido: ${qty}, Disponible: ${availableQty} (Físico: ${physicalQty}, Reservado: ${reservedQty})`);
            }

            const sourceId = sourceRows[0].id;
            const remainingQty = sourceRows[0].quantity - qty;

            if (remainingQty === 0) {
                await connection.query('DELETE FROM inventory WHERE id = ?', [sourceId]);
            } else {
                await connection.query('UPDATE inventory SET quantity = ? WHERE id = ?', [remainingQty, sourceId]);
            }

            const [targetRows] = await connection.query(
                'SELECT id FROM inventory WHERE product_id = ? AND location = ? FOR UPDATE',
                [productId, normalizedTo]
            );

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

            const movementId = crypto.randomUUID();
            await connection.query(`
                INSERT INTO inventory_movements (
                    id, type, product_id, from_location, to_location, quantity, unit_cost, reason, reference_type, reference_id, performed_by
                ) VALUES (?, 'transfer', ?, ?, ?, ?, 0, 'Internal location transfer', 'transfer', ?, ?)
            `, [
                movementId,
                productId,
                normalizedFrom,
                normalizedTo,
                qty,
                movementId,
                userId || null
            ]);

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
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new InventoryService();
