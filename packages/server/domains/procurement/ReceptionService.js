import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';

export class ReceptionService {
    async nextReceptionNumber(connection) {
        const year = new Date().getFullYear();
        const prefix = `REC-${year}-`;
        const [rows] = await connection.query(
            `SELECT MAX(CAST(SUBSTRING_INDEX(reception_number, '-', -1) AS UNSIGNED)) AS max_seq
             FROM receptions
             WHERE reception_number LIKE ?`,
            [`${prefix}%`]
        );
        const maxExisting = Number(rows[0]?.max_seq || 0);
        const nextSeq = await nextDocumentSequence(connection, `reception:${year}`, maxExisting);
        return `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }

    async getReceptions(filters = {}) {
        const { status, supplier_id } = filters;
        let query = `
            SELECT r.*, s.name AS supplier_name, po.po_number
            FROM receptions r
            LEFT JOIN suppliers s ON r.supplier_id = s.id
            LEFT JOIN purchase_orders po ON r.purchase_order_id = po.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND r.status = ?';
            params.push(status);
        }
        if (supplier_id) {
            query += ' AND r.supplier_id = ?';
            params.push(supplier_id);
        }
        query += ' ORDER BY r.created_at DESC';

        const [receptions] = await pool.query(query, params);
        if (receptions.length === 0) {
            return receptions;
        }

        const receptionIds = receptions.map((r) => r.id);
        const [allItems] = await pool.query(`
            SELECT ri.*, p.name AS product_name, p.sku
            FROM reception_items ri
            LEFT JOIN products p ON ri.product_id = p.id
            WHERE ri.reception_id IN (?)
        `, [receptionIds]);

        const itemsByReception = {};
        for (const item of allItems) {
            if (!itemsByReception[item.reception_id]) itemsByReception[item.reception_id] = [];
            itemsByReception[item.reception_id].push(item);
        }
        for (const reception of receptions) {
            reception.items = itemsByReception[reception.id] || [];
        }

        return receptions;
    }

    async createReception(data, userId, ipAddress = null) {
        const { purchase_order_id, supplier_id, remito_number, items, notes } = data;
        const id = crypto.randomUUID();

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            if (purchase_order_id) {
                const [orders] = await connection.query(
                    'SELECT id, supplier_id, status FROM purchase_orders WHERE id = ? FOR UPDATE',
                    [purchase_order_id]
                );
                if (orders.length === 0) {
                    const error = new Error('Orden de compra no encontrada');
                    error.statusCode = 404;
                    error.errorCode = 'PURCHASE_ORDER_NOT_FOUND';
                    throw error;
                }
                if (!['sent', 'partial'].includes(String(orders[0].status))) {
                    const error = new Error('La orden de compra ya no admite nuevas recepciones');
                    error.statusCode = 409;
                    error.errorCode = 'PURCHASE_ORDER_NOT_RECEIVABLE';
                    throw error;
                }

                const [poItems] = await connection.query(
                    'SELECT id, product_id, quantity_ordered, quantity_received FROM purchase_order_items WHERE purchase_order_id = ? FOR UPDATE',
                    [purchase_order_id]
                );
                const poItemById = new Map(poItems.map((item) => [item.id, item]));
                const [pendingRows] = await connection.query(`
                    SELECT ri.po_item_id, COALESCE(SUM(ri.quantity_received), 0) AS pending_quantity
                    FROM reception_items ri
                    JOIN receptions r ON r.id = ri.reception_id
                    WHERE r.purchase_order_id = ? AND r.status = 'pending_qc'
                    GROUP BY ri.po_item_id
                `, [purchase_order_id]);
                const pendingByItem = new Map(pendingRows.map((row) => [row.po_item_id, Number(row.pending_quantity || 0)]));
                const submittedItemIds = new Set();

                for (const item of items) {
                    if (!item.po_item_id || submittedItemIds.has(item.po_item_id)) {
                        const error = new Error('La recepción contiene ítems repetidos o sin vínculo a la orden');
                        error.statusCode = 400;
                        error.errorCode = 'INVALID_RECEPTION_ITEMS';
                        throw error;
                    }
                    submittedItemIds.add(item.po_item_id);
                    const poItem = poItemById.get(item.po_item_id);
                    if (!poItem || poItem.product_id !== item.product_id) {
                        const error = new Error('Uno de los productos no pertenece a la orden de compra');
                        error.statusCode = 400;
                        error.errorCode = 'RECEPTION_ITEM_NOT_IN_ORDER';
                        throw error;
                    }
                    const receiving = Number(item.quantity_received || 0);
                    const available = Math.max(
                        0,
                        Number(poItem.quantity_ordered || 0)
                        - Number(poItem.quantity_received || 0)
                        - Number(pendingByItem.get(item.po_item_id) || 0)
                    );
                    if (!Number.isInteger(receiving) || receiving <= 0 || receiving > available) {
                        const error = new Error(`La cantidad a recibir supera el saldo pendiente de la orden (${available})`);
                        error.statusCode = 409;
                        error.errorCode = 'RECEPTION_EXCEEDS_PENDING_QUANTITY';
                        throw error;
                    }
                }
            }

            let effectiveSupplierId = supplier_id;
            if (!effectiveSupplierId && purchase_order_id) {
                const [po] = await connection.query('SELECT supplier_id FROM purchase_orders WHERE id = ?', [purchase_order_id]);
                if (po.length > 0) effectiveSupplierId = po[0].supplier_id;
            }
            if (!effectiveSupplierId) {
                throw Object.assign(new Error('supplier_id es obligatorio'), { statusCode: 400, errorCode: 'SUPPLIER_REQUIRED' });
            }

            if (remito_number) {
                const [duplicates] = await connection.query(
                    `SELECT id FROM receptions
                     WHERE supplier_id = ? AND remito_number = ?
                     LIMIT 1 FOR UPDATE`,
                    [effectiveSupplierId, remito_number]
                );
                if (duplicates.length > 0) {
                    const error = new Error('Este remito ya fue registrado para el proveedor');
                    error.statusCode = 409;
                    error.errorCode = 'DUPLICATE_REMITO';
                    throw error;
                }
            }

            const receptionNumber = await this.nextReceptionNumber(connection);

            await connection.query(
                `INSERT INTO receptions (id, reception_number, purchase_order_id, supplier_id, remito_number, notes)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, receptionNumber, purchase_order_id || null, effectiveSupplierId, remito_number || null, notes || null]
            );

            for (const item of items) {
                await connection.query(
                    `INSERT INTO reception_items (
                        id, reception_id, product_id, po_item_id, quantity_expected, quantity_received,
                        unit_cost, location_assigned, batch_number, expiration_date, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        crypto.randomUUID(),
                        id,
                        item.product_id,
                        item.po_item_id || null,
                        item.quantity_expected || 0,
                        item.quantity_received,
                        item.unit_cost || 0,
                        item.location_assigned || 'General',
                        item.batch_number || null,
                        item.expiration_date || null,
                        item.notes || null
                    ]
                );
            }

            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_RECEPTION',
                entity_type: 'reception',
                entity_id: id,
                new_values: {
                    id,
                    reception_number: receptionNumber,
                    purchase_order_id: purchase_order_id || null,
                    supplier_id: effectiveSupplierId,
                    remito_number: remito_number || null,
                    notes: notes || null,
                    items
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id, reception_number: receptionNumber };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new ReceptionService();
