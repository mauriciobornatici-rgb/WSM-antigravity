import express from 'express';
import * as procurementController from '../controllers/procurementController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const purchaseOrderReadRoles = authorizeRoles('admin', 'manager', 'warehouse');
const purchaseOrderWriteRoles = authorizeRoles('admin', 'manager');
const receptionRoles = authorizeRoles('admin', 'manager', 'warehouse');
const supplierReturnRoles = authorizeRoles('admin', 'manager', 'warehouse');
const supplierPaymentRoles = authorizeRoles('admin', 'manager');
const qualityRoles = authorizeRoles('admin', 'manager', 'warehouse');

// Purchase Orders
router.get('/purchase-orders', purchaseOrderReadRoles, validate(schemas.purchaseOrderFilters), procurementController.getPurchaseOrders);
router.get('/purchase-orders/:id', purchaseOrderReadRoles, validate(schemas.idParam), procurementController.getPurchaseOrder);
router.post('/purchase-orders', purchaseOrderWriteRoles, validate(schemas.purchaseOrder), procurementController.createPurchaseOrder);
router.put('/purchase-orders/:id/status', purchaseOrderWriteRoles, validate(schemas.purchaseOrderStatus), procurementController.updatePurchaseOrderStatus);

// Receptions
router.get('/receptions', receptionRoles, validate(schemas.receptionFilters), procurementController.getReceptions);
router.post('/receptions', receptionRoles, validate(schemas.reception), procurementController.createReception);
router.post('/receptions/:id/approve', receptionRoles, validate(schemas.approveReception), procurementController.approveReception);

// Supplier Returns
router.get('/returns', supplierReturnRoles, validate(schemas.supplierReturnFilters), procurementController.getReturns);
router.get('/supplier-returns', supplierReturnRoles, validate(schemas.supplierReturnFilters), procurementController.getSupplierReturns);
router.post('/returns', supplierReturnRoles, validate(schemas.supplierReturnCreate), procurementController.createReturn);
router.post('/returns/:id/approve', supplierReturnRoles, validate(schemas.idParam), procurementController.approveReturn);

// Supplier payments
router.get('/supplier-payments', supplierPaymentRoles, validate(schemas.supplierPaymentFilters), procurementController.getSupplierPayments);
router.post('/supplier-payments', supplierPaymentRoles, validate(schemas.supplierPaymentCreate), procurementController.createSupplierPayment);

// Quality checks
router.post('/quality-checks', qualityRoles, validate(schemas.qualityCheck), procurementController.createQualityCheck);

export default router;
