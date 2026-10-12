import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import inventoryService from '../services/inventory.service.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';
import pool from '../config/db.js';
import { applyPaginationHeaders, getPagination } from '../utils/pagination.js';
import { normalizeProductImageUrl, parseProductImageDataUrl } from '../utils/imagePolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_UPLOADS_DIR = path.resolve(__dirname, '../uploads/products');
const CATALOG_OPTION_TYPES = new Set(['group', 'subgroup', 'brand', 'size', 'color']);
const CATALOG_PRODUCT_FIELDS = Object.freeze({
    group: { id: 'category_option_id', value: 'category' },
    subgroup: { id: 'subcategory_option_id', value: 'subcategory' },
    brand: { id: 'brand_option_id', value: 'brand' },
    size: { id: 'size_option_id', value: 'size' },
    color: { id: 'color_option_id', value: 'color' }
});

function normalizeCatalogOptionName(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function catalogOptionKey(type, name, parentId = null) {
    return crypto.createHash('sha256').update(`${type}|${parentId || ''}|${name.toLocaleLowerCase('es-AR')}`).digest('hex');
}

async function validateCatalogOptionParent(type, parentId) {
    if (type !== 'subgroup') {
        if (parentId) {
            const error = new Error('Solo los subgrupos pueden depender de otro valor.');
            error.statusCode = 400;
            throw error;
        }
        return null;
    }
    if (!parentId) {
        const error = new Error('El subgrupo debe pertenecer a un grupo.');
        error.statusCode = 400;
        throw error;
    }
    const [rows] = await pool.query(
        "SELECT id FROM product_catalog_options WHERE id = ? AND type = 'group' LIMIT 1",
        [parentId]
    );
    if (rows.length === 0) {
        const error = new Error('El grupo seleccionado no existe.');
        error.statusCode = 400;
        throw error;
    }
    return parentId;
}

export const getProductCatalogOptions = catchAsync(async (req, res) => {
    const type = String(req.query.type || '').trim();
    if (type && !CATALOG_OPTION_TYPES.has(type)) {
        return res.status(400).json({ error: 'invalid_option_type', message: 'Tipo de maestro inválido' });
    }
    const params = [];
    let query = `
        SELECT catalog_option.*, parent.name AS parent_name,
               (SELECT COUNT(*) FROM products product
                WHERE product.deleted_at IS NULL AND (
                    product.category_option_id = catalog_option.id OR
                    product.subcategory_option_id = catalog_option.id OR
                    product.brand_option_id = catalog_option.id OR
                    product.size_option_id = catalog_option.id OR
                    product.color_option_id = catalog_option.id
                )) AS usage_count
        FROM product_catalog_options catalog_option
        LEFT JOIN product_catalog_options parent ON parent.id = catalog_option.parent_id
        WHERE 1 = 1`;
    if (type) {
        query += ' AND catalog_option.type = ?';
        params.push(type);
    }
    if (req.query.parent_id) {
        query += ' AND catalog_option.parent_id = ?';
        params.push(req.query.parent_id);
    }
    if (String(req.query.include_inactive || '') !== 'true') {
        query += ' AND catalog_option.active = TRUE';
    }
    query += " ORDER BY FIELD(catalog_option.type, 'group', 'subgroup', 'brand', 'size', 'color'), catalog_option.sort_order, catalog_option.name";
    const [rows] = await pool.query(query, params);
    res.json(rows.map((row) => ({ ...row, active: Boolean(row.active), usage_count: Number(row.usage_count || 0) })));
});

export const createProductCatalogOption = catchAsync(async (req, res) => {
    const type = String(req.body?.type || '').trim();
    const name = normalizeCatalogOptionName(req.body?.name);
    if (!CATALOG_OPTION_TYPES.has(type) || !name || name.length > 100) {
        return res.status(400).json({ error: 'invalid_catalog_option', message: 'Tipo y nombre válido son obligatorios' });
    }
    const parentId = await validateCatalogOptionParent(type, req.body?.parent_id || null);
    const id = crypto.randomUUID();
    try {
        await pool.query(
            `INSERT INTO product_catalog_options
                (id, option_key, type, name, normalized_name, parent_id, active, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
            [id, catalogOptionKey(type, name, parentId), type, name, name.toLocaleLowerCase('es-AR'), parentId, Number(req.body?.sort_order || 0), req.user?.id || null]
        );
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'duplicate_catalog_option', message: 'Ese valor ya existe en el maestro seleccionado' });
        }
        throw error;
    }
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_PRODUCT_CATALOG_OPTION',
        entity_type: 'product_catalog_option',
        entity_id: id,
        new_values: { type, name, parent_id: parentId },
        ip_address: getRequestIp(req)
    });
    const [rows] = await pool.query('SELECT * FROM product_catalog_options WHERE id = ?', [id]);
    res.status(201).json({ ...rows[0], active: Boolean(rows[0].active), usage_count: 0 });
});

export const updateProductCatalogOption = catchAsync(async (req, res) => {
    const [existingRows] = await pool.query('SELECT * FROM product_catalog_options WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Valor de catálogo no encontrado' });
    }
    const existing = existingRows[0];
    const name = req.body?.name == null ? existing.name : normalizeCatalogOptionName(req.body.name);
    if (!name || name.length > 100) {
        return res.status(400).json({ error: 'invalid_catalog_option', message: 'El nombre es obligatorio y admite hasta 100 caracteres' });
    }
    const requestedParent = Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_id') ? req.body.parent_id : existing.parent_id;
    const parentId = await validateCatalogOptionParent(existing.type, requestedParent || null);
    const active = req.body?.active == null ? Boolean(existing.active) : Boolean(req.body.active);
    const sortOrder = req.body?.sort_order == null ? Number(existing.sort_order || 0) : Number(req.body.sort_order || 0);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE product_catalog_options
             SET option_key = ?, name = ?, normalized_name = ?, parent_id = ?, active = ?, sort_order = ?
             WHERE id = ?`,
            [catalogOptionKey(existing.type, name, parentId), name, name.toLocaleLowerCase('es-AR'), parentId, active, sortOrder, req.params.id]
        );
        if (name !== existing.name) {
            const fields = CATALOG_PRODUCT_FIELDS[existing.type];
            await connection.query(
                `UPDATE products SET \`${fields.value}\` = ? WHERE \`${fields.id}\` = ? AND deleted_at IS NULL`,
                [name, req.params.id]
            );
            if (existing.type === 'group' || existing.type === 'brand') {
                const familyField = existing.type === 'group' ? 'category' : 'brand';
                await connection.query(
                    `UPDATE product_families family
                     JOIN products product ON product.family_id = family.id AND product.deleted_at IS NULL
                     SET family.\`${familyField}\` = ?
                     WHERE product.\`${fields.id}\` = ? AND family.deleted_at IS NULL`,
                    [name, req.params.id]
                );
            }
        }
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'duplicate_catalog_option', message: 'Ese valor ya existe en el maestro seleccionado' });
        }
        throw error;
    } finally {
        connection.release();
    }
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_PRODUCT_CATALOG_OPTION',
        entity_type: 'product_catalog_option',
        entity_id: req.params.id,
        old_values: existing,
        new_values: { name, parent_id: parentId, active, sort_order: sortOrder },
        ip_address: getRequestIp(req)
    });
    const [rows] = await pool.query(`
        SELECT catalog_option.*, parent.name AS parent_name
        FROM product_catalog_options catalog_option
        LEFT JOIN product_catalog_options parent ON parent.id = catalog_option.parent_id
        WHERE catalog_option.id = ?`, [req.params.id]);
    res.json({ ...rows[0], active: Boolean(rows[0].active) });
});

