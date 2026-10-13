import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import purchaseOrderService from './PurchaseOrderService.js';
import { businessError } from '../../utils/businessError.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { vatCreditAccount } from '../../utils/vatAccounts.js';

// What a supplier invoice buys (ADR-017): goods go to inventory, freight and other expenses
// to their expense accounts.
const PURCHASE_ACCOUNTS = Object.freeze({
    goods: { code: '1.1.04.01', notes: 'Inventario / Bienes de Cambio' },
    shipping: { code: '5.1.02.06', notes: 'Fletes y envíos' },
    expense: { code: '5.1.02.01', notes: 'Gastos generales' },
});

export class SupplierInvoiceService {
    async getSupplierInvoices(filters = {}) {
        const { supplier_id, status } = filters;
        let query = `
            SELECT si.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   r.reception_number, po.po_number
            FROM supplier_invoices si
            LEFT JOIN suppliers s ON si.supplier_id = s.id
            LEFT JOIN receptions r ON si.reception_id = r.id
            LEFT JOIN purchase_orders po ON si.purchase_order_id = po.id
            WHERE 1=1
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND si.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND si.status = ?';
            params.push(status);
        }
        query += ' ORDER BY si.issue_date DESC, si.created_at DESC';

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createSupplierInvoice(data, userId, ipAddress = null) {
        const {
            invoice_number,
            invoice_type,
            supplier_id,
            reception_id,
            purchase_order_id,
            issue_date,
            due_date,
            net_amount,
            vat_amount,
            other_taxes,
            total_amount,
            notes
        } = data;

        const id = crypto.randomUUID();
        // ADR-019: one invoice may cover one or several delivery notes (receptions).
        const receptionIds = [...new Set([...(Array.isArray(data.reception_ids) ? data.reception_ids : []), reception_id].filter(Boolean))];
        // ADR-017: an invoice with several VAT rates comes as one line per rate.
        const vatLines = Array.isArray(data.vat_lines) && data.vat_lines.length > 0
            ? data.vat_lines.map((line) => ({
                vat_rate: Number(line.vat_rate),
                net: Math.round(Number(line.net_amount || 0) * 100) / 100,
                vat: Math.round(Number(line.vat_amount || 0) * 100) / 100,
            }))
            : null;
        const net = vatLines
            ? vatLines.reduce((sum, line) => sum + Math.round(line.net * 100), 0) / 100
            : Math.round(Number(net_amount || 0) * 100) / 100;
        const vat = vatLines
            ? vatLines.reduce((sum, line) => sum + Math.round(line.vat * 100), 0) / 100
            : Math.round(Number(vat_amount || 0) * 100) / 100;
        if (vatLines && vatLines.some((line) => line.vat > 0 && line.vat_rate === 0)) {
            throw businessError(400, { error: 'invalid_vat_rate', message: 'Una línea con IVA no puede tener alícuota 0 %.' });
        }
        // AUD-006: each line's VAT must match its rate (a few cents of rounding per item are
        // allowed), and the header amounts, when sent, must be the sums of the lines.
        for (const line of vatLines || []) {
            const expected = line.net * line.vat_rate / 100;
            if (line.vat_rate > 0 && Math.abs(line.vat - expected) > Math.max(0.05, line.net * 0.001)) {
                throw businessError(400, {
                    error: 'invalid_vat_line',
                    message: `El IVA de la línea al ${line.vat_rate}% (${line.vat.toFixed(2)}) no corresponde a su neto (${expected.toFixed(2)}).`
                });
            }
        }
        if (vatLines && ((net_amount != null && Math.round(Number(net_amount) * 100) !== Math.round(net * 100))
            || (vat_amount != null && Math.round(Number(vat_amount) * 100) !== Math.round(vat * 100)))) {
            throw businessError(400, {
                error: 'invalid_invoice_total',
                message: 'El neto y el IVA del comprobante deben ser la suma de sus alícuotas.'
            });
        }
        if (!(net > 0)) {
            throw businessError(400, { error: 'invalid_net_amount', message: 'El neto del comprobante debe ser mayor a cero.' });
        }
        const purchaseKind = data.purchase_kind || 'goods';
        if (purchaseKind !== 'goods' && (receptionIds.length > 0 || purchase_order_id)) {
            throw businessError(400, {
                error: 'invalid_purchase_kind',
                message: 'Una factura vinculada a una recepción u orden de compra es de mercadería.'
            });
        }
        const taxes = Math.round(Number(other_taxes || 0) * 100) / 100;
        const total = Math.round(Number(total_amount || (net + vat + taxes)) * 100) / 100;
        const creatorId = userId || null;
        // The total is what we owe: it must be the sum of its parts or the entry would not
        // balance (a typed total that disagrees used to post an unbalanced purchase).
        const partsCents = Math.round(net * 100) + Math.round(vat * 100) + Math.round(taxes * 100);
        if (Math.round(total * 100) !== partsCents) {
            throw businessError(400, {
                error: 'invalid_invoice_total',
                message: `El total (${total.toFixed(2)}) no coincide con neto + IVA + percepciones (${(partsCents / 100).toFixed(2)}).`
            });
        }
        if (vat > 0 && data.vat_rate != null && Number(data.vat_rate) === 0) {
            throw businessError(400, {
                error: 'invalid_vat_rate',
                message: 'La factura tiene IVA: elegí su alícuota (0 % es solo para comprobantes sin IVA).'
            });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1. Check for duplicates (invoice number + type per supplier)
            const [existing] = await connection.query(
                'SELECT id FROM supplier_invoices WHERE supplier_id = ? AND invoice_type = ? AND invoice_number = ? LIMIT 1',
                [supplier_id, invoice_type, invoice_number]
            );
            if (existing.length > 0) {
                // The catch below rolls the transaction back; the controller answers with responseBody.
                const message = `La factura ${invoice_type} ${invoice_number} ya se encuentra registrada para este proveedor.`;
                throw businessError(409, { error: 'duplicate_invoice', message });
            }

            // ADR-019: the delivery notes must be this supplier's and not invoiced yet. Locked so
            // two invoices loaded at the same time cannot both take the same delivery note (the
            // unique key on the link table is the last guard).
            let receptionsNet = null;
            if (receptionIds.length > 0) {
                const [receptions] = await connection.query(
                    'SELECT id, supplier_id, status, remito_number, reception_number FROM receptions WHERE id IN (?) ORDER BY id FOR UPDATE',
                    [receptionIds]
                );
                if (receptions.length !== receptionIds.length || receptions.some((row) => row.supplier_id !== supplier_id)) {
                    throw businessError(400, { error: 'invalid_reception', message: 'Algún remito no existe o es de otro proveedor.' });
                }
                if (receptions.some((row) => ['cancelled', 'rejected'].includes(String(row.status || '').toLowerCase()))) {
                    throw businessError(409, { error: 'reception_not_invoiceable', message: 'Algún remito está anulado o rechazado.' });
                }
                const [invoiced] = await connection.query(
                    // Locking read: sees an invoice committed while this one waited for the lock (AUD-007).
                    'SELECT reception_id FROM supplier_invoice_receptions WHERE reception_id IN (?) FOR SHARE',
                    [receptionIds]
                );
                if (invoiced.length > 0) {
                    const labels = receptions
                        .filter((row) => invoiced.some((link) => link.reception_id === row.id))
                        .map((row) => row.remito_number || row.reception_number);
                    throw businessError(409, {
                        error: 'reception_already_invoiced',
                        message: `Estos remitos ya están facturados: ${labels.join(', ')}.`
                    });
                }
                const [[value]] = await connection.query(
                    'SELECT COALESCE(SUM(quantity_received * unit_cost), 0) AS net FROM reception_items WHERE reception_id IN (?)',
                    [receptionIds]
                );
                receptionsNet = Math.round(Number(value?.net || 0) * 100) / 100;
            }

            // 2. Insert Supplier Invoice
            await connection.query(`
                INSERT INTO supplier_invoices (
                    id, invoice_number, invoice_type, supplier_id, reception_id, purchase_order_id,
                    issue_date, due_date, net_amount, vat_amount, other_taxes, total_amount, status, notes, created_by,
                    purchase_kind
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
            `, [
                id,
                invoice_number,
                invoice_type,
                supplier_id,
                receptionIds[0] || null,
                purchase_order_id || null,
                issue_date,
                due_date || null,
                net,
                vat,
                taxes,
                total,
                notes || null,
                creatorId,
                purchaseKind
            ]);
            for (const receptionId of receptionIds) {
                try {
                    await connection.query(
                        'INSERT INTO supplier_invoice_receptions (supplier_invoice_id, reception_id) VALUES (?, ?)',
                        [id, receptionId]
                    );
                } catch (err) {
                    // The unique key is the last guard: another invoice took it at the same time.
                    if (err?.code === 'ER_DUP_ENTRY') {
                        throw businessError(409, { error: 'reception_already_invoiced', message: 'Algún remito ya fue facturado por otra factura cargada al mismo tiempo.' });
                    }
                    throw err;
                }
            }
            for (const line of vatLines || []) {
                await connection.query(
                    `INSERT INTO supplier_invoice_vat_lines (id, supplier_invoice_id, vat_rate, net_amount, vat_amount)
                     VALUES (?, ?, ?, ?, ?)`,
                    [crypto.randomUUID(), id, line.vat_rate, line.net, line.vat]
                );
            }

            // 3. Increment Supplier Account Balance
            await connection.query(`
                UPDATE suppliers
                SET account_balance = COALESCE(account_balance, 0) + ?
                WHERE id = ?
            `, [total, supplier_id]);

            // 4. Create Transaction Ledger entry (Libro Mayor Auxiliar de Proveedores)
            await connection.query(`
                INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id, date)
                VALUES (?, 'purchase', ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                total,
                `Factura de Compra ${invoice_type} ${invoice_number}`,
                id,
                supplier_id,
                issue_date || new Date()
            ]);

