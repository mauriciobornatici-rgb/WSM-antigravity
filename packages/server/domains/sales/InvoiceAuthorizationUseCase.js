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
            const invoice = updatedInvoiceRows[0] || {};
            invoice.items = invoiceItems;

            await accountingService.postInvoiceAccountingEntries(connection, invoiceId);

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
