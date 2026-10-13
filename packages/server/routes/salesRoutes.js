import express from 'express';
import * as salesController from '../controllers/salesController.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';

const router = express.Router();
const canReadOrders = authorizePermission(PERMISSIONS.ORDERS_READ);
const canSell = authorizePermission(PERMISSIONS.ORDERS_SELL);
const canPick = authorizePermission(PERMISSIONS.ORDERS_PICK);
const canDispatch = authorizePermission(PERMISSIONS.ORDERS_DISPATCH);
const canInvoice = authorizePermission(PERMISSIONS.INVOICES_MANAGE);

// Orders
router.get('/orders', canReadOrders, validateZod(zodSchemas.orderFilters), salesController.getOrders);
router.post('/orders', canSell, validateZod(zodSchemas.order), salesController.createOrder);
router.post('/pos/checkout', canSell, validateZod(zodSchemas.posCheckout), salesController.posCheckout);
const canReviewPrices = authorizePermission(PERMISSIONS.ORDERS_PRICE_OVERRIDE);
router.get('/pos/exceptions', canReviewPrices, validateZod(zodSchemas.posExceptionsQuery), salesController.listPosExceptions);
router.post('/pos/exceptions/:id/review', canReviewPrices, validateZod(zodSchemas.posExceptionReview), salesController.reviewPosException);
router.put('/orders/:id/status', canSell, validate(schemas.orderStatus), salesController.updateOrderStatus);
// ADR-017: charge the shipping or not (orders made here, before invoicing).
router.put('/orders/:id/shipping', canSell, validateZod(zodSchemas.orderShippingCharge), salesController.updateOrderShipping);
router.put('/orders/:id/dispatch', canDispatch, validate(schemas.orderDispatch), salesController.dispatchOrder);
router.put('/orders/:id/deliver', canDispatch, validate(schemas.orderDeliver), salesController.deliverOrder);
router.post('/orders/:id/pickup-checkout', canSell, validate(schemas.pickupOrderCheckout), salesController.checkoutPickupOrder);
router.post('/orders/:id/invoice', canInvoice, validate(schemas.orderInvoice), salesController.createInvoice);
router.get('/orders/:id/summary', canReadOrders, validate(schemas.idParam), salesController.getOrderSummary);
router.post('/orders/:id/picking-event', canPick, salesController.recordPickingEvent);

// Order items
router.put('/order-items/:id/pick', canPick, validate(schemas.orderItemPick), salesController.pickOrderItem);

// Invoices
router.get('/invoices', canInvoice, validate(schemas.invoiceFilters), salesController.getInvoices);
router.get('/invoices/:id', canInvoice, validate(schemas.idParam), salesController.getInvoiceById);
router.post('/invoices', canInvoice, validate(schemas.manualInvoice), salesController.createManualInvoice);
router.post('/invoices/:id/authorize', canInvoice, validate(schemas.idParam), salesController.authorizeInvoice);
router.post('/invoices/:id/payments', canInvoice, validateZod(zodSchemas.invoicePayment), salesController.registerInvoicePayments);
router.get('/invoice-items', canInvoice, validate(schemas.invoiceItemsQuery), salesController.getInvoiceItems);

// Tax data
router.get('/tax-conditions', canInvoice, salesController.getTaxConditions);

export default router;
