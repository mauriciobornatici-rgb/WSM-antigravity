import express from 'express';
import * as inventoryController from '../controllers/inventoryController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const inventoryReadRoles = authorizeRoles('admin', 'manager', 'warehouse', 'cashier');
const inventoryWriteRoles = authorizeRoles('admin', 'manager', 'warehouse');
const advancedInventoryRoles = authorizeRoles('admin', 'manager', 'warehouse');

// Products
router.get('/products', inventoryReadRoles, validate(schemas.productFilters), inventoryController.getProducts);
router.post('/products', inventoryWriteRoles, validate(schemas.product), inventoryController.createProduct);
router.put('/products/:id', inventoryWriteRoles, validate(schemas.product), inventoryController.updateProduct);
router.delete('/products/:id', inventoryWriteRoles, validate(schemas.idParam), inventoryController.deleteProduct);
router.get('/products/:id/movements', inventoryReadRoles, validate(schemas.idParam), inventoryController.getProductMovements);

// Inventory summary
router.get('/inventory', inventoryReadRoles, inventoryController.getInventory);

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
