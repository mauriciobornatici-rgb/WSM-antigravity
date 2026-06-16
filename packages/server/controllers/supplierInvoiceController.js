import crypto from 'crypto';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import getRequestIp from '../utils/requestIp.js';
import financeService from '../services/finance.service.js';

export const getSupplierInvoices = catchAsync(async (req, res) => {
    const { supplier_id, status } = req.query;
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
    res.json(rows);
});

export const createSupplierInvoice = catchAsync(async (req, res) => {
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
    } = req.body;

    const id = crypto.randomUUID();
    const net = Math.round(Number(net_amount || 0) * 100) / 100;
    const vat = Math.round(Number(vat_amount || 0) * 100) / 100;
    const taxes = Math.round(Number(other_taxes || 0) * 100) / 100;
    const total = Math.round(Number(total_amount || (net + vat + taxes)) * 100) / 100;
    const creatorId = req.user?.id || null;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Check for duplicates (invoice number + type per supplier)
        const [existing] = await connection.query(
            'SELECT id FROM supplier_invoices WHERE supplier_id = ? AND invoice_type = ? AND invoice_number = ? LIMIT 1',
            [supplier_id, invoice_type, invoice_number]
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                error: 'duplicate_invoice',
                message: `La factura ${invoice_type} ${invoice_number} ya se encuentra registrada para este proveedor.`
            });
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

        await connection.commit();

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
            ip_address: getRequestIp(req)
        });

        res.status(201).json({ id, success: true, total_amount: total });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const getPendingSupplierInvoices = catchAsync(async (req, res) => {
    const { supplier_id } = req.query;
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

    res.json(rows);
});

export const registerBulkSupplierPayments = catchAsync(async (req, res) => {
    const userId = req.user?.id || null;
    const result = await financeService.registerBulkSupplierPayments(req.body, userId);
    res.json(result);
});

