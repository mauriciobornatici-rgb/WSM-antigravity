import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import { nextDocumentSequence } from '../../utils/documentSequence.js';
import { businessYear } from '../../utils/businessDate.js';
import { businessError } from '../../utils/businessError.js';
import { effectiveCost, roundCost } from '../inventory/InventoryValuation.js';
import { invoicedByOrderSql } from './receptionInvoicing.js';

export class ReceptionService {
    async nextReceptionNumber(connection) {
        const year = businessYear();
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
            SELECT r.*, s.name AS supplier_name, po.po_number,
                   -- ADR-019: the purchase invoice that already covers this delivery note, if any.
                   (SELECT sir.supplier_invoice_id FROM supplier_invoice_receptions sir
                    WHERE sir.reception_id = r.id LIMIT 1) AS supplier_invoice_id,
                   -- ADR-027: its purchase order was invoiced without naming it (before ADR-019).
                   ${invoicedByOrderSql('r')} AS invoiced_by_order
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
            SELECT ri.*, p.name AS product_name, p.sku, p.vat_rate
            FROM reception_items ri
            LEFT JOIN products p ON ri.product_id = p.id
            WHERE ri.reception_id IN (?)
        `, [receptionIds]);

        const itemsByReception = {};
        for (const item of allItems) {
            if (!itemsByReception[item.reception_id]) itemsByReception[item.reception_id] = [];
            itemsByReception[item.reception_id].push(item);
        }
        // ADR-028: what each line has left to invoice, and how invoiced the delivery note is.
        for (const reception of receptions) {
            const byOrder = Number(reception.invoiced_by_order) === 1;
            reception.items = (itemsByReception[reception.id] || []).map((item) => ({
                ...item,
                quantity_to_invoice: byOrder ? 0 : Math.max(0,
                    Number(item.quantity_received || 0) - Number(item.invoiced_quantity || 0) - Number(item.returned_quantity || 0)),
            }));
            const toInvoice = reception.items.reduce((sum, item) => sum + item.quantity_to_invoice, 0);
            const invoicedAny = Boolean(reception.supplier_invoice_id) || byOrder;
            if (toInvoice > 0) reception.invoice_status = invoicedAny ? 'partial' : 'pending';
            else reception.invoice_status = invoicedAny ? 'invoiced' : 'returned';
        }

        return receptions;
    }

    /**
     * @param {object} options
     * @param {boolean} options.canEditCost whether the user may change a product's cost (D5). Without
     *   it, a delivery note without an order keeps each product's cost: the supplier invoice corrects
     *   it later (D1). A product without a cost takes the one typed (D6).
     */
    async createReception(data, userId, ipAddress = null, { canEditCost = false } = {}) {
        const { purchase_order_id, supplier_id, remito_number, items, notes } = data;
        const id = crypto.randomUUID();
        // ADR-027: the cost of each line is what the goods enter the ledger at. With an order it is
        // the order's (D1); without one (a small purchase) it is typed and must be there.
        const costByPoItem = new Map();
        let orderSupplierId = null;

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            if (!purchase_order_id) {
                const products = new Set();
                for (const item of items) {
                    if (item.po_item_id) {
                        throw Object.assign(new Error('Una recepción sin orden de compra no lleva ítems de una orden.'), { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
                    }
                    if (products.has(item.product_id)) {
                        throw Object.assign(new Error('La recepción contiene el mismo producto en más de una línea; unificá las cantidades.'), { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
                    }
                    products.add(item.product_id);
                    const receiving = Number(item.quantity_received || 0);
                    if (!Number.isInteger(receiving) || receiving <= 0) {
                        throw Object.assign(new Error('La cantidad recibida debe ser un número entero mayor a cero.'), { statusCode: 400, errorCode: 'INVALID_RECEPTION_ITEMS' });
                    }
                    if (!(Math.round(Number(item.unit_cost || 0) * 100) > 0)) {
                        throw Object.assign(new Error('Cargá el costo (neto, sin IVA) de cada producto del remito.'), { statusCode: 400, errorCode: 'RECEPTION_COST_REQUIRED' });
                    }
                }
            }

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
                // The delivery note is the order's supplier's: it is invoiced against that supplier.
                orderSupplierId = orders[0].supplier_id || null;
                if (supplier_id && orderSupplierId && supplier_id !== orderSupplierId) {
                    throw Object.assign(new Error('El proveedor no es el de la orden de compra.'), { statusCode: 400, errorCode: 'RECEPTION_SUPPLIER_MISMATCH' });
                }

                const [poItems] = await connection.query(
                    'SELECT id, product_id, quantity_ordered, quantity_received, unit_cost FROM purchase_order_items WHERE purchase_order_id = ? FOR UPDATE',
                    [purchase_order_id]
                );
                const poItemById = new Map(poItems.map((item) => [item.id, item]));
                for (const poItem of poItems) costByPoItem.set(poItem.id, Number(poItem.unit_cost || 0));
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

            const effectiveSupplierId = supplier_id || orderSupplierId;
            if (!effectiveSupplierId) {
                throw Object.assign(new Error('supplier_id es obligatorio'), { statusCode: 400, errorCode: 'SUPPLIER_REQUIRED' });
            }

            // The cost each line enters at. An order line without a cost takes the product's (the
            // invoice corrects it later, D1). Without an order, a cost other than the product's is a
            // change of cost, reserved to a manager or an administrator (D5).
            const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))];
            const [productRows] = productIds.length > 0
                ? await connection.query('SELECT id, name, purchase_price, cost_price FROM products WHERE id IN (?)', [productIds])
                : [[]];
            const productById = new Map(productRows.map((row) => [row.id, row]));
            const lineCosts = items.map((item) => {
                const productCost = effectiveCost(productById.get(item.product_id));
                if (purchase_order_id) {
                    const orderCost = Number(costByPoItem.get(item.po_item_id) || 0);
                    return orderCost > 0 ? orderCost : productCost;
                }
                const typed = roundCost(item.unit_cost);
                if (!canEditCost && productCost > 0 && typed !== productCost) {
                    const name = productById.get(item.product_id)?.name || item.product_id;
                    throw businessError(403, {
                        error: 'cost_edit_not_allowed',
                        message: `Solo un gerente o un administrador puede cargar un costo distinto al de ${name} ($${productCost}). Dejá el costo actual: si la factura trae otro precio, el costo se corrige al cargarla.`,
                    });
                }
                return typed;
            });

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

            for (const [index, item] of items.entries()) {
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
                        lineCosts[index],
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
