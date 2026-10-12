import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';
import { businessError } from '../../utils/businessError.js';

export const PURCHASE_ORDER_STATUSES = Object.freeze(['draft', 'sent', 'partial', 'received', 'cancelled']);

// Manual status changes only move forward (ADR-012). Cancelling is allowed only before
// anything was received (see updatePurchaseOrderStatus); received and cancelled are final.
const PURCHASE_ORDER_TRANSITIONS = Object.freeze({
    draft: ['sent', 'cancelled'],
    sent: ['partial', 'received', 'cancelled'],
    partial: ['received'],
    received: [],
    cancelled: [],
});

export function canTransitionPurchaseOrder(from, to) {
    return (PURCHASE_ORDER_TRANSITIONS[from] || []).includes(to);
}

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
            SELECT poi.*, p.name AS product_name, p.sku,
                   COALESCE((
                       SELECT SUM(ri.quantity_received)
                       FROM reception_items ri
                       JOIN receptions r ON r.id = ri.reception_id
                       WHERE ri.po_item_id = poi.id AND r.status = 'pending_qc'
                   ), 0) AS quantity_pending_qc
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

    async getPurchaseOrder(id) {
        const [orders] = await pool.query(`
            SELECT po.*, s.name AS supplier_name
            FROM purchase_orders po
            LEFT JOIN suppliers s ON po.supplier_id = s.id
            WHERE po.id = ?
            LIMIT 1
        `, [id]);

        if (orders.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Orden de compra no encontrada' });
        }

        const order = orders[0];
        const [items] = await pool.query(`
            SELECT poi.*, p.name AS product_name, p.sku,
                   COALESCE((
                       SELECT SUM(ri.quantity_received)
                       FROM reception_items ri
                       JOIN receptions r ON r.id = ri.reception_id
                       WHERE ri.po_item_id = poi.id AND r.status = 'pending_qc'
                   ), 0) AS quantity_pending_qc
            FROM purchase_order_items poi
            LEFT JOIN products p ON poi.product_id = p.id
            WHERE poi.purchase_order_id = ?
        `, [id]);
        order.items = items;
        return order;
    }

    async updatePurchaseOrderStatus(id, status, userId, ipAddress = null) {
        if (!PURCHASE_ORDER_STATUSES.includes(status)) {
            throw businessError(400, { error: 'invalid_status', message: 'Estado de OC invalido' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [existing] = await connection.query('SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE', [id]);
            if (existing.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Orden de compra no encontrada' });
            }

            const currentStatus = existing[0].status;
            if (currentStatus === status) {
                // Nothing changes: no write and no audit noise.
                const [unchanged] = await connection.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
                await connection.commit();
                return unchanged[0];
            }
            if (!canTransitionPurchaseOrder(currentStatus, status)) {
                throw businessError(409, {
                    error: 'invalid_transition',
                    message: `Una orden de compra en estado "${currentStatus}" no puede pasar a "${status}".`
                });
            }
            if (status === 'cancelled') {
                // Goods that already arrived (approved or still in quality control) belong to
                // the order: it cannot be cancelled. The order row lock above serialises this
                // check with createReception and processReceptionApproval.
                const [blockers] = await connection.query(`
                    SELECT
                        (SELECT COUNT(*) FROM receptions WHERE purchase_order_id = ? AND status = 'pending_qc') AS pending_receptions,
                        (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_items WHERE purchase_order_id = ?) AS received_qty
                `, [id, id]);
                const pendingReceptions = Number(blockers[0]?.pending_receptions || 0);
                const receivedQty = Number(blockers[0]?.received_qty || 0);
                if (pendingReceptions > 0 || receivedQty > 0) {
                    throw businessError(409, {
                        error: 'purchase_order_has_receptions',
                        message: 'La orden ya tiene mercadería recibida o recepciones pendientes de control de calidad; no se puede anular.'
                    });
                }
            }

            await connection.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [status, id]);
            const [rows] = await connection.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
            await auditService.log({
                user_id: userId || null,
                action: 'UPDATE_PURCHASE_ORDER_STATUS',
                entity_type: 'purchase_order',
                entity_id: id,
                old_values: { status: currentStatus },
                new_values: { status: rows[0]?.status || status },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return rows[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new PurchaseOrderService();
