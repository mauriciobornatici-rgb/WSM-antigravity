import express from 'express';
import * as inventoryController from '../controllers/inventoryController.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const inventoryReadRoles = authorizePermission(PERMISSIONS.PRODUCTS_READ);
const inventoryWriteRoles = authorizePermission(PERMISSIONS.INVENTORY_MANAGE);
const advancedInventoryRoles = authorizePermission(PERMISSIONS.INVENTORY_MANAGE);

// Products
router.get('/products', inventoryReadRoles, validateZod(zodSchemas.productFilters), inventoryController.getProducts);
router.post('/products/image-upload', inventoryWriteRoles, validateZod(zodSchemas.uploadProductImage), inventoryController.uploadProductImage);
router.post('/products', inventoryWriteRoles, validateZod(zodSchemas.product), inventoryController.createProduct);
router.post('/products/tiendanube/bulk-update', inventoryWriteRoles, inventoryController.bulkUpdateTiendaNube);
router.put('/products/:id', inventoryWriteRoles, validateZod(zodSchemas.product), inventoryController.updateProduct);
router.delete('/products/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.deleteProduct);
router.get('/products/:id/movements', inventoryReadRoles, validate(schemas.idParam), inventoryController.getProductMovements);

// Inventory summary
router.get('/inventory', inventoryReadRoles, inventoryController.getInventory);
router.get('/inventory/locations', inventoryReadRoles, inventoryController.getWarehouseLocations);
router.post('/inventory/locations', inventoryWriteRoles, inventoryController.createWarehouseLocation);
router.put('/inventory/locations/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.updateWarehouseLocation);
router.post('/inventory/transfer', inventoryWriteRoles, inventoryController.transferStock);

// Movements (legacy + explicit alias)
router.get('/movements', inventoryReadRoles, validate(schemas.inventoryMovementFilters), inventoryController.getMovements);
router.post('/movements', inventoryWriteRoles, validate(schemas.inventoryMovementCreate), inventoryController.createMovement);
router.get('/inventory-movements', inventoryReadRoles, validate(schemas.inventoryMovementFilters), inventoryController.getMovements);
router.post('/inventory-movements', inventoryWriteRoles, validate(schemas.inventoryMovementCreate), inventoryController.createMovement);

// Batches
router.get('/batches', advancedInventoryRoles, validate(schemas.batchFilters), inventoryController.getBatches);
router.post('/batches', advancedInventoryRoles, validate(schemas.batchCreate), inventoryController.createBatch);
router.put('/batches/:id', advancedInventoryRoles, validate(schemas.batchUpdate), inventoryController.updateBatch);

// Serials
router.get('/serials', advancedInventoryRoles, validate(schemas.serialFilters), inventoryController.getSerials);
router.post('/serials', advancedInventoryRoles, validate(schemas.serialCreate), inventoryController.createSerialNumber);
router.put('/serials/:id', advancedInventoryRoles, validate(schemas.serialUpdate), inventoryController.updateSerialNumber);

export default router;