export const getProducts = catchAsync(async (req, res) => {
    const filters = {};
    if (req.query.supplier_id && req.query.supplier_id !== 'undefined' && req.query.supplier_id !== 'null') {
        filters.supplier_id = req.query.supplier_id;
    }

    const pagination = getPagination(req.query, { defaultLimit: 100, maxLimit: 500 });

    if (!pagination.enabled) {
        const products = await inventoryService.getProductsWithInventoryStock(filters);
        return res.json(products);
    }

    const result = await inventoryService.getProductsWithInventoryStock(filters, {
        limit: pagination.limit,
        offset: pagination.offset,
        includeTotal: true
    });

    applyPaginationHeaders(res, pagination, result.total);
    res.json(result.rows);
});

export const getInventory = catchAsync(async (req, res) => {
    const rows = await inventoryService.getInventoryWithDetails();
    res.json(rows);
});

export const getWarehouseLocations = catchAsync(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT wl.*,
               COUNT(DISTINCT i.product_id) AS sku_count,
               COALESCE(SUM(i.quantity), 0) AS total_quantity
        FROM warehouse_locations wl
        LEFT JOIN inventory i ON i.location = wl.code
        GROUP BY wl.id
        ORDER BY wl.active DESC, wl.name ASC
    `);
    res.json(rows.map((row) => ({
        ...row,
        active: Boolean(row.active),
        sku_count: Number(row.sku_count || 0),
        total_quantity: Number(row.total_quantity || 0)
    })));
});

export const createWarehouseLocation = catchAsync(async (req, res) => {
    const code = String(req.body?.code || '').trim();
    const name = String(req.body?.name || code).trim();
    const description = String(req.body?.description || '').trim() || null;
    if (!code || !name) {
        return res.status(400).json({ error: 'invalid_location', message: 'Código y nombre son obligatorios' });
    }
    const id = crypto.randomUUID();
    try {
        await pool.query(
            `INSERT INTO warehouse_locations (id, code, name, description, active, created_by)
             VALUES (?, ?, ?, ?, TRUE, ?)`,
            [id, code, name, description, req.user?.id || null]
        );
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'duplicate_location', message: 'Ya existe una ubicación con ese código' });
        }
        throw error;
    }
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_WAREHOUSE_LOCATION',
        entity_type: 'warehouse_location',
        entity_id: id,
        new_values: { code, name, description },
        ip_address: getRequestIp(req)
    });
    const [rows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
    res.status(201).json(rows[0]);
});

export const updateWarehouseLocation = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [existingRows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
    if (existingRows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Ubicación no encontrada' });
    }
    const existing = existingRows[0];
    const code = String(req.body?.code ?? existing.code).trim();
    const name = String(req.body?.name ?? existing.name).trim();
    const description = req.body?.description == null ? existing.description : String(req.body.description).trim() || null;
    const active = req.body?.active == null ? Boolean(existing.active) : Boolean(req.body.active);
    if (!code || !name) {
        return res.status(400).json({ error: 'invalid_location', message: 'Código y nombre son obligatorios' });
    }
    if (code !== existing.code) {
        const [[usage]] = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM inventory WHERE location = ?) +
              (SELECT COUNT(*) FROM products WHERE location = ?) AS usage_count
        `, [existing.code, existing.code]);
        if (Number(usage?.usage_count || 0) > 0) {
            return res.status(409).json({
                error: 'location_in_use',
                message: 'El código no puede cambiar mientras tenga productos. Traslade el stock primero; el nombre y la descripción sí pueden editarse.'
            });
        }
    }
    try {
        await pool.query(
            'UPDATE warehouse_locations SET code = ?, name = ?, description = ?, active = ? WHERE id = ?',
            [code, name, description, active, id]
        );
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'duplicate_location', message: 'Ya existe una ubicación con ese código' });
        }
        throw error;
    }
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_WAREHOUSE_LOCATION',
        entity_type: 'warehouse_location',
        entity_id: id,
        old_values: existing,
        new_values: { code, name, description, active },
        ip_address: getRequestIp(req)
    });
    const [rows] = await pool.query('SELECT * FROM warehouse_locations WHERE id = ?', [id]);
    res.json(rows[0]);
});

