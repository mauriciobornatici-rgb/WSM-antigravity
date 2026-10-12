import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import catchAsync from '../utils/catchAsync.js';
import crypto from 'crypto';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';

// WARRANTIY CLAIMS
export const getWarranties = catchAsync(async (req, res) => {
    const warranties = await warrantiesService.getWarranties(req.query);
    res.json(warranties);
});

export const createWarranty = catchAsync(async (req, res) => {
    const id = crypto.randomUUID();
    const data = { id, ...req.body, status: 'initiated' };
    const result = await warrantiesService.create(data);
    res.json(result);
});

export const updateWarrantyStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const result = await warrantiesService.updateWarrantyStatus(id, req.body, req.user?.id || null, getRequestIp(req));
    res.json(result);
});

// CLIENT RETURNS
export const getReturns = catchAsync(async (req, res) => {
    const returns = await returnsService.getReturns(req.query);
    res.json(returns);
});

export const getReturnsAnalytics = catchAsync(async (req, res) => {
    const analytics = await returnsService.getReturnsAnalytics();
    res.json(analytics);
});

export const createReturn = catchAsync(async (req, res) => {
    // Service handles transaction
    const result = await returnsService.createReturn(req.body);
    res.json(result);
});

export const approveReturn = catchAsync(async (req, res) => {
    const { id } = req.params;
    let result;
    try {
        result = await returnsService.approveReturn(id, req.user?.id || null, getRequestIp(req));
    } catch (err) {
        if (err.errorCode === 'RETURN_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Devolucion no encontrada' });
        }
        if (err.errorCode === 'RETURN_ALREADY_APPROVED') {
            return res.status(409).json({ error: 'already_approved', message: 'La devolucion ya fue aprobada' });
        }
        if (err.errorCode === 'RETURN_INVALID_STATE') {
            return res.status(400).json({ error: 'invalid_state', message: 'La devolucion no puede aprobarse en su estado actual' });
        }
        if (err.errorCode === 'RETURN_WITHOUT_ITEMS') {
            return res.status(400).json({ error: 'missing_items', message: 'La devolucion no tiene items para aprobar' });
        }
        if (err.errorCode === 'RETURN_TOTAL_INVALID') {
            return res.status(400).json({ error: 'invalid_total', message: 'El total de la devolucion no permite emitir nota de credito' });
        }
        throw err;
    }

    res.json({
        success: true,
        message: `Devolucion aprobada. Nota de credito ${result.credit_note_number} emitida.`,
        ...result
    });
});

// CREDIT NOTES
export const getCreditNotes = catchAsync(async (req, res) => {
    const notes = await creditNotesService.getCreditNotes(req.query);
    res.json(notes);
});

export const createCreditNote = catchAsync(async (req, res) => {
    const result = await creditNotesService.createManualCreditNote(req.body, req.user?.id, getRequestIp(req));
    res.json(result);
});

export const authorizeCreditNote = catchAsync(async (req, res) => {
    const { id } = req.params;
    let result;
    try {
        result = await creditNotesService.authorizeCreditNote(id, req.user?.id || null);
    } catch (err) {
        if (err.errorCode === 'CREDIT_NOTE_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Nota de crédito no encontrada' });
        }
        throw err;
    }

    await auditService.log({
        user_id: req.user?.id || null,
        action: 'AUTHORIZE_CREDIT_NOTE',
        entity_type: 'credit_note',
        entity_id: id,
        new_values: result,
        ip_address: getRequestIp(req)
    });

    res.json({
        success: true,
        message: `Nota de crédito autorizada exitosamente con CAE.`,
        ...result
    });
});
