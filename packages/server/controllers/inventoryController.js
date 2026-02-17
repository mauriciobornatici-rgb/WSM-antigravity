import inventoryService from '../services/inventory.service.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

export const getProducts = catchAsync(async (req, res) => {
    const filters = {};
    if (req.query.supplier_id && req.query.supplier_id !== 'undefined' && req.query.supplier_id !== 'null') {
        filters.supplier_id = req.query.supplier_id;
    }

    const products = await inventoryService.getProductsWithInventoryStock(filters);
    res.json(products);
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
