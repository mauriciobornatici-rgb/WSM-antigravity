import express from 'express';
import * as clientController from '../controllers/clientController.js';
import * as supplierController from '../controllers/supplierController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const clientRoles = authorizePermission(PERMISSIONS.CLIENTS_MANAGE);
const supplierRoles = authorizePermission(PERMISSIONS.SUPPLIERS_MANAGE);

// Clients
router.get('/clients', clientRoles, clientController.getClients);
router.get('/clients/:id', clientRoles, validate(schemas.idParam), clientController.getClientById);
router.post('/clients', clientRoles, validate(schemas.client), clientController.createClient);
router.put('/clients/:id', clientRoles, validate(schemas.clientUpdate), clientController.updateClient);
// ADR-022: VAT condition loaded at the moment of use (POS, invoices).
router.put('/clients/:id/tax-condition', clientRoles, validate(schemas.clientTaxCondition), clientController.setClientTaxCondition);
router.delete('/clients/:id', clientRoles, validate(schemas.idParam), clientController.deleteClient);

// Suppliers
router.get('/suppliers', supplierRoles, supplierController.getSuppliers);
router.post('/suppliers', supplierRoles, validate(schemas.supplier), supplierController.createSupplier);
router.put('/suppliers/:id', supplierRoles, validate(schemas.supplierUpdate), supplierController.updateSupplier);
router.delete('/suppliers/:id', supplierRoles, validate(schemas.idParam), supplierController.deleteSupplier);

export default router;
