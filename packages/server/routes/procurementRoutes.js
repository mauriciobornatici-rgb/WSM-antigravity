import express from 'express';
import * as procurementController from '../controllers/procurementController.js';
import * as supplierInvoiceController from '../controllers/supplierInvoiceController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const purchaseOrderReadRoles = authorizePermission(PERMISSIONS.PROCUREMENT_READ);
const purchaseOrderWriteRoles = authorizePermission(PERMISSIONS.PROCUREMENT_MANAGE);
const receptionRoles = authorizePermission(PERMISSIONS.RECEPTIONS_MANAGE);
const supplierReturnRoles = authorizePermission(PERMISSIONS.SUPPLIER_RETURNS_MANAGE);
const supplierPaymentRoles = authorizePermission(PERMISSIONS.SUPPLIER_PAYMENTS_MANAGE);
const qualityRoles = authorizePermission(PERMISSIONS.QUALITY_MANAGE);

// Purchase Orders
router.get('/purchase-orders', purchaseOrderReadRoles, validate(schemas.purchaseOrderFilters), procurementController.getPurchaseOrders);
router.get('/purchase-orders/:id', purchaseOrderReadRoles, validate(schemas.idParam), procurementController.getPurchaseOrder);
router.post('/purchase-orders', purchaseOrderWriteRoles, validate(schemas.purchaseOrder), procurementController.createPurchaseOrder);
router.put('/purchase-orders/:id/status', purchaseOrderWriteRoles, validate(schemas.purchaseOrderStatus), procurementController.updatePurchaseOrderStatus);

// Receptions
router.get('/iva-compras', receptionRoles, procurementController.exportIVACompras);
router.get('/receptions', receptionRoles, validate(schemas.receptionFilters), procurementController.getReceptions);
router.post('/receptions', receptionRoles, validate(schemas.reception), procurementController.createReception);
router.post('/receptions/:id/approve', receptionRoles, validate(schemas.approveReception), procurementController.approveReception);

// Supplier Returns
router.get('/returns', supplierReturnRoles, validate(schemas.supplierReturnFilters), procurementController.getReturns);
router.get('/supplier-returns', supplierReturnRoles, validate(schemas.supplierReturnFilters), procurementController.getSupplierReturns);
router.get('/returns/suggested-costs', supplierReturnRoles, validate(schemas.supplierReturnSuggestedCosts), procurementController.getReturnSuggestedCosts);
router.post('/returns', supplierReturnRoles, validate(schemas.supplierReturnCreate), procurementController.createReturn);
router.post('/returns/:id/approve', supplierReturnRoles, validate(schemas.idParam), procurementController.approveReturn);

// Supplier payments
router.get('/supplier-payments', supplierPaymentRoles, validate(schemas.supplierPaymentFilters), procurementController.getSupplierPayments);
router.post('/supplier-payments', supplierPaymentRoles, validate(schemas.supplierPaymentCreate), procurementController.createSupplierPayment);

// Supplier Invoices
router.get('/supplier-invoices/pending', purchaseOrderReadRoles, supplierInvoiceController.getPendingSupplierInvoices);
router.get('/supplier-invoices', purchaseOrderReadRoles, validate(schemas.supplierInvoiceFilters), supplierInvoiceController.getSupplierInvoices);
router.post('/supplier-invoices', purchaseOrderWriteRoles, validate(schemas.supplierInvoiceCreate), supplierInvoiceController.createSupplierInvoice);
router.post('/supplier-payments/bulk', supplierPaymentRoles, supplierInvoiceController.registerBulkSupplierPayments);
// ADR-029: supplier credit notes for units an invoice charged of more.
router.get('/supplier-credit-notes', purchaseOrderReadRoles, validate(schemas.supplierCreditNoteFilters), supplierInvoiceController.getSupplierCreditNotes);
router.post('/supplier-credit-notes', purchaseOrderWriteRoles, validate(schemas.supplierCreditNoteCreate), supplierInvoiceController.createSupplierCreditNote);


// Quality checks
router.post('/quality-checks', qualityRoles, validate(schemas.qualityCheck), procurementController.createQualityCheck);

export default router;
