import express from 'express';
import * as clientController from '../controllers/clientController.js';
import * as supplierController from '../controllers/supplierController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const clientRoles = authorizeRoles('admin', 'manager', 'cashier');
const supplierRoles = authorizeRoles('admin', 'manager');

// Clients
router.get('/clients', clientRoles, clientController.getClients);
router.get('/clients/:id', clientRoles, validate(schemas.idParam), clientController.getClientById);
router.post('/clients', clientRoles, validate(schemas.client), clientController.createClient);
router.put('/clients/:id', clientRoles, validate(schemas.clientUpdate), clientController.updateClient);
router.delete('/clients/:id', clientRoles, validate(schemas.idParam), clientController.deleteClient);

// Suppliers
router.get('/suppliers', supplierRoles, supplierController.getSuppliers);
router.post('/suppliers', supplierRoles, validate(schemas.supplier), supplierController.createSupplier);
router.put('/suppliers/:id', supplierRoles, validate(schemas.supplierUpdate), supplierController.updateSupplier);
router.delete('/suppliers/:id', supplierRoles, validate(schemas.idParam), supplierController.deleteSupplier);

export default router;
