import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';

export class PurchaseOrderService {
    async getTaxRate(connection) {
        const conn = connection || pool;
        const [rows] = await conn.query('SELECT tax_rate FROM company_settings WHERE id = 1');
        if (rows.length > 0 && rows[0].tax_rate != null) {
            return parseFloat(rows[0].tax_rate);
        }
        return 0.21;
    }

    async nextPONumber(connection) {
        const year = new Date().getFullYear();
        const prefix = `PO-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM purchase_orders
             WHERE po_number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `purchase_order:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }

    async getPurchaseOrders(filters = {}) {
        const { supplier_id, status } = filters;
        let query = `
            SELECT po.*, s.name AS supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON po.supplier_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (supplier_id) {
            query += ' AND po.supplier_id = ?';
            params.push(supplier_id);
        }
        if (status) {
            query += ' AND po.status = ?';
            params.push(status);
        }
        query += ' ORDER BY po.created_at DESC';

        const [orders] = await pool.query(query, params);
        if (orders.length === 0) return orders;

        const orderIds = orders.map((o) => o.id);
        const [allItems] = await pool.query(`
            SELECT poi.*, p.name AS product_name, p.sku
            FROM purchase_order_items poi
            LEFT JOIN products p ON poi.product_id = p.id
            WHERE poi.purchase_order_id IN (?)
        `, [orderIds]);

        const itemsByOrder = {};
        for (const item of allItems) {
            if (!itemsByOrder[item.purchase_order_id]) itemsByOrder[item.purchase_order_id] = [];
            itemsByOrder[item.purchase_order_id].push(item);
        }

        for (const order of orders) {
            order.items = itemsByOrder[order.id] || [];
        }

        return orders;
    }

    async createPurchaseOrder(data, userId, ipAddress = null) {
        const { supplier_id, order_date, expected_delivery_date, items, notes } = data;
        const id = crypto.randomUUID();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const poNumber = await this.nextPONumber(connection);
            const taxRate = await this.getTaxRate(connection);

            let subtotal = 0;
            for (const item of items) {
                const qty = Number(item.quantity_ordered || item.quantity || 0);
                subtotal += qty * Number(item.unit_cost || 0);
            }
            const taxAmount = subtotal * taxRate;
            const totalAmount = subtotal + taxAmount;

            await connection.query(`
                INSERT INTO purchase_orders (
                    id, po_number, supplier_id, order_date, expected_delivery_date, status, subtotal, tax_amount, total_amount, notes
                ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
            `, [
                id,
                poNumber,
                supplier_id,
                order_date || new Date().toISOString().slice(0, 10),
                expected_delivery_date || null,
                subtotal,
                taxAmount,
                totalAmount,
                notes || null
            ]);

            for (const item of items) {
                const qty = Number(item.quantity_ordered || item.quantity || 0);
                await connection.query(`
                    INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity_ordered, unit_cost)
                    VALUES (?, ?, ?, ?, ?)
                `, [crypto.randomUUID(), id, item.product_id, qty, item.unit_cost]);
            }

            await connection.commit();

            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_PURCHASE_ORDER',
                entity_type: 'purchase_order',
                entity_id: id,
                new_values: {
                    id,
                    po_number: poNumber,
                    supplier_id,
                    order_date: order_date || new Date().toISOString().slice(0, 10),
                    expected_delivery_date: expected_delivery_date || null,
                    subtotal,
                    tax_amount: taxAmount,
                    total_amount: totalAmount,
                    notes: notes || null,
                    items
                },
                ip_address: ipAddress
            });

            return { id, po_number: poNumber };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new PurchaseOrderService();
