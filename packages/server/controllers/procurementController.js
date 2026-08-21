import crypto from 'crypto';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import inventoryService from '../services/inventory.service.js';
import auditService from '../services/audit.service.js';
import accountingService from '../services/accounting.service.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';
import getRequestIp from '../utils/requestIp.js';
import purchaseOrderService from '../domains/procurement/PurchaseOrderService.js';
import supplierReturnService from '../domains/procurement/SupplierReturnService.js';
import supplierPaymentService from '../domains/procurement/SupplierPaymentService.js';

async function getTaxRate(connection) {
    const conn = connection || pool;
    const [rows] = await conn.query('SELECT tax_rate FROM company_settings WHERE id = 1');
    if (rows.length > 0 && rows[0].tax_rate != null) {
        return parseFloat(rows[0].tax_rate);
    }
    return 0.21;
}

async function nextPONumber(connection) {
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

async function nextReceptionNumber(connection) {
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

async function nextSupplierReturnNumber(connection) {
    const year = new Date().getFullYear();
    const prefix = `SR-${year}-`;
    const [rows] = await connection.query(
        `SELECT MAX(CAST(SUBSTRING_INDEX(return_number, '-', -1) AS UNSIGNED)) AS max_seq
         FROM supplier_returns
         WHERE return_number LIKE ?`,
        [`${prefix}%`]
    );
    const maxExisting = Number(rows[0]?.max_seq || 0);
    const nextSeq = await nextDocumentSequence(connection, `supplier_return:${year}`, maxExisting);
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

async function decreaseInventory(connection, productId, quantityToRemove) {
    const qty = Number(quantityToRemove || 0);
    if (qty <= 0) return;

    const [stockRows] = await connection.query(
        'SELECT id, quantity FROM inventory WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC FOR UPDATE',
        [productId]
    );

    let remaining = qty;
    for (const row of stockRows) {
        if (remaining <= 0) break;
        const available = Number(row.quantity || 0);
        const consume = Math.min(available, remaining);
        await connection.query('UPDATE inventory SET quantity = quantity - ? WHERE id = ?', [consume, row.id]);
        remaining -= consume;
    }

    if (remaining > 0) {
        throw new Error('Stock insuficiente para procesar la devolucion');
    }
}

export const getPurchaseOrders = catchAsync(async (req, res) => {
    const orders = await purchaseOrderService.getPurchaseOrders(req.query);
    res.json(orders);
});

export const getPurchaseOrder = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [orders] = await pool.query(`
        SELECT po.*, s.name AS supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = ?
        LIMIT 1
    `, [id]);

    if (orders.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Orden de compra no encontrada' });
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

    res.json(order);
});

export const createPurchaseOrder = catchAsync(async (req, res) => {
    const result = await purchaseOrderService.createPurchaseOrder(req.body, req.user?.id, getRequestIp(req));
    res.json(result);
});

export const updatePurchaseOrderStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const valid = ['draft', 'sent', 'partial', 'received', 'cancelled'];
    if (!valid.includes(status)) {
        return res.status(400).json({ error: 'invalid_status', message: 'Estado de OC invalido' });
    }

    const [existing] = await pool.query('SELECT id, status FROM purchase_orders WHERE id = ?', [id]);
    if (existing.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Orden de compra no encontrada' });
    }

    await pool.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [status, id]);
    const [rows] = await pool.query('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_PURCHASE_ORDER_STATUS',
        entity_type: 'purchase_order',
        entity_id: id,
        old_values: { status: existing[0].status },
        new_values: { status: rows[0]?.status || status },
        ip_address: getRequestIp(req)
    });
    res.json(rows[0]);
});

export const getReceptions = catchAsync(async (req, res) => {
    const { status, supplier_id } = req.query;
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
        return res.json(receptions);
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

    res.json(receptions);
});

