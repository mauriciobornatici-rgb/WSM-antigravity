import stockAuditService from '../services/stockAudit.service.js';
import catchAsync from '../utils/catchAsync.js';

function redactBlindCount(audit) {
    if (!audit || audit.status !== 'in_progress' || !audit.blind_count) return audit;
    const redacted = {
        ...audit,
        exact_items: undefined,
        variance_units: undefined,
        accuracy_percent: undefined,
    };
    if (Array.isArray(audit.items)) {
        redacted.items = audit.items.map((item) => ({
            ...item,
            expected_quantity: undefined,
            variance: undefined,
        }));
    }
    return redacted;
}

export const getStockAuditDashboard = catchAsync(async (req, res) => {
    const dashboard = await stockAuditService.getDashboard(req.query);
    res.json({
        ...dashboard,
        sessions: dashboard.sessions.map(redactBlindCount),
    });
});

export const getStockAudit = catchAsync(async (req, res) => {
    const audit = await stockAuditService.getSession(req.params.id);
    res.json(redactBlindCount(audit));
});

export const createStockAudit = catchAsync(async (req, res) => {
    const audit = await stockAuditService.createSession(req.body, req.user?.id);
    res.status(201).json(redactBlindCount(audit));
});

export const countStockAuditItem = catchAsync(async (req, res) => {
    const audit = await stockAuditService.countItem(req.params.id, req.body, req.user?.id);
    res.json(redactBlindCount(audit));
});

export const completeStockAudit = catchAsync(async (req, res) => {
    const audit = await stockAuditService.completeSession(req.params.id, req.user?.id);
    res.json(audit);
});

export const cancelStockAudit = catchAsync(async (req, res) => {
    const audit = await stockAuditService.cancelSession(req.params.id, req.user?.id);
    res.json(audit);
});

export const applyStockAuditAdjustments = catchAsync(async (req, res) => {
    const audit = await stockAuditService.applyAdjustments(req.params.id, req.user?.id);
    res.json(audit);
});
