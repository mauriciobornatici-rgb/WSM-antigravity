import salesService from '../services/sales.service.js';
import financeService from '../services/finance.service.js';
import pickupOrderCheckoutUseCase from '../domains/sales/PickupOrderCheckoutUseCase.js';
import posCheckoutUseCase from '../domains/sales/PosCheckoutUseCase.js';
import posExceptionsService from '../domains/sales/PosExceptionsService.js';
import arcaAuthorizationService from '../domains/fiscal/ArcaAuthorizationService.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';
import { applyPaginationHeaders, getPagination } from '../utils/pagination.js';

export const getOrders = catchAsync(async (req, res) => {
    const { client_id, status, shipping_method } = req.query;
    const filters = {};
    if (client_id) filters.client_id = client_id;
    if (status) filters.status = status;
    if (shipping_method) filters.shipping_method = shipping_method;

    const pagination = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const options = { orderBy: 'created_at', order: 'DESC' };

    if (!pagination.enabled) {
        const orders = await salesService.getOrders(filters, options);
        return res.json(orders);
    }

    const result = await salesService.getOrders(filters, {
        ...options,
        limit: pagination.limit,
        offset: pagination.offset,
        includeTotal: true
    });

    applyPaginationHeaders(res, pagination, result.total);
    res.json(result.rows);
});

export const createOrder = catchAsync(async (req, res) => {
    const { idempotency_key: idempotencyKey, ...body } = req.body;
    const orderData = idempotencyKey
        ? {
            ...body,
            external_source: 'pos',
            external_id: idempotencyKey,
            ...(body.total_amount != null ? { external_total_amount: Number(body.total_amount) } : {})
        }
        : body;
    const result = await salesService.createOrder(orderData, req.user?.id, { role: req.user?.role });
    res.json(result);
});

export const posCheckout = catchAsync(async (req, res) => {
    const result = await posCheckoutUseCase.execute(req.body, req.user?.id, { role: req.user?.role });
    res.json(result);
});

export const listPosExceptions = catchAsync(async (req, res) => {
    res.json(await posExceptionsService.list(req.query || {}));
});

export const reviewPosException = catchAsync(async (req, res) => {
    res.json(await posExceptionsService.review(req.params.id, req.body, req.user?.id));
});

export const updateOrderShipping = catchAsync(async (req, res) => {
    res.json(await salesService.updateOrderShipping(req.params.id, req.body, req.user?.id || null));
});

export const updateOrderStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const previous = await salesService.findById(id);
    let updated;
    try {
        updated = await salesService.transitionOrderStatus(id, status, req.user?.id);
    } catch (err) {
        if (err.errorCode === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Pedido no encontrado' });
        }
        if (err.errorCode === 'INVALID_ORDER_TRANSITION') {
            return res.status(409).json({ error: 'invalid_transition', message: err.message });
        }
        if (err.errorCode === 'INVOICED_ORDER_REQUIRES_CREDIT_NOTE') {
            return res.status(409).json({ error: 'credit_note_required', message: err.message });
        }
        throw err;
    }
    if (updated) {
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'UPDATE_ORDER_STATUS',
            entity_type: 'order',
            entity_id: id,
            old_values: previous || null,
            new_values: { status: updated.status },
            ip_address: getRequestIp(req)
        });
    }
    res.json(updated);
});

export const recordPickingEvent = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await salesService.recordPickingEvent(id, req.body, req.user?.id);
    res.json(result);
});

export const dispatchOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updated = await salesService.dispatchOrder(id, req.body, req.user?.id);
    res.json(updated);
});

export const deliverOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const updated = await salesService.deliverOrder(id, req.body, req.user?.id);
    res.json(updated);
});

export const pickOrderItem = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { picked_quantity } = req.body;
    const updated = await salesService.pickOrderItem(id, picked_quantity, req.user?.id);
    res.json(updated);
});

export const getOrderSummary = catchAsync(async (req, res) => {
    const { id } = req.params;
    const data = await salesService.getOrderSummary(id);
    res.json(data);
});

export const getInvoices = catchAsync(async (req, res) => {
    const invoices = await salesService.getInvoices(req.query || {});
    res.json(invoices);
});

export const createInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await salesService.createInvoice(id, req.body, req.user?.id);
    res.json(result);
});

export const checkoutPickupOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await pickupOrderCheckoutUseCase.execute(id, req.body, req.user?.id, { role: req.user?.role });
    res.json(result);
});

export const createManualInvoice = catchAsync(async (req, res) => {
    const result = await salesService.createManualInvoice(req.body, req.user?.id);
    res.json(result);
});

export const getInvoiceById = catchAsync(async (req, res) => {
    const { id } = req.params;
    const invoice = await salesService.getInvoiceById(id);
    if (!invoice) {
        return res.status(404).json({ error: 'not_found', message: 'Factura no encontrada' });
    }
    res.json(invoice);
});

export const authorizeInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await salesService.authorizeInvoice(id, req.user?.id);
    res.json(result);
});

export const registerInvoicePayments = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await financeService.registerInvoicePayments(id, req.body, req.user?.id);
    res.json(result);
});

export const getInvoiceItems = catchAsync(async (req, res) => {
    const { invoice_id } = req.query;
    if (!invoice_id) {
        return res.status(400).json({ error: 'missing_invoice_id', message: 'invoice_id es obligatorio' });
    }
    const rows = await salesService.getInvoiceItems(invoice_id);
    res.json(rows);
});

export const reissueInvoice = catchAsync(async (req, res) => {
    res.json(await salesService.reissueInvoice(req.params.id, req.body, req.user?.id));
});

export const getArcaAlerts = catchAsync(async (req, res) => {
    res.json(await arcaAuthorizationService.listAlerts());
});

export const getTaxConditions = catchAsync(async (req, res) => {
    const rows = await salesService.getTaxConditions();
    res.json(rows);
});
