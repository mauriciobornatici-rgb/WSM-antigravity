import catchAsync from '../utils/catchAsync.js';
import getRequestIp from '../utils/requestIp.js';
import financeService from '../services/finance.service.js';
import supplierInvoiceService from '../domains/procurement/SupplierInvoiceService.js';
import supplierCreditNoteService from '../domains/procurement/SupplierCreditNoteService.js';

export const getSupplierInvoices = catchAsync(async (req, res) => {
    const rows = await supplierInvoiceService.getSupplierInvoices(req.validatedQuery || req.query);
    res.json(rows);
});

export const createSupplierInvoice = catchAsync(async (req, res) => {
    const result = await supplierInvoiceService.createSupplierInvoice(req.body, req.user?.id, getRequestIp(req));
    res.status(201).json(result);
});

export const getPendingSupplierInvoices = catchAsync(async (req, res) => {
    const rows = await supplierInvoiceService.getPendingSupplierInvoices(req.query);
    res.json(rows);
});

// ADR-029: the supplier's credit notes for units its invoices charged of more.
export const getSupplierCreditNotes = catchAsync(async (req, res) => {
    const rows = await supplierCreditNoteService.getCreditNotes(req.validatedQuery || req.query);
    res.json(rows);
});

export const createSupplierCreditNote = catchAsync(async (req, res) => {
    const result = await supplierCreditNoteService.createCreditNote(req.body, req.user?.id, getRequestIp(req));
    res.status(201).json(result);
});

export const registerBulkSupplierPayments = catchAsync(async (req, res) => {
    const userId = req.user?.id || null;
    const result = await financeService.registerBulkSupplierPayments(req.body, userId);
    res.json(result);
});