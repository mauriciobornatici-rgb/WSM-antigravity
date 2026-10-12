import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import purchaseOrderService from './PurchaseOrderService.js';
import { businessError } from '../../utils/businessError.js';

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
        const net = Math.round(Number(net_amount || 0) * 100) / 100;
        const vat = Math.round(Number(vat_amount || 0) * 100) / 100;
        const taxes = Math.round(Number(other_taxes || 0) * 100) / 100;
        const total = Math.round(Number(total_amount || (net + vat + taxes)) * 100) / 100;
        const creatorId = userId || null;

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

            // 2. Insert Supplier Invoice
            await connection.query(`
                INSERT INTO supplier_invoices (
                    id, invoice_number, invoice_type, supplier_id, reception_id, purchase_order_id,
                    issue_date, due_date, net_amount, vat_amount, other_taxes, total_amount, status, notes, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
            `, [
                id,
                invoice_number,
                invoice_type,
                supplier_id,
                reception_id || null,
                purchase_order_id || null,
                issue_date,
                due_date || null,
                net,
                vat,
                taxes,
                total,
                notes || null,
                creatorId
            ]);

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
            const debitInventory = Math.round((net + taxes) * 100) / 100;
            await accountingService.createJournalEntry(connection, {
                date: issue_date || new Date(),
                description: `Factura de Compra ${invoice_type} ${invoice_number}`,
                reference_type: 'supplier_invoice',
                reference_id: id,
                lines: [
                    { account_code: '1.1.04.01', debit: debitInventory, credit: 0, notes: 'Inventario / Bienes de Cambio' },
                    { account_code: '1.1.05.02', debit: vat, credit: 0, notes: `IVA Crédito Fiscal (${invoice_type === 'A' ? '21%' : 'Factura ' + invoice_type})` },
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

            return { id, success: true, total_amount: total };
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
