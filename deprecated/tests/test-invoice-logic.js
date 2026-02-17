import pool from './server/db.js';
import crypto from 'crypto';

async function testInvoiceCreation() {
    try {
        console.log("--- TESTING INVOICE CREATION MANUALLY ---");

        // Mock payload like POS
        const payload = {
            client_id: 'default-consumer-id',
            invoice_type: 'B',
            point_of_sale: 1,
            order_id: null,
            items: [{
                product_id: 'any',
                description: 'Test Product',
                quantity: 1,
                unit_price: 100,
                vat_rate: 21,
                discount: 0
            }],
            created_by: 'test-runner'
        };

        // I'll copy the logic from server/index.js partially to see where it breaks
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const { client_id, invoice_type, point_of_sale, items, order_id, notes, created_by } = payload;

            let client = {
                id: null, name: 'Consumidor Final', tax_id: '99-99999999-9', cuit: '99-99999999-9', address: 'Dirección no especificada'
            };
            let taxConditionName = 'Consumidor Final';

            let net_amount = 100, vat_amount = 21, total_amount = 121;
            const [lastInvoice] = await connection.query(
                'SELECT MAX(invoice_number) as max_num FROM invoices WHERE invoice_type = ? AND point_of_sale = ?',
                [invoice_type, point_of_sale]
            );
            const nextNumber = (lastInvoice[0].max_num || 0) + 1;
            const invoiceId = crypto.randomUUID();

            console.log("Attempting INSERT with nextNumber:", nextNumber);

            await connection.query(`
                INSERT INTO invoices 
                (id, order_id, client_id, client_name, client_tax_id, client_address, client_tax_condition,
                 invoice_type, point_of_sale, invoice_number, 
                 net_amount, vat_amount, total_amount, status, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
            `, [
                invoiceId, order_id || null, client.id, client.name, client.tax_id || client.cuit || '99-99999999-9', client.address || 'Sin dirección', taxConditionName,
                invoice_type, point_of_sale, nextNumber,
                net_amount, vat_amount, total_amount, (notes && notes.trim() !== '') ? notes : null, created_by || 'system'
            ]);

            console.log("Insert Header Success!");
            await connection.commit();
            console.log("Transaction Committed!");
        } catch (e) {
            console.error("Internal Logic Error:", e);
            await connection.rollback();
        } finally {
            connection.release();
        }

        process.exit(0);
    } catch (err) {
        console.error("Outer Error:", err);
        process.exit(1);
    }
}

testInvoiceCreation();