export const createReception = catchAsync(async (req, res) => {
    const { purchase_order_id, supplier_id, remito_number, items, notes } = req.body;
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
            throw new Error('supplier_id es obligatorio');
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

        const receptionNumber = await nextReceptionNumber(connection);

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
            user_id: req.user?.id || null,
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
            ip_address: getRequestIp(req)
        }, connection);
        await connection.commit();
        res.json({ id, reception_number: receptionNumber });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const approveReception = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { approved_by } = req.body || {};
    const approverId = approved_by || req.user?.id || null;

    try {
        await inventoryService.processReceptionApproval(id, {
            approvedBy: approverId,
            actorUserId: req.user?.id || approverId || null,
            ipAddress: getRequestIp(req)
        });
    } catch (err) {
        if (err.errorCode === 'RECEPTION_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Recepcion no encontrada' });
        }
        if (err.errorCode === 'RECEPTION_ALREADY_APPROVED') {
            return res.status(400).json({ error: 'reception_already_approved', message: 'Esta recepcion ya fue aprobada' });
        }
        if (err.errorCode === 'RECEPTION_HAS_NO_ITEMS') {
            return res.status(400).json({ error: 'reception_without_items', message: 'La recepcion no contiene items' });
        }
        if (err.errorCode === 'RECEPTION_QC_INCOMPLETE' || err.errorCode === 'RECEPTION_QC_INVALID') {
            return res.status(409).json({ error: 'quality_check_incomplete', message: err.message });
        }
        if (err.errorCode === 'RECEPTION_DUPLICATE_PRODUCT_ITEMS') {
            return res.status(409).json({ error: 'duplicate_reception_product', message: err.message });
        }
        throw err;
    }

    res.json({ success: true, message: 'Recepcion aprobada y stock actualizado' });
});

export const getReturns = catchAsync(async (req, res) => {
    const { supplier_id, status } = req.query;
    let query = `
        SELECT sr.*, s.name AS supplier_name
        FROM supplier_returns sr
        LEFT JOIN suppliers s ON sr.supplier_id = s.id
        WHERE 1=1
    `;
    const params = [];
    if (supplier_id) {
        query += ' AND sr.supplier_id = ?';
        params.push(supplier_id);
    }
    if (status) {
        query += ' AND sr.status = ?';
        params.push(status);
    }
    query += ' ORDER BY sr.created_at DESC';

    try {
        const [rows] = await pool.query(query, params);
        if (rows.length === 0) return res.json(rows);

        const ids = rows.map((r) => r.id);
        const [items] = await pool.query(`
            SELECT sri.*, p.name AS product_name, p.sku
            FROM supplier_return_items sri
            LEFT JOIN products p ON sri.product_id = p.id
            WHERE sri.return_id IN (?)
        `, [ids]);

        const itemsByReturn = {};
        for (const item of items) {
            if (!itemsByReturn[item.return_id]) itemsByReturn[item.return_id] = [];
            itemsByReturn[item.return_id].push(item);
        }

        return res.json(rows.map((r) => ({
            ...r,
            items: itemsByReturn[r.id] || []
        })));
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
            return res.json([]);
        }
        throw err;
    }
});

export const getSupplierReturns = getReturns;