            // 5. Create Accounting Journal Entry (Double-Entry Bookkeeping)
            // ADR-016: only a Factura A (or M) gives fiscal credit, in the account of its rate.
            // On a B or C invoice the VAT is part of the cost. Perceptions ("Percepciones /
            // Otros") are tax paid in advance: Retenciones y percepciones sufridas, not cost.
            // ADR-017: several rates post one fiscal credit line each, and a freight or expense
            // invoice goes to its expense account instead of inventory.
            const givesCredit = invoice_type === 'A' || invoice_type === 'M';
            const rateLines = vatLines || [{ vat_rate: data.vat_rate == null ? 21 : Number(data.vat_rate), net, vat }];
            const debitAccount = PURCHASE_ACCOUNTS[purchaseKind] || PURCHASE_ACCOUNTS.goods;
            const debitBase = Math.round((net + (givesCredit ? 0 : vat)) * 100) / 100;
            const creditByAccount = new Map();
            if (givesCredit) {
                for (const line of rateLines) {
                    if (!(line.vat > 0)) continue;
                    const account = vatCreditAccount(line.vat_rate);
                    const current = creditByAccount.get(account) || { amount: 0, rates: new Set() };
                    current.amount = Math.round((current.amount + line.vat) * 100) / 100;
                    current.rates.add(line.vat_rate);
                    creditByAccount.set(account, current);
                }
            }
            await accountingService.createJournalEntry(connection, {
                date: issue_date || new Date(),
                description: `Factura de Compra ${invoice_type} ${invoice_number}`,
                reference_type: 'supplier_invoice',
                reference_id: id,
                lines: [
                    { account_code: debitAccount.code, debit: debitBase, credit: 0, notes: debitAccount.notes },
                    ...[...creditByAccount.entries()].map(([account_code, credit]) => ({
                        account_code, debit: credit.amount, credit: 0, notes: `IVA Crédito Fiscal ${[...credit.rates].join(' / ')}%`
                    })),
                    ...(taxes > 0
                        ? [{ account_code: ACCOUNTS.WITHHOLDINGS, debit: taxes, credit: 0, notes: 'Percepciones sufridas' }]
                        : []),
                    { account_code: '2.1.01.01', debit: 0, credit: total, notes: `Proveedores - Cuenta Corriente` }
                ]
            });

