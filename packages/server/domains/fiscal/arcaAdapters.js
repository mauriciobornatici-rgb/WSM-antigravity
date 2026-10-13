import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import pool from '../../config/db.js';
import { businessError } from '../../utils/businessError.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';

// ADR-020: what the ARCA authorization flow needs to know about each kind of document.

const LETTER_BY_NOTE_TYPE = new Map([[3, 'A'], [8, 'B'], [13, 'C']]);

export const invoiceArcaAdapter = {
    table: 'invoices',
    label: 'La factura',
    pendingStatus: 'issued',

    async prepare(doc) {
        // A ticket is not an electronic voucher: it is authorized locally.
        if (String(doc.invoice_type || '').toUpperCase() === 'TK') return { local: true };
        const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [doc.id]);
        return { voucher: doc, items };
    },

    // The other local invoice (authorized or in conflict) that holds this ARCA number, if any.
    async numberHolder(db, doc, request, number) {
        const [rows] = await db.query(
            `SELECT id, cae FROM invoices WHERE invoice_type = ? AND point_of_sale = ? AND invoice_number = ?
               AND status IN ('authorized', 'arca_conflict') AND id <> ? LIMIT 1`,
            [doc.invoice_type, request.pos, number, doc.id]
        );
        return rows[0] || null;
    },

    async store(connection, doc, result, request, userId) {
        if (result.local) {
            await connection.query("UPDATE invoices SET status = 'authorized', arca_last_error = NULL WHERE id = ?", [doc.id]);
        } else {
            const pos = request.pos;
            const number = Number(result.number);
            const scope = `invoice:${String(doc.invoice_type).toUpperCase()}:${pos}`;
            // The number ARCA gave may be the provisional number of another invoice not
            // authorized yet: that one (not a fiscal document yet) moves to a new provisional number.
            const [holders] = await connection.query(
                'SELECT id, status, invoice_number FROM invoices WHERE invoice_type = ? AND point_of_sale = ? AND invoice_number = ? AND id <> ? FOR UPDATE',
                [doc.invoice_type, pos, number, doc.id]
            );
            for (const holder of holders) {
                if (holder.status === 'authorized' || holder.status === 'arca_conflict') {
                    throw businessError(409, {
                        error: 'arca_number_conflict',
                        message: `El número ${number} ya pertenece a otra factura autorizada: revisá la numeración del punto de venta.`
                    });
                }
                const [[maxRow]] = await connection.query(
                    'SELECT MAX(invoice_number) AS max_number FROM invoices WHERE invoice_type = ? AND point_of_sale = ?',
                    [doc.invoice_type, pos]
                );
                const provisional = await nextDocumentSequence(connection, scope, Math.max(Number(maxRow?.max_number || 0), number));
                await connection.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [provisional, holder.id]);
                await auditService.log({
                    user_id: userId,
                    action: 'INVOICE_PROVISIONAL_NUMBER_MOVED',
                    entity_type: 'invoice',
                    entity_id: holder.id,
                    old_values: { invoice_number: holder.invoice_number },
                    new_values: { invoice_number: provisional, reason: `ARCA asignó el ${number} a otra factura` }
                }, connection);
            }
            await connection.query(
                `UPDATE invoices SET status = 'authorized', cae = ?, cae_expiration_date = ?, invoice_number = ?, point_of_sale = ?,
                    arca_expected_number = NULL, arca_pos = NULL, arca_voucher_type = NULL, arca_last_error = NULL WHERE id = ?`,
                [result.cae, result.cae_expiration_date, number, pos, doc.id]
            );
            // New provisional numbers continue after ARCA's.
            await connection.query('INSERT IGNORE INTO document_sequences (scope, `last_value`) VALUES (?, 0)', [scope]);
            await connection.query('UPDATE document_sequences SET `last_value` = GREATEST(`last_value`, ?) WHERE scope = ?', [number, scope]);
        }
        await accountingService.postInvoiceAccountingEntries(connection, doc.id);
        await auditService.log({
            user_id: userId,
            action: 'AUTHORIZE_INVOICE',
            entity_type: 'invoice',
            entity_id: doc.id,
            new_values: {
                cae: result.cae,
                cae_expiration_date: result.cae_expiration_date,
                invoice_number: result.local ? doc.invoice_number : result.number,
                ...(result.recovered ? { recovered_from_arca: true } : {})
            }
        }, connection);
    },

    async load(id) {
        const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
        const invoice = rows[0] || {};
        const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [id]);
        invoice.items = items;
        return invoice;
    },
};

