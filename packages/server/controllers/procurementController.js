import crypto from 'crypto';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import inventoryService from '../services/inventory.service.js';
import auditService from '../services/audit.service.js';
import { nextDocumentSequence } from '../utils/documentSequence.js';

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

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
    const { supplier_id, status } = req.query;
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
    if (orders.length === 0) {
        return res.json(orders);
    }

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
        SELECT poi.*, p.name AS product_name, p.sku
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        WHERE poi.purchase_order_id = ?
    `, [id]);
    order.items = items;

    res.json(order);
});

export const createPurchaseOrder = catchAsync(async (req, res) => {
    const { supplier_id, order_date, expected_delivery_date, items, notes } = req.body;
    const id = crypto.randomUUID();

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const poNumber = await nextPONumber(connection);
        const taxRate = await getTaxRate(connection);

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
            user_id: req.user?.id || null,
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
            ip_address: getRequestIp(req)
        });
        res.json({ id, po_number: poNumber });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
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

        let effectiveSupplierId = supplier_id;
        if (!effectiveSupplierId && purchase_order_id) {
            const [po] = await connection.query('SELECT supplier_id FROM purchase_orders WHERE id = ?', [purchase_order_id]);
            if (po.length > 0) effectiveSupplierId = po[0].supplier_id;
        }
        if (!effectiveSupplierId) {
            throw new Error('supplier_id es obligatorio');
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

        await connection.commit();
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
        });
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
            actorUserId: req.user?.id || approverId || null
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
        throw err;
    }

    await auditService.log({
        user_id: req.user?.id || approverId || null,
        action: 'APPROVE_RECEPTION',
        entity_type: 'reception',
        entity_id: id,
        new_values: { status: 'approved', approved_by: approverId },
        ip_address: getRequestIp(req)
    });

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

        await connection.commit();
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
        });
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
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [returns] = await connection.query('SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE', [id]);
        if (returns.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Devolucion no encontrada' });
        }
        const supplierReturn = returns[0];
        if (supplierReturn.status === 'approved') {
            await connection.rollback();
            return res.status(400).json({ error: 'already_approved', message: 'La devolucion ya fue aprobada' });
        }

        const [items] = await connection.query('SELECT * FROM supplier_return_items WHERE return_id = ?', [id]);
        if (items.length === 0) {
            throw new Error('La devolucion no tiene items');
        }

        let totalAmount = 0;
        for (const item of items) {
            await decreaseInventory(connection, item.product_id, Number(item.quantity));
            totalAmount += Number(item.quantity) * Number(item.unit_cost || 0);

            await connection.query(`
                INSERT INTO inventory_movements (
                    id, type, product_id, from_location, quantity, unit_cost, reason, reference_type, reference_id
                ) VALUES (?, 'return', ?, ?, ?, ?, ?, 'supplier_return', ?)
            `, [
                crypto.randomUUID(),
                item.product_id,
                'General',
                item.quantity,
                item.unit_cost || 0,
                item.reason || 'Return to supplier',
                id
            ]);
        }

        await connection.query('UPDATE supplier_returns SET status = "approved" WHERE id = ?', [id]);

        await connection.query(`
            INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
            VALUES (?, 'expense', ?, ?, ?, ?)
        `, [
            crypto.randomUUID(),
            totalAmount,
            `Devolucion a proveedor ${supplierReturn.return_number}`,
            id,
            supplierReturn.supplier_id
        ]);

        await connection.query(`
            UPDATE suppliers
            SET account_balance = GREATEST(COALESCE(account_balance, 0) - ?, 0)
            WHERE id = ?
        `, [totalAmount, supplierReturn.supplier_id]);

        await connection.commit();
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'APPROVE_SUPPLIER_RETURN',
            entity_type: 'supplier_return',
            entity_id: id,
            old_values: { status: supplierReturn.status },
            new_values: { status: 'approved', total_amount: totalAmount },
            ip_address: getRequestIp(req)
        });
        res.json({ success: true, message: 'Devolucion aprobada correctamente' });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const getSupplierPayments = catchAsync(async (req, res) => {
    const { supplier_id } = req.query;
    let query = `
        SELECT sp.*, s.name AS supplier_name
        FROM supplier_payments sp
        LEFT JOIN suppliers s ON sp.supplier_id = s.id
        WHERE 1=1
    `;
    const params = [];
    if (supplier_id) {
        query += ' AND sp.supplier_id = ?';
        params.push(supplier_id);
    }
    query += ' ORDER BY sp.payment_date DESC, sp.created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
});

export const createSupplierPayment = catchAsync(async (req, res) => {
    const { supplier_id, payment_date, notes, payments } = req.body;

    if (!supplier_id) {
        return res.status(400).json({ error: 'missing_supplier', message: 'supplier_id es obligatorio' });
    }
    if (!Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ error: 'missing_payments', message: 'Debe incluir al menos una linea de pago' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let total = 0;
        const createdIds = [];
        for (const payment of payments) {
            const amount = Number(payment.amount || 0);
            if (amount <= 0) continue;

            const id = crypto.randomUUID();
            createdIds.push(id);
            total += amount;

            await connection.query(`
                INSERT INTO supplier_payments (id, supplier_id, amount, payment_date, payment_method, reference_number, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                supplier_id,
                amount,
                payment_date || new Date().toISOString().slice(0, 10),
                payment.payment_method || 'Efectivo',
                payment.reference_number || null,
                notes || null
            ]);
        }

        if (total <= 0) {
            throw new Error('El monto total del pago debe ser mayor a 0');
        }

        await connection.query(`
            UPDATE suppliers
            SET account_balance = GREATEST(COALESCE(account_balance, 0) - ?, 0)
            WHERE id = ?
        `, [total, supplier_id]);

        await connection.query(`
            INSERT INTO transactions (id, type, amount, description, reference_id, supplier_id)
            VALUES (?, 'expense', ?, ?, ?, ?)
        `, [
            crypto.randomUUID(),
            total,
            'Pago a proveedor',
            createdIds[0] || null,
            supplier_id
        ]);

        await connection.commit();
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'CREATE_SUPPLIER_PAYMENT',
            entity_type: 'supplier_payment',
            entity_id: createdIds[0] || null,
            new_values: {
                supplier_id,
                payment_date: payment_date || new Date().toISOString().slice(0, 10),
                notes: notes || null,
                payment_ids: createdIds,
                total
            },
            ip_address: getRequestIp(req)
        });
        res.json({ success: true, ids: createdIds, total });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const createQualityCheck = catchAsync(async (req, res) => {
    const id = crypto.randomUUID();
    const {
        reception_id,
        product_id,
        inspector_id,
        result,
        quantity_checked,
        quantity_passed,
        quantity_failed,
        defect_description,
        action_taken,
        notes
    } = req.body;

    await pool.query(`
        INSERT INTO quality_checks (
            id, reception_id, product_id, inspector_id, result,
            quantity_checked, quantity_passed, quantity_failed, defect_description, action_taken, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        reception_id,
        product_id,
        inspector_id || null,
        result,
        quantity_checked || 0,
        quantity_passed || 0,
        quantity_failed || 0,
        defect_description || null,
        action_taken || 'approve',
        notes || null
    ]);

    await auditService.log({
        user_id: req.user?.id || inspector_id || null,
        action: 'CREATE_QUALITY_CHECK',
        entity_type: 'quality_check',
        entity_id: id,
        new_values: {
            id,
            reception_id,
            product_id,
            inspector_id: inspector_id || null,
            result,
            quantity_checked: quantity_checked || 0,
            quantity_passed: quantity_passed || 0,
            quantity_failed: quantity_failed || 0,
            defect_description: defect_description || null,
            action_taken: action_taken || 'approve',
            notes: notes || null
        },
        ip_address: getRequestIp(req)
    });

    res.json({ id, success: true });
});