export const createReturn = catchAsync(async (req, res) => {
    const { supplier_id, items, notes } = req.body;
    const id = crypto.randomUUID();

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const returnNumber = await nextSupplierReturnNumber(connection);

        await connection.query(`
            INSERT INTO supplier_returns (id, return_number, supplier_id, notes, status)
            VALUES (?, ?, ?, ?, 'draft')
        `, [id, returnNumber, supplier_id, notes || null]);

        for (const item of items || []) {
            await connection.query(`
                INSERT INTO supplier_return_items (id, return_id, product_id, quantity, unit_cost, reason)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                id,
                item.product_id,
                item.quantity,
                item.unit_cost || 0,
                item.reason || null
            ]);
        }

        await auditService.log({
            user_id: req.user?.id || null,
            action: 'CREATE_SUPPLIER_RETURN',
            entity_type: 'supplier_return',
            entity_id: id,
            new_values: {
                id,
                return_number: returnNumber,
                supplier_id,
                notes: notes || null,
                items: items || []
            },
            ip_address: getRequestIp(req)
        }, connection);
        await connection.commit();
        res.json({ id, return_number: returnNumber });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const approveReturn = catchAsync(async (req, res) => {
    const { id } = req.params;
    try {
        const result = await supplierReturnService.approveSupplierReturn(id, req.user?.id, getRequestIp(req));
        res.json(result);
    } catch (err) {
        if (err.errorCode === 'RETURN_NOT_FOUND') {
            return res.status(404).json({ error: 'not_found', message: 'Devolucion no encontrada' });
        }
        if (err.errorCode === 'RETURN_ALREADY_APPROVED') {
            return res.status(400).json({ error: 'already_approved', message: 'La devolucion ya fue aprobada' });
        }
        throw err;
    }
});

export const getSupplierPayments = catchAsync(async (req, res) => {
    const rows = await supplierPaymentService.getSupplierPayments(req.query.supplier_id);
    res.json(rows);
});

export const createSupplierPayment = catchAsync(async (req, res) => {
    try {
        const result = await supplierPaymentService.createSupplierPayment(req.body, req.user?.id, getRequestIp(req));
        res.json(result);
    } catch (err) {
        if (err.errorCode === 'MISSING_SUPPLIER') {
            return res.status(400).json({ error: 'missing_supplier', message: err.message });
        }
        if (err.errorCode === 'MISSING_PAYMENTS') {
            return res.status(400).json({ error: 'missing_payments', message: err.message });
        }
        throw err;
    }
});

export const createQualityCheck = catchAsync(async (req, res) => {
    const {
        reception_id,
        product_id,
        result,
        quantity_checked,
        quantity_passed,
        quantity_failed,
        defect_description,
        action_taken,
        notes
    } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [receptions] = await connection.query(
            'SELECT id, status FROM receptions WHERE id = ? FOR UPDATE',
            [reception_id]
        );
        if (receptions.length === 0) {
            const error = new Error('Recepción no encontrada');
            error.statusCode = 404;
            throw error;
        }
        if (receptions[0].status !== 'pending_qc') {
            const error = new Error('El control de calidad sólo puede modificarse mientras la recepción está pendiente');
            error.statusCode = 409;
            throw error;
        }

        const [receptionItems] = await connection.query(
            `SELECT id, quantity_received
             FROM reception_items
             WHERE reception_id = ? AND product_id = ?
             FOR UPDATE`,
            [reception_id, product_id]
        );
        if (receptionItems.length !== 1) {
            const error = new Error(receptionItems.length === 0
                ? 'El producto no pertenece a la recepción'
                : 'El producto está repetido en la recepción; unifique las líneas antes de controlar');
            error.statusCode = 409;
            throw error;
        }
        const receivedQuantity = Number(receptionItems[0].quantity_received || 0);
        if (Number(quantity_checked) !== receivedQuantity
            || Number(quantity_passed) + Number(quantity_failed) !== receivedQuantity) {
            const error = new Error('El control de calidad debe cubrir exactamente toda la cantidad recibida');
            error.statusCode = 409;
            throw error;
        }

        const [existingRows] = await connection.query(
            `SELECT * FROM quality_checks
             WHERE reception_id = ? AND product_id = ?
             ORDER BY check_date DESC, id DESC
             LIMIT 1 FOR UPDATE`,
            [reception_id, product_id]
        );
        const id = existingRows[0]?.id || crypto.randomUUID();
        const authenticatedInspectorId = req.user?.id || null;
        const values = [
            authenticatedInspectorId,
            result,
            quantity_checked,
            quantity_passed,
            quantity_failed,
            defect_description || null,
            action_taken || 'approve',
            notes || null
        ];
        if (existingRows.length > 0) {
            await connection.query(
                `UPDATE quality_checks
                 SET inspector_id = ?, result = ?, quantity_checked = ?, quantity_passed = ?,
                     quantity_failed = ?, defect_description = ?, action_taken = ?, notes = ?, check_date = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [...values, id]
            );
        } else {
            await connection.query(
                `INSERT INTO quality_checks (
                    id, reception_id, product_id, inspector_id, result,
                    quantity_checked, quantity_passed, quantity_failed, defect_description, action_taken, notes
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, reception_id, product_id, ...values]
            );
        }

        const safeValues = {
            id,
            reception_id,
            product_id,
            inspector_id: authenticatedInspectorId,
            result,
            quantity_checked,
            quantity_passed,
            quantity_failed,
            defect_description: defect_description || null,
            action_taken: action_taken || 'approve',
            notes: notes || null
        };
        await auditService.log({
            user_id: authenticatedInspectorId,
            action: existingRows.length > 0 ? 'UPDATE_QUALITY_CHECK' : 'CREATE_QUALITY_CHECK',
            entity_type: 'quality_check',
            entity_id: id,
            old_values: existingRows[0] || null,
            new_values: safeValues,
            ip_address: getRequestIp(req)
        }, connection);
        await connection.commit();
        res.json({ id, success: true });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

export const exportIVACompras = catchAsync(async (req, res) => {
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

    const taxRate = await getTaxRate();

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

    res.json(records);
});
