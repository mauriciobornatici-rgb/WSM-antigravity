import catchAsync from '../utils/catchAsync.js';
import getRequestIp from '../utils/requestIp.js';
import financeService from '../services/finance.service.js';
import cashRegisterService from '../services/cashRegister.service.js';

export const getTransactions = catchAsync(async (req, res) => {
    const rows = await financeService.getTransactions(req.query);
    res.json(rows);
});

export const getCashRegisters = catchAsync(async (req, res) => {
    const rows = await cashRegisterService.listCashRegisters();
    res.json(rows);
});

export const getCashRegisterTransactions = catchAsync(async (req, res) => {
    const rows = await cashRegisterService.listRegisterPayments(req.params.id);
    res.json(rows);
});

export const getOpenShift = catchAsync(async (req, res) => {
    const result = await cashRegisterService.getOpenShift(req.params.id);
    res.json(result);
});

export const openShift = catchAsync(async (req, res) => {
    const result = await cashRegisterService.openShift(req.params.id, {
        openingBalance: req.body.opening_balance,
        // The actor is always the authenticated user; a client-supplied opened_by is ignored.
        openedBy: req.user?.id || null,
        ipAddress: getRequestIp(req)
    });
    res.json(result);
});

export const closeShift = catchAsync(async (req, res) => {
    const result = await cashRegisterService.closeShift(req.params.id, {
        actualBalance: req.body.actual_balance,
        notes: req.body.notes,
        // The actor is always the authenticated user; a client-supplied closed_by is ignored.
        closedBy: req.user?.id || null,
        ipAddress: getRequestIp(req)
    });
    res.json(result);
});

export const addShiftPayment = catchAsync(async (req, res) => {
    const { order_id, payment_method, amount, type } = req.body;
    const result = await cashRegisterService.addShiftPayment(req.params.id, {
        orderId: order_id,
        paymentMethod: payment_method,
        amount,
        type,
        userId: req.user?.id || null,
        ipAddress: getRequestIp(req)
    });
    res.json(result);
});

export const createCashTransaction = catchAsync(async (req, res) => {
    const { register_id, type, amount, reason, notes } = req.body;
    const result = await cashRegisterService.createCashTransaction({
        registerId: register_id,
        type,
        amount,
        reason,
        notes,
        userId: req.user?.id || null,
        ipAddress: getRequestIp(req)
    });
    res.json(result);
});

export const getPendingInvoices = catchAsync(async (req, res) => {
    const rows = await financeService.getPendingInvoices(req.query.client_id);
    res.json(rows);
});

export const getFiscalSalesStatus = catchAsync(async (_req, res) => {
    const rows = await financeService.getFiscalSalesStatus();
    res.json(rows);
});
export const registerBulkPayments = catchAsync(async (req, res) => {
    const userId = req.user?.id || null;
    const result = await financeService.registerBulkInvoicePayments(req.body, userId);
    res.json(result);
});

export const getCustomerChecks = catchAsync(async (req, res) => {
    const rows = await financeService.getCustomerChecks(req.query || {});
    res.json(rows);
});

export const getCustomerCheck = catchAsync(async (req, res) => {
    const row = await financeService.getCustomerCheck(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Cheque no encontrado' });
    res.json(row);
});

export const updateCustomerCheckStatus = catchAsync(async (req, res) => {
    const row = await financeService.updateCustomerCheckStatus(req.params.id, req.body, req.user?.id || null);
    res.json(row);
});

export const getCardSettlements = catchAsync(async (req, res) => {
    res.json(await financeService.getCardSettlements());
});

export const createCardSettlement = catchAsync(async (req, res) => {
    const result = await financeService.createCardSettlement(req.body, req.user?.id || null, getRequestIp(req));
    res.status(result.idempotent_replay ? 200 : 201).json(result);
});

export const getOutgoingChecks = catchAsync(async (req, res) => {
    const rows = await financeService.getOutgoingChecks(req.query || {});
    res.json(rows);
});

export const getOutgoingCheck = catchAsync(async (req, res) => {
    const row = await financeService.getOutgoingCheck(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Cheque emitido no encontrado' });
    res.json(row);
});

export const updateOutgoingCheckStatus = catchAsync(async (req, res) => {
    const row = await financeService.updateOutgoingCheckStatus(req.params.id, req.body, req.user?.id || null);
    res.json(row);
});