export const createProduct = catchAsync(async (req, res) => {
    const newItem = await inventoryService.createProduct(req.body, req.user?.id);
    res.json(newItem);
});

export const updateProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const previous = await inventoryService.findById(id);
    const data = { ...req.body };
    const hasFamilyName = Object.prototype.hasOwnProperty.call(data, 'family_name');
    const familyName = data.family_name;
    delete data.family_name;
    if (data.cost_price != null && data.purchase_price == null) {
        data.purchase_price = data.cost_price;
    }
    delete data.cost_price;
    delete data.stock_initial;

    await inventoryService.applyProductCatalogOptions(data, previous || {});

    if (Object.prototype.hasOwnProperty.call(data, 'barcode')) {
        data.barcode = await inventoryService.ensureUniqueBarcode(data.barcode, id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'location')) {
        data.location = inventoryService.normalizeLocation(data.location);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'image_url')) {
        data.image_url = normalizeProductImageUrl(data.image_url);
    }
    if (hasFamilyName) {
        data.family_id = await inventoryService.resolveProductFamily(familyName, {
            ...(previous || {}),
            ...data
        });
    }

    const updated = await inventoryService.update(id, data);
    if (updated) {
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'UPDATE_PRODUCT',
            entity_type: 'product',
            entity_id: id,
            old_values: previous || null,
            new_values: updated,
            ip_address: getRequestIp(req)
        });
    }
    res.json(updated);
});

