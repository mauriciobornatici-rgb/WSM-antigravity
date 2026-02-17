import express from 'express';
import * as salesController from '../controllers/salesController.js';
import { validate, schemas } from '../middleware/validationMiddleware.js';
import { authorizeRoles } from '../middleware/authMiddleware.js';

const router = express.Router();
const orderRoles = authorizeRoles('admin', 'manager', 'cashier', 'warehouse');
const invoicingRoles = authorizeRoles('admin', 'manager', 'cashier');

// Orders
router.get('/orders', orderRoles, validate(schemas.orderFilters), salesController.getOrders);
router.post('/orders', orderRoles, validate(schemas.order), salesController.createOrder);
router.put('/orders/:id/status', orderRoles, validate(schemas.orderStatus), salesController.updateOrderStatus);
router.put('/orders/:id/dispatch', orderRoles, validate(schemas.orderDispatch), salesController.dispatchOrder);
router.put('/orders/:id/deliver', orderRoles, validate(schemas.orderDeliver), salesController.deliverOrder);
router.post('/orders/:id/invoice', invoicingRoles, validate(schemas.orderInvoice), salesController.createInvoice);
router.get('/orders/:id/summary', orderRoles, validate(schemas.idParam), salesController.getOrderSummary);

// Order items
router.put('/order-items/:id/pick', orderRoles, validate(schemas.orderItemPick), salesController.pickOrderItem);

// Invoices
router.get('/invoices', invoicingRoles, validate(schemas.invoiceFilters), salesController.getInvoices);
router.post('/invoices', invoicingRoles, validate(schemas.manualInvoice), salesController.createManualInvoice);
router.post('/invoices/:id/authorize', invoicingRoles, validate(schemas.idParam), salesController.authorizeInvoice);
router.get('/invoice-items', invoicingRoles, validate(schemas.invoiceItemsQuery), salesController.getInvoiceItems);

// Tax data
router.get('/tax-conditions', invoicingRoles, salesController.getTaxConditions);

export default router;