export const creditNoteArcaAdapter = {
    table: 'credit_notes',
    label: 'La nota de crédito',
    pendingStatus: 'issued',

    async prepare(doc) {
        const { creditNotesService } = await import('../../services/warranties.service.js');
        // ADR-014: a credit note is authorized against the invoice it corrects.
        const originalInvoice = await creditNotesService._invoiceCorrectedBy(doc);
        if (!originalInvoice) {
            throw businessError(409, {
                error: 'credit_note_without_invoice',
                message: 'La nota de crédito no está asociada a una factura: no puede autorizarse en ARCA.'
            });
        }
        // A ticket is not an electronic voucher: its note is internal, nothing to send.
        const invoiceLetter = String(originalInvoice.invoice_type || '').toUpperCase();
        if (invoiceLetter === 'TK') return { local: true };
        if (!originalInvoice.cae) {
            throw businessError(409, {
                error: 'invoice_not_authorized',
                message: 'Autorizá primero en ARCA la factura que corrige esta nota de crédito.'
            });
        }
        // The note carries the letter of the invoice it corrects (ARCA rejects a mismatch).
        const noteLetter = ['A', 'B', 'C'].includes(invoiceLetter)
            ? invoiceLetter
            : (['A', 'B', 'C'].includes(doc.credit_note_type) ? doc.credit_note_type : 'B');
        return {
            voucher: {
                id: doc.id,
                invoice_type: `NC_${noteLetter}`,
                client_tax_id: originalInvoice.client_tax_id || null,
                client_tax_condition: originalInvoice.client_tax_condition || null,
                associated_voucher: {
                    invoice_type: invoiceLetter,
                    point_of_sale: originalInvoice.point_of_sale,
                    invoice_number: originalInvoice.invoice_number,
                }
            },
            items: await creditNotesService._creditNoteVoucherItems(doc, originalInvoice),
        };
    },

    // The other local credit note that holds this ARCA number, if any.
    async numberHolder(db, doc, request, number) {
        const [rows] = await db.query(
            `SELECT id, cae FROM credit_notes WHERE credit_note_type = ? AND point_of_sale = ? AND arca_voucher_number = ?
               AND id <> ? LIMIT 1`,
            [LETTER_BY_NOTE_TYPE.get(Number(request.voucherType)) || 'B', request.pos, number, doc.id]
        );
        return rows[0] || null;
    },

    async store(connection, doc, result, request, userId) {
        if (result.local) {
            await connection.query("UPDATE credit_notes SET status = 'authorized', arca_last_error = NULL WHERE id = ?", [doc.id]);
        } else {
            await connection.query(
                `UPDATE credit_notes SET status = 'authorized', cae = ?, cae_expiration_date = ?, arca_voucher_number = ?,
                    point_of_sale = ?, credit_note_type = ?, arca_expected_number = NULL, arca_pos = NULL, arca_voucher_type = NULL,
                    arca_last_error = NULL WHERE id = ?`,
                [result.cae, result.cae_expiration_date, Number(result.number), request.pos,
                    LETTER_BY_NOTE_TYPE.get(Number(request.voucherType)) || doc.credit_note_type, doc.id]
            );
        }
        await auditService.log({
            user_id: userId,
            action: 'AUTHORIZE_CREDIT_NOTE',
            entity_type: 'credit_note',
            entity_id: doc.id,
            new_values: {
                cae: result.cae,
                cae_expiration_date: result.cae_expiration_date,
                arca_voucher_number: result.local ? null : Number(result.number),
                ...(result.recovered ? { recovered_from_arca: true } : {})
            }
        }, connection);
    },

    async load(id) {
        const [rows] = await pool.query('SELECT * FROM credit_notes WHERE id = ?', [id]);
        return rows[0];
    },
};
