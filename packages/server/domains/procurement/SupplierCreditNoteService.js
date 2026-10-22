import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import { businessError } from '../../utils/businessError.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { purchaseDocumentAmounts, vatCreditByAccount } from './purchaseDocumentAmounts.js';

/**
 * A supplier's credit note for units its invoice charged beyond the delivery notes (ADR-029). It
 * goes against that invoice: it settles what the invoice left in "Notas de crédito a recibir"
 * (1.1.06.01), reverses its fiscal credit (Factura A or M) and lowers what we owe the supplier.
 */
export class SupplierCreditNoteService {
    async getCreditNotes(filters = {}) {
        const { supplier_id, supplier_invoice_id } = filters;
        let query = `
            SELECT scn.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   si.invoice_type, si.invoice_number
            FROM supplier_credit_notes scn
            JOIN suppliers s ON s.id = scn.supplier_id
            JOIN supplier_invoices si ON si.id = scn.supplier_invoice_id
            WHERE 1=1
        `;
        const params = [];
        if (supplier_id) {
            query += ' AND scn.supplier_id = ?';
            params.push(supplier_id);
        }
        if (supplier_invoice_id) {
            query += ' AND scn.supplier_invoice_id = ?';
            params.push(supplier_invoice_id);
        }
        query += ' ORDER BY scn.issue_date DESC, scn.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createCreditNote(data, userId, ipAddress = null) {
        const { supplier_invoice_id, credit_note_number, issue_date, notes } = data;
        const { vatLines, net, vat, taxes, total } = purchaseDocumentAmounts(data);
        const creatorId = userId || null;
        const id = crypto.randomUUID();

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Lock order as a supplier payment: the invoice, then its supplier. Every note of this
            // invoice waits here, so what is left to receive is read after the earlier ones.
            const [invoiceRows] = await connection.query(
                `SELECT id, supplier_id, invoice_type, invoice_number, status, total_amount, credit_expected_amount
                 FROM supplier_invoices WHERE id = ? FOR UPDATE`,
                [supplier_invoice_id]
            );
            const invoice = invoiceRows[0];
            if (!invoice) {
                throw businessError(404, { error: 'supplier_invoice_not_found', message: 'Factura de proveedor no encontrada.' });
            }
            if (String(invoice.status || '').toLowerCase() === 'cancelled') {
                throw businessError(409, { error: 'supplier_invoice_cancelled', message: 'La factura está anulada.' });
            }
            const [supplierRows] = await connection.query(
                'SELECT id FROM suppliers WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [invoice.supplier_id]
            );
            if (supplierRows.length === 0) {
                throw businessError(404, { error: 'supplier_not_found', message: 'Proveedor no encontrado o eliminado.' });
            }
            // A credit note carries its invoice's letter (A with A, B with B, C with C, M with M).
            const type = data.credit_note_type || invoice.invoice_type;
            if (type !== invoice.invoice_type) {
                throw businessError(400, {
                    error: 'credit_note_type_mismatch',
                    message: `La nota de crédito de una factura ${invoice.invoice_type} también es ${invoice.invoice_type}.`,
                });
            }

            const [appliedRows] = await connection.query(
                `SELECT COALESCE(SUM(applied_amount), 0) AS applied, COALESCE(SUM(total_amount), 0) AS credited
                 FROM supplier_credit_notes WHERE supplier_invoice_id = ?`,
                [supplier_invoice_id]
            );
            const expectedCents = Math.round(Number(invoice.credit_expected_amount || 0) * 100);
            const pendingCents = expectedCents - Math.round(Number(appliedRows[0]?.applied || 0) * 100);
            if (pendingCents <= 0) {
                throw businessError(409, {
                    error: 'no_credit_note_expected',
                    message: `La factura ${invoice.invoice_type} ${invoice.invoice_number} no tiene una nota de crédito a recibir pendiente.`,
                });
            }
            const [existing] = await connection.query(
                'SELECT id FROM supplier_credit_notes WHERE supplier_id = ? AND credit_note_type = ? AND credit_note_number = ? LIMIT 1',
                [invoice.supplier_id, type, credit_note_number]
            );
            if (existing.length > 0) {
                throw businessError(409, {
                    error: 'duplicate_credit_note',
                    message: `La nota de crédito ${type} ${credit_note_number} ya está registrada para este proveedor.`,
                });
            }

            // What the note is worth against 1.1.06.01: its net, plus its VAT on a B or C note (the
            // invoice put that VAT in the cost). Up to what is left to receive; beyond that it is a
            // better price than invoiced (holding result). Less leaves the rest to receive.
            const givesCredit = type === 'A' || type === 'M';
            const baseCents = Math.round(net * 100) + (givesCredit ? 0 : Math.round(vat * 100));
            const appliedCents = Math.min(baseCents, pendingCents);
            const extraCents = baseCents - appliedCents;

            await connection.query(
                `INSERT INTO supplier_credit_notes
                    (id, supplier_id, supplier_invoice_id, credit_note_type, credit_note_number, issue_date,
                     net_amount, vat_amount, other_taxes, total_amount, applied_amount, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, invoice.supplier_id, supplier_invoice_id, type, credit_note_number, issue_date,
                    net, vat, taxes, total, appliedCents / 100, notes || null, creatorId]
            );
            for (const line of vatLines || []) {
                await connection.query(
                    `INSERT INTO supplier_credit_note_vat_lines (id, supplier_credit_note_id, vat_rate, net_amount, vat_amount)
                     VALUES (?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), id, line.vat_rate, line.net, line.vat]
                );
            }

            // The invoice is settled by what was paid and credited.
            const [paidRows] = await connection.query(
                'SELECT COALESCE(SUM(amount), 0) AS paid FROM supplier_payments WHERE supplier_invoice_id = ?',
                [supplier_invoice_id]
            );
            const settledCents = Math.round(Number(paidRows[0]?.paid || 0) * 100)
                + Math.round(Number(appliedRows[0]?.credited || 0) * 100) + Math.round(total * 100);
            const invoiceCents = Math.round(Number(invoice.total_amount || 0) * 100);
            const paymentStatus = settledCents <= 0 ? 'pending' : (settledCents + 1 < invoiceCents ? 'partial' : 'paid');
            await connection.query('UPDATE supplier_invoices SET payment_status = ? WHERE id = ?', [paymentStatus, supplier_invoice_id]);

            // Not a cash movement: an adjustment that lowers what we owe (it may go below zero: a
            // balance in our favour is real and must not vanish).
            await connection.query(
                `INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id, date)
                 VALUES (?, 'adjustment', ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), total, `Nota de crédito ${type} ${credit_note_number} (factura ${invoice.invoice_number})`,
                    id, invoice.supplier_id, issue_date || new Date()]
            );
            await connection.query(
                'UPDATE suppliers SET account_balance = COALESCE(account_balance, 0) - ? WHERE id = ?',
                [total, invoice.supplier_id]
            );

            const rateLines = vatLines || [{ vat_rate: data.vat_rate == null ? 21 : Number(data.vat_rate), net, vat }];
            const creditByAccount = givesCredit ? vatCreditByAccount(rateLines) : new Map();
            const entryId = await accountingService.createJournalEntryIfAny(connection, {
                date: issue_date || new Date(),
                description: `Nota de crédito de proveedor ${type} ${credit_note_number}`,
                reference_type: 'supplier_credit_note',
                reference_id: id,
                lines: [
                    { account_code: ACCOUNTS.SUPPLIERS, debit: total, credit: 0, notes: 'Proveedores - Cuenta Corriente' },
                    {
                        account_code: ACCOUNTS.CREDIT_NOTES_TO_RECEIVE,
                        debit: 0,
                        credit: appliedCents / 100,
                        notes: `Nota de crédito a recibir de la factura ${invoice.invoice_type} ${invoice.invoice_number}`,
                    },
                    { account_code: ACCOUNTS.HOLDING_RESULT, debit: 0, credit: extraCents / 100, notes: 'Crédito mayor al esperado' },
                    ...[...creditByAccount.entries()].map(([account_code, credit]) => ({
                        account_code, debit: 0, credit: credit.amount, notes: `IVA Crédito Fiscal ${[...credit.rates].join(' / ')}% - nota de crédito`,
                    })),
                    ...(taxes > 0 ? [{ account_code: ACCOUNTS.WITHHOLDINGS, debit: 0, credit: taxes, notes: 'Percepciones - nota de crédito' }] : []),
                ],
            });

            const leftCents = pendingCents - appliedCents;
            await auditService.log({
                user_id: creatorId,
                action: 'CREATE_SUPPLIER_CREDIT_NOTE',
                entity_type: 'supplier_credit_note',
                entity_id: id,
                new_values: {
                    id,
                    supplier_id: invoice.supplier_id,
                    supplier_invoice_id,
                    credit_note_type: type,
                    credit_note_number,
                    issue_date,
                    net_amount: net,
                    vat_amount: vat,
                    other_taxes: taxes,
                    total_amount: total,
                    applied_amount: appliedCents / 100,
                    holding_result: extraCents / 100,
                    credit_left: leftCents / 100,
                    journal_entry_id: entryId,
                },
                ip_address: ipAddress,
            }, connection);
            await connection.commit();
            return {
                id,
                success: true,
                total_amount: total,
                applied_amount: appliedCents / 100,
                holding_result: extraCents / 100,
                credit_left: leftCents / 100,
                payment_status: paymentStatus,
            };
        } catch (err) {
            await connection.rollback();
            if (err?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, { error: 'duplicate_credit_note', message: 'Esa nota de crédito ya está registrada para este proveedor.' });
            }
            if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando esta factura. Reintentá en unos segundos.' });
            }
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new SupplierCreditNoteService();