            await auditService.log({
                user_id: creatorId,
                action: 'CREATE_SUPPLIER_INVOICE',
                entity_type: 'supplier_invoice',
                entity_id: id,
                new_values: {
                    id,
                    invoice_number,
                    invoice_type,
                    supplier_id,
                    reception_id,
                    reception_ids: receptionIds,
                    purchase_order_id,
                    issue_date,
                    net_amount: net,
                    vat_amount: vat,
                    other_taxes: taxes,
                    total_amount: total
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();

            // ADR-019: what the delivery notes received (at their cost) against the invoice's net:
            // a difference is shown to the user (it is not blocked: prices or extras can differ).
            return {
                id,
                success: true,
                total_amount: total,
                reception_ids: receptionIds,
                ...(receptionsNet != null
                    ? { receptions_net: receptionsNet, receptions_difference: Math.round((net - receptionsNet) * 100) / 100 }
                    : {})
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getPendingSupplierInvoices(filters = {}) {
        const { supplier_id } = filters;
        let query = `
            SELECT si.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id
            FROM supplier_invoices si
            LEFT JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.status != 'cancelled'
              AND si.payment_status IN ('pending', 'partial')
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND si.supplier_id = ?';
            params.push(supplier_id);
        }

        query += ' ORDER BY si.issue_date ASC';

        const [rows] = await pool.query(query, params);

        // Get paid amounts from supplier_payments to compute exact pending amount
        if (rows.length > 0) {
            const invoiceIds = rows.map(r => r.id);
            const [paymentRows] = await pool.query(`
                SELECT supplier_invoice_id, SUM(amount) as paid_amount
                FROM supplier_payments
                WHERE supplier_invoice_id IN (?)
                GROUP BY supplier_invoice_id
            `, [invoiceIds]);

            const paidMap = {};
            for (const pr of paymentRows) {
                paidMap[pr.supplier_invoice_id] = Number(pr.paid_amount || 0);
            }

            for (const row of rows) {
                const paid = paidMap[row.id] || 0;
                const total = Number(row.total_amount || 0);
                row.paid_amount = paid;
                row.pending_amount = Math.max(0, total - paid);
            }
        }

        return rows;
    }

    /** Libro IVA Compras: approved supplier invoices plus approved returns as negative entries. */
    async getPurchasesVatBook() {
        // 1. Get all approved supplier invoices
        const [invoices] = await pool.query(`
            SELECT si.invoice_number, si.invoice_type, si.issue_date, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   si.net_amount, si.vat_amount, si.other_taxes, si.total_amount
            FROM supplier_invoices si
            JOIN suppliers s ON si.supplier_id = s.id
            WHERE si.status = 'approved'
            ORDER BY si.issue_date DESC
        `);

        // 2. Get all approved returns
        const [returns] = await pool.query(`
            SELECT sr.return_number, sr.created_at, s.name AS supplier_name, s.tax_id AS supplier_tax_id,
                   COALESCE(SUM(sri.quantity * sri.unit_cost), 0) AS subtotal
            FROM supplier_returns sr
            JOIN suppliers s ON sr.supplier_id = s.id
            JOIN supplier_return_items sri ON sri.return_id = sr.id
            WHERE sr.status = 'approved'
            GROUP BY sr.id, sr.return_number, sr.created_at, s.name, s.tax_id
            ORDER BY sr.created_at DESC
        `);

        const taxRate = await purchaseOrderService.getTaxRate();

        // 3. Merge and sort chronologically
        const records = [];
        for (const inv of invoices) {
            const net = Number(inv.net_amount || 0);
            const iva = Number(inv.vat_amount || 0);
            const taxes = Number(inv.other_taxes || 0);
            const total = Number(inv.total_amount || (net + iva + taxes));
            records.push({
                date: new Date(inv.issue_date),
                type: `Factura ${inv.invoice_type}`,
                number: inv.invoice_number,
                tax_id: inv.supplier_tax_id || '-',
                supplier_name: inv.supplier_name,
                subtotal: net,
                iva: iva,
                total: total
            });
        }

        for (const ret of returns) {
            const sub = Number(ret.subtotal || 0);
            const iva = sub * taxRate;
            const total = sub + iva;
            records.push({
                date: new Date(ret.created_at),
                type: 'Devolución (Egreso/Ajuste)',
                number: ret.return_number,
                tax_id: ret.supplier_tax_id || '-',
                supplier_name: ret.supplier_name,
                subtotal: -sub,
                iva: -iva,
                total: -total
            });
        }

        // Sort chronologically descending
        records.sort((a, b) => b.date.getTime() - a.date.getTime());

        return records;
    }
}

export default new SupplierInvoiceService();
