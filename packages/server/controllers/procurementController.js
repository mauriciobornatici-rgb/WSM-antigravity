import { PERMISSIONS, hasPermission } from '@wsm/common';
import catchAsync from '../utils/catchAsync.js';
import inventoryService from '../services/inventory.service.js';
import getRequestIp from '../utils/requestIp.js';
import purchaseOrderService from '../domains/procurement/PurchaseOrderService.js';
import receptionService from '../domains/procurement/ReceptionService.js';
import qualityCheckService from '../domains/procurement/QualityCheckService.js';
import supplierInvoiceService from '../domains/procurement/SupplierInvoiceService.js';
import supplierReturnService from '../domains/procurement/SupplierReturnService.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';

export const getPurchaseOrders = catchAsync(async (req, res) => {
    const orders = await purchaseOrderService.getPurchaseOrders(req.query);
    res.json(orders);
});

export const getPurchaseOrder = catchAsync(async (req, res) => {
    const order = await purchaseOrderService.getPurchaseOrder(req.params.id);
    res.json(order);
});

export const createPurchaseOrder = catchAsync(async (req, res) => {
    const result = await purchaseOrderService.createPurchaseOrder(req.body, req.user?.id, getRequestIp(req));
    res.json(result);
});

export const updatePurchaseOrderStatus = catchAsync(async (req, res) => {
    const order = await purchaseOrderService.updatePurchaseOrderStatus(
        req.params.id,
        req.body.status,
        req.user?.id,
        getRequestIp(req)
    );
    res.json(order);
});

export const getReceptions = catchAsync(async (req, res) => {
    const receptions = await receptionService.getReceptions(req.query);
    res.json(receptions);
});

export const createReception = catchAsync(async (req, res) => {
    // Without an order, a cost other than the product's changes it: only with PRODUCTS_COST_EDIT (D5).
    const result = await receptionService.createReception(req.body, req.user?.id, getRequestIp(req), {
        canEditCost: hasPermission(req.user?.role, PERMISSIONS.PRODUCTS_COST_EDIT),
    });
    res.json(result);
});

export const approveReception = catchAsync(async (req, res) => {
    const { id } = req.params;
    // The approver is always the authenticated user; a client-supplied approved_by is ignored.
    const approverId = req.user?.id || null;

    try {
        await inventoryService.processReceptionApproval(id, {
            approvedBy: approverId,
            actorUserId: req.user?.id || approverId || null,
            ipAddress: getRequestIp(req)
        });
    } catch (err) {
        if (err.errorCode === 'RECEPTION_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Recepcion no encontrada' });
        }
        if (err.errorCode === 'RECEPTION_ALREADY_APPROVED') {
            return res.status(400).json({ error: 'reception_already_approved', message: 'Esta recepcion ya fue aprobada' });
        }
        if (err.errorCode === 'RECEPTION_HAS_NO_ITEMS') {
            return res.status(400).json({ error: 'reception_without_items', message: 'La recepcion no contiene items' });
        }
        if (err.errorCode === 'RECEPTION_QC_INCOMPLETE' || err.errorCode === 'RECEPTION_QC_INVALID') {
            return res.status(409).json({ error: 'quality_check_incomplete', message: err.message });
        }
        if (err.errorCode === 'RECEPTION_DUPLICATE_PRODUCT_ITEMS') {
            return res.status(409).json({ error: 'duplicate_reception_product', message: err.message });
        }
        if (err.errorCode === 'RECEPTION_PURCHASE_ORDER_CANCELLED') {
            return res.status(409).json({ error: 'purchase_order_cancelled', message: err.message });
        }
        throw err;
    }

    res.json({ success: true, message: 'Recepcion aprobada y stock actualizado' });
});

export const getReturns = catchAsync(async (req, res) => {
    const returns = await supplierReturnService.getReturns(req.query);
    res.json(returns);
});

export const getSupplierReturns = getReturns;

// ADR-028: the credit of a return is the last invoiced cost; only purchasing changes it.
const canSetReturnCost = (req) => hasPermission(req.user?.role, PERMISSIONS.PROCUREMENT_MANAGE);

export const getReturnSuggestedCosts = catchAsync(async (req, res) => {
    // The parsed query (product_ids split): in Express 5 req.query is re-read from the URL.
    const query = req.validatedQuery || req.query;
    const { supplier_id: supplierId, reception_id: receptionId } = query;
    const productIds = Array.isArray(query.product_ids)
        ? query.product_ids
        : String(query.product_ids || '').split(',').filter(Boolean);
    res.json(await supplierReturnService.suggestedCosts({ supplierId, receptionId, productIds }));
});

export const createReturn = catchAsync(async (req, res) => {
    const result = await supplierReturnService.createReturn(req.body, req.user?.id, getRequestIp(req), {
        canSetCost: canSetReturnCost(req),
    });
    res.json(result);
});

export const approveReturn = catchAsync(async (req, res) => {
    const { id } = req.params;
    try {
        const result = await supplierReturnService.approveSupplierReturn(id, req.user?.id, getRequestIp(req));
        res.json(result);
    } catch (err) {
        if (err.errorCode === 'RETURN_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Devolucion no encontrada' });
        }
        if (err.errorCode === 'RETURN_ALREADY_APPROVED') {
            return res.status(400).json({ error: 'already_approved', message: 'La devolucion ya fue aprobada' });
        }
        throw err;
    }
});

export const getSupplierPayments = catchAsync(async (req, res) => {
    const rows = await supplierPaymentService.getSupplierPayments(req.query.supplier_id);
    res.json(rows);
});

export const createSupplierPayment = catchAsync(async (req, res) => {
    try {
        const result = await supplierPaymentService.createSupplierPayment(req.body, req.user?.id, getRequestIp(req));
        res.json(result);
    } catch (err) {
        if (err.errorCode === 'MISSING_SUPPLIER') {
            return res.status(400).json({ error: 'missing_supplier', message: err.message });
        }
        if (err.errorCode === 'MISSING_PAYMENTS') {
            return res.status(400).json({ error: 'missing_payments', message: err.message });
        }
        throw err;
    }
});

export const createQualityCheck = catchAsync(async (req, res) => {
    const result = await qualityCheckService.createQualityCheck(req.body, req.user?.id, getRequestIp(req));
    res.json(result);
});

export const exportIVACompras = catchAsync(async (req, res) => {
    const records = await supplierInvoiceService.getPurchasesVatBook();
    res.json(records);
});
