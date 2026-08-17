import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import afipService from '../../services/afip.service.js';

export class InvoiceAuthorizationUseCase {
    async execute(invoiceId, userId) {
        // The whole flow runs inside a transaction with a row lock, so two
        // concurrent authorizations cannot both reach the AFIP call.
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const [rows] = await connection.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
            if (rows.length === 0) {
                const notFound = new Error('Invoice not found');
                notFound.statusCode = 404;
                throw notFound;
            }
            if (rows[0].status === 'authorized') {
                await connection.commit();
                return rows[0];
            }

            const invoiceData = rows[0];

            // 1. Get company settings
            const [settingsRows] = await connection.query('SELECT * FROM company_settings LIMIT 1');
            const companySettings = settingsRows[0] || {};

            // 2. Get invoice items for AFIP detail
            const [invoiceItems] = await connection.query('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoiceId]);

            const afipRes = await afipService.authorizeVoucher(invoiceData, invoiceItems, companySettings);

            const cae = afipRes.cae;
            const expirationDate = afipRes.cae_expiration_date;
            const finalInvoiceNumber = afipRes.invoice_number;

            await connection.query(
                'UPDATE invoices SET status = "authorized", cae = ?, cae_expiration_date = ?, invoice_number = ? WHERE id = ?',
                [cae, expirationDate, finalInvoiceNumber, invoiceId]
            );

            const [updatedInvoiceRows] = await connection.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
            const invoice = updatedInvoiceRows[0];

            const debitAccount = ['cash', 'card', 'debit_card', 'credit_card', 'qr'].includes(String(invoice.payment_method).toLowerCase())
                ? '1.1.01.01'
                : '1.1.03.01';

            const invoiceLabel = `${invoice.invoice_type}-${String(invoice.point_of_sale).padStart(4, '0')}-${String(invoice.invoice_number).padStart(8, '0')}`;
            const saleAmount = Math.round((Number(invoice.total_amount) - Number(invoice.vat_amount)) * 100) / 100;

            const saleLines = [
                { account_code: debitAccount, debit: Number(invoice.total_amount), credit: 0, notes: `Venta Factura ${invoiceLabel}` },
                { account_code: '4.1.01.01', debit: 0, credit: saleAmount, notes: 'Ingreso por Ventas' }
            ];

            if (Number(invoice.vat_amount) > 0) {
                saleLines.push({ account_code: '2.1.02.02', debit: 0, credit: Number(invoice.vat_amount), notes: 'IVA Débito Fiscal 21%' });
            }

            let sumDeb = saleLines.reduce((s, l) => s + l.debit, 0);
            let sumCred = saleLines.reduce((s, l) => s + l.credit, 0);
            const diff = sumDeb - sumCred;
            if (Math.abs(diff) > 0 && Math.abs(diff) < 0.05) {
                saleLines[1].credit = Math.round((saleLines[1].credit + diff) * 100) / 100;
            }

            await accountingService.createJournalEntry(connection, {
                date: invoice.issue_date,
                description: `Asiento de Venta - Factura ${invoiceLabel}`,
                reference_type: 'invoice',
                reference_id: invoice.id,
                lines: saleLines
            });

            const [itemCosts] = await connection.query(`
                SELECT ii.quantity, p.purchase_price, p.cost_price
                FROM invoice_items ii
                JOIN products p ON ii.product_id = p.id
                WHERE ii.invoice_id = ?
            `, [invoiceId]);

            let totalCmv = 0;
            for (const item of itemCosts) {
                const cost = Number(item.purchase_price || item.cost_price || 0);
                const qty = Number(item.quantity || 0);
                totalCmv += cost * qty;
            }
            totalCmv = Math.round(totalCmv * 100) / 100;

            if (totalCmv > 0) {
                await accountingService.createJournalEntry(connection, {
                    date: invoice.issue_date,
                    description: `Costo de Mercadería Vendida - Factura ${invoiceLabel}`,
                    reference_type: 'invoice',
                    reference_id: invoice.id,
                    lines: [
                        { account_code: '5.1.01.01', debit: totalCmv, credit: 0, notes: 'Costo de Ventas (CMV)' },
                        { account_code: '1.1.04.01', debit: 0, credit: totalCmv, notes: 'Salida de Inventario' }
                    ]
                });
            }

            await auditService.log({
                user_id: userId,
                action: 'AUTHORIZE_INVOICE',
                entity_type: 'invoice',
                entity_id: invoiceId,
                new_values: { cae, cae_expiration_date: expirationDate }
            }, connection);

            await connection.commit();
            return invoice;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new InvoiceAuthorizationUseCase();
