import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import inventoryService from '../services/inventory.service.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';
import { applyPaginationHeaders, getPagination } from '../utils/pagination.js';
import { normalizeProductImageUrl, parseProductImageDataUrl } from '../utils/imagePolicy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_UPLOADS_DIR = path.resolve(__dirname, '../uploads/products');

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

export const createProduct = catchAsync(async (req, res) => {
    const newItem = await inventoryService.createProduct(req.body, req.user?.id);
    res.json(newItem);
});

export const updateProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const previous = await inventoryService.findById(id);
    const data = { ...req.body };
    if (data.cost_price != null && data.purchase_price == null) {
        data.purchase_price = data.cost_price;
    }
    delete data.cost_price;
    delete data.stock_initial;

    if (Object.prototype.hasOwnProperty.call(data, 'barcode')) {
        data.barcode = await inventoryService.ensureUniqueBarcode(data.barcode, id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'location')) {
        data.location = inventoryService.normalizeLocation(data.location);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'image_url')) {
        data.image_url = normalizeProductImageUrl(data.image_url);
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
