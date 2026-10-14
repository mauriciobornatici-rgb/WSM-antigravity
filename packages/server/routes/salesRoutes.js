import express from 'express';
import * as salesController from '../controllers/salesController.js';
import { validate, schemas, validateZod, zodSchemas } from '../middleware/validationMiddleware.js';
import { authorizePermission } from '../middleware/authMiddleware.js';
import { hasPermission, PERMISSIONS } from '@wsm/common';

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
// Starting and finishing the picking ('picking', 'packed') is also the warehouse's job: the
// picking screen moves the order through these two states, and a warehouse user has the picking
// permission but not the sales one. Either permission is enough for them (the counter keeps
// doing it as before). Every other change keeps the sales permission.
const PICKING_STATUSES = new Set(['picking', 'packed']);
const canChangeOrderStatus = (req, res, next) => {
    const role = req.user?.role;
    const allowed = PICKING_STATUSES.has(String(req.body?.status || '').toLowerCase())
        ? hasPermission(role, PERMISSIONS.ORDERS_PICK) || hasPermission(role, PERMISSIONS.ORDERS_SELL)
        : hasPermission(role, PERMISSIONS.ORDERS_SELL);
    if (!allowed) return res.status(403).json({ error: 'forbidden', message: 'No tiene permisos para realizar esta accion' });
    return next();
};
router.put('/orders/:id/status', canChangeOrderStatus, validate(schemas.orderStatus), salesController.updateOrderStatus);
// ADR-017/018: changing a charge after the order was made is a commercial concession: managers
// and administrators (the same permission as changing prices), always audited.
router.put('/orders/:id/shipping', authorizePermission(PERMISSIONS.ORDERS_PRICE_OVERRIDE), validateZod(zodSchemas.orderShippingCharge), salesController.updateOrderShipping);
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
// ADR-022: annul an invoice ARCA never authorized and issue it again.
router.post('/invoices/:id/reissue', canInvoice, validate(schemas.invoiceReissue), salesController.reissueInvoice);
router.post('/invoices/:id/payments', canInvoice, validateZod(zodSchemas.invoicePayment), salesController.registerInvoicePayments);
router.get('/invoice-items', canInvoice, validate(schemas.invoiceItemsQuery), salesController.getInvoiceItems);

// ADR-021: ARCA documents in conflict or stuck in verification (panel and menu alert).
router.get('/fiscal/arca-alerts', canInvoice, salesController.getArcaAlerts);

// Tax data
router.get('/tax-conditions', canInvoice, salesController.getTaxConditions);

export default router;
