import salesService from '../services/sales.service.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';

export const getOrders = catchAsync(async (req, res) => {
    const { client_id, status } = req.query;
    const filters = {};
    if (client_id) filters.client_id = client_id;
    if (status) filters.status = status;
    const orders = await salesService.getOrders(filters, { orderBy: 'created_at', order: 'DESC' });
    res.json(orders);
});

export const createOrder = catchAsync(async (req, res) => {
    const result = await salesService.createOrder(req.body, req.user?.id);
    res.json(result);
});

export const updateOrderStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const previous = await salesService.findById(id);
    let updated;
    try {
        updated = await salesService.transitionOrderStatus(id, status);
    } catch (err) {
        if (err.errorCode === 'ORDER_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Pedido no encontrado' });
        }
        if (err.errorCode === 'INVALID_ORDER_TRANSITION') {
            return res.status(409).json({ error: 'invalid_transition', message: err.message });
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

export const createManualInvoice = catchAsync(async (req, res) => {
    const result = await salesService.createManualInvoice(req.body, req.user?.id);
    res.json(result);
});

export const authorizeInvoice = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await salesService.authorizeInvoice(id, req.user?.id);
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

export const getTaxConditions = catchAsync(async (req, res) => {
    const rows = await salesService.getTaxConditions();
    res.json(rows);
});
