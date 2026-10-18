import express from 'express';
import * as inventoryController from '../controllers/inventoryController.js';
import * as stockAuditController from '../controllers/stockAuditController.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const inventoryReadRoles = authorizePermission(PERMISSIONS.PRODUCTS_READ);
const inventoryWriteRoles = authorizePermission(PERMISSIONS.INVENTORY_MANAGE);
const advancedInventoryRoles = authorizePermission(PERMISSIONS.INVENTORY_MANAGE);
const stockCountRoles = authorizePermission(PERMISSIONS.INVENTORY_COUNT);
const stockAdjustRoles = authorizePermission(PERMISSIONS.INVENTORY_ADJUST);

// Normalized product catalog masters
router.get('/product-catalog-options', inventoryReadRoles, inventoryController.getProductCatalogOptions);
router.post('/product-catalog-options', inventoryWriteRoles, inventoryController.createProductCatalogOption);
router.put('/product-catalog-options/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.updateProductCatalogOption);

// Products
router.get('/products', inventoryReadRoles, validateZod(zodSchemas.productFilters), inventoryController.getProducts);
router.post('/products/image-upload', inventoryWriteRoles, validateZod(zodSchemas.uploadProductImage), inventoryController.uploadProductImage);
router.post('/products', inventoryWriteRoles, validateZod(zodSchemas.product), inventoryController.createProduct);
router.put('/products/:id', inventoryWriteRoles, validateZod(zodSchemas.product), inventoryController.updateProduct);
router.delete('/products/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.deleteProduct);
router.get('/products/:id/movements', inventoryReadRoles, validate(schemas.idParam), inventoryController.getProductMovements);

// Inventory summary
router.get('/inventory', inventoryReadRoles, inventoryController.getInventory);
router.get('/inventory/locations', inventoryReadRoles, inventoryController.getWarehouseLocations);
router.post('/inventory/locations', inventoryWriteRoles, inventoryController.createWarehouseLocation);
router.put('/inventory/locations/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.updateWarehouseLocation);
router.post('/inventory/transfer', inventoryWriteRoles, inventoryController.transferStock);

// Mobile cycle counts and controlled stock reconciliation
router.get('/inventory/audits/dashboard', stockCountRoles, validateZod(zodSchemas.stockAuditFilters), stockAuditController.getStockAuditDashboard);
router.get('/inventory/audits/:id', stockCountRoles, validate(zodSchemas.idParam), stockAuditController.getStockAudit);
router.post('/inventory/audits', stockCountRoles, validateZod(zodSchemas.stockAuditCreate), stockAuditController.createStockAudit);
router.post('/inventory/audits/:id/counts', stockCountRoles, validateZod(zodSchemas.stockAuditCount), stockAuditController.countStockAuditItem);
router.post('/inventory/audits/:id/complete', stockCountRoles, validate(zodSchemas.idParam), stockAuditController.completeStockAudit);
router.post('/inventory/audits/:id/cancel', stockCountRoles, validate(zodSchemas.idParam), stockAuditController.cancelStockAudit);
router.post('/inventory/audits/:id/adjust', stockAdjustRoles, validate(zodSchemas.idParam), stockAuditController.applyStockAuditAdjustments);

// Movements (legacy + explicit alias). Read only: every movement is written by the operation
// that moves the stock, with its entry (ADR-027). A free movement carried any cost and fed the
// cost of goods sold without moving anything.
router.get('/movements', inventoryReadRoles, validate(schemas.inventoryMovementFilters), inventoryController.getMovements);
router.get('/inventory-movements', inventoryReadRoles, validate(schemas.inventoryMovementFilters), inventoryController.getMovements);

// Batches
router.get('/batches', advancedInventoryRoles, validate(schemas.batchFilters), inventoryController.getBatches);
router.post('/batches', advancedInventoryRoles, validate(schemas.batchCreate), inventoryController.createBatch);
router.put('/batches/:id', advancedInventoryRoles, validate(schemas.batchUpdate), inventoryController.updateBatch);

// Serials
router.get('/serials', advancedInventoryRoles, validate(schemas.serialFilters), inventoryController.getSerials);
router.post('/serials', advancedInventoryRoles, validate(schemas.serialCreate), inventoryController.createSerialNumber);
router.put('/serials/:id', advancedInventoryRoles, validate(schemas.serialUpdate), inventoryController.updateSerialNumber);

export default router;