export const uploadProductImage = catchAsync(async (req, res) => {
    const { buffer, extension } = parseProductImageDataUrl(req.body?.data_url);

    await fs.mkdir(PRODUCT_UPLOADS_DIR, { recursive: true });

    const fileName = `${crypto.randomUUID()}.${extension}`;
    const destinationPath = path.join(PRODUCT_UPLOADS_DIR, fileName);
    await fs.writeFile(destinationPath, buffer, { flag: 'wx' });

    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim();
    const protocol = forwardedProto || req.protocol || 'http';
    const host = req.get('host') || 'localhost:3001';

    res.status(201).json({
        image_url: `${protocol}://${host}/uploads/products/${fileName}`
    });
});

export const deleteProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const previous = await inventoryService.findById(id);
    const result = await inventoryService.delete(id);
    if (previous) {
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'DELETE_PRODUCT',
            entity_type: 'product',
            entity_id: id,
            old_values: previous,
            ip_address: getRequestIp(req)
        });
    }
    res.json(result);
});

export const getMovements = catchAsync(async (req, res) => {
    const rows = await inventoryService.getMovements(req.query, { limit: req.query.limit });
    res.json(rows);
});

export const getProductMovements = catchAsync(async (req, res) => {
    const { id } = req.params;
    const rows = await inventoryService.getProductMovements(id);
    res.json(rows);
});

export const createMovement = catchAsync(async (req, res) => {
    const movement = await inventoryService.recordMovement(req.body, req.user?.id);
    res.json(movement);
});

export const getBatches = catchAsync(async (req, res) => {
    const batches = await inventoryService.getBatches(req.query);
    res.json(batches);
});

export const createBatch = catchAsync(async (req, res) => {
    const result = await inventoryService.createBatch(req.body);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_BATCH',
        entity_type: 'product_batch',
        entity_id: result.id,
        new_values: { id: result.id, ...req.body },
        ip_address: getRequestIp(req)
    });
    res.json(result);
});

export const updateBatch = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await inventoryService.updateBatch(id, req.body);
    if (result) {
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'UPDATE_BATCH',
            entity_type: 'product_batch',
            entity_id: id,
            new_values: result,
            ip_address: getRequestIp(req)
        });
    }
    res.json(result);
});

export const getSerials = catchAsync(async (req, res) => {
    const serials = await inventoryService.getSerials(req.query);
    res.json(serials);
});

export const createSerialNumber = catchAsync(async (req, res) => {
    const result = await inventoryService.createSerialNumber(req.body);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_SERIAL_NUMBER',
        entity_type: 'serial_number',
        entity_id: result.id,
        new_values: { id: result.id, ...req.body },
        ip_address: getRequestIp(req)
    });
    res.json(result);
});

export const updateSerialNumber = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await inventoryService.updateSerialNumber(id, req.body);
    if (result) {
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'UPDATE_SERIAL_NUMBER',
            entity_type: 'serial_number',
            entity_id: id,
            new_values: result,
            ip_address: getRequestIp(req)
        });
    }
    res.json(result);
});

export const transferStock = catchAsync(async (req, res) => {
    const { product_id, from_location, to_location, quantity } = req.body;
    const result = await inventoryService.transferStock(
        product_id,
        from_location,
        to_location,
        quantity,
        req.user?.id
    );
    res.json(result);
});

export const bulkUpdateTiendaNube = catchAsync(async (req, res) => {
    const { products } = req.body;
    const result = await inventoryService.bulkUpdateTiendaNube(products, req.user?.id);
    res.json(result);
});
