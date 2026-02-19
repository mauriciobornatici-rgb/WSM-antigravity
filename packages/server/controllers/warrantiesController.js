import { warrantiesService, returnsService, creditNotesService } from '../services/warranties.service.js';
import catchAsync from '../utils/catchAsync.js';
import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';
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
    const result = await warrantiesService.update(id, req.body);
    res.json(result);
});

// CLIENT RETURNS
export const getReturns = catchAsync(async (req, res) => {
    const returns = await returnsService.getReturns(req.query);
    res.json(returns);
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
        result = await returnsService.approveReturn(id, req.user?.id || null);
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

    await auditService.log({
        user_id: req.user?.id || null,
        action: 'APPROVE_CLIENT_RETURN',
        entity_type: 'client_return',
        entity_id: id,
        new_values: result,
        ip_address: getRequestIp(req)
    });

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
    const id = crypto.randomUUID();
    const allowedReferenceTypes = new Set(['return', 'warranty', 'discount', 'other']);
    const requestedReferenceType = req.body.reference_type || 'other';
    const referenceType = requestedReferenceType === 'manual'
        ? 'other'
        : (allowedReferenceTypes.has(requestedReferenceType) ? requestedReferenceType : 'other');

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const year = new Date().getFullYear();
        const prefix = `NC-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM credit_notes
             WHERE number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const seq = await nextDocumentSequence(connection, `credit_note:${year}`, maxExisting);
        const number = `${prefix}${String(seq).padStart(4, '0')}`;

        await connection.query(
            `INSERT INTO credit_notes (
                id, number, client_id, customer_name, reference_type, reference_id, amount, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
            [
                id,
                number,
                req.body.client_id,
                req.body.customer_name || null,
                referenceType,
                req.body.reference_id || null,
                Number(req.body.amount || 0),
                req.body.notes || null
            ]
        );

        await connection.commit();

        const result = {
            id,
            number,
            client_id: req.body.client_id,
            customer_name: req.body.customer_name || null,
            reference_type: referenceType,
            reference_id: req.body.reference_id || null,
            amount: Number(req.body.amount || 0),
            status: 'issued'
        };

        await auditService.log({
            user_id: req.user?.id || null,
            action: 'CREATE_CREDIT_NOTE',
            entity_type: 'credit_note',
            entity_id: id,
            new_values: result,
            ip_address: getRequestIp(req)
        });

        res.json(result);
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});
