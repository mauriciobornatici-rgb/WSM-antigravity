import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class GoodsReceptionService {
    async processReceptionApproval(receptionId, options = {}) {
        const approvedBy = options.approvedBy || null;
        const actorUserId = options.actorUserId || null;
        const ipAddress = options.ipAddress || null;
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();
            const [receptions] = await connection.query('SELECT * FROM receptions WHERE id = ? FOR UPDATE', [receptionId]);
            if (receptions.length === 0) {
                const err = new Error('Reception not found');
                err.errorCode = 'RECEPTION_NOT_FOUND';
                throw err;
            }
            const reception = receptions[0];
            if (reception.status === 'approved') {
                const err = new Error('Reception already approved');
                err.errorCode = 'RECEPTION_ALREADY_APPROVED';
                throw err;
            }

            const [items] = await connection.query('SELECT * FROM reception_items WHERE reception_id = ?', [receptionId]);
            if (items.length === 0) {
                const err = new Error('Reception has no items');
                err.errorCode = 'RECEPTION_HAS_NO_ITEMS';
                throw err;
            }

            const uniqueProducts = new Set(items.map((item) => item.product_id));
            if (uniqueProducts.size !== items.length) {
                const err = new Error('La recepción contiene el mismo producto en más de una línea; unifique las cantidades antes del control de calidad');
                err.errorCode = 'RECEPTION_DUPLICATE_PRODUCT_ITEMS';
                err.statusCode = 409;
                throw err;
            }

            for (const item of items) {
                const location = item.location_assigned || 'General';

                const [qcRows] = await connection.query(`
                    SELECT quantity_checked, quantity_passed, quantity_failed, defect_description
                    FROM quality_checks
                    WHERE reception_id = ? AND product_id = ?
                    ORDER BY check_date DESC, id DESC
                    LIMIT 1
                `, [receptionId, item.product_id]);

                if (qcRows.length === 0) {
                    const err = new Error(`Falta el control de calidad del producto ${item.product_id}`);
                    err.errorCode = 'RECEPTION_QC_INCOMPLETE';
                    err.statusCode = 409;
                    throw err;
                }

                const receivedQty = Number(item.quantity_received || 0);
                const checkedQty = Number(qcRows[0].quantity_checked || 0);
                const passedQty = Number(qcRows[0].quantity_passed || 0);
                const failedQty = Number(qcRows[0].quantity_failed || 0);
                if (checkedQty !== receivedQty || passedQty + failedQty !== receivedQty) {
                    const err = new Error(`El control de calidad del producto ${item.product_id} no cubre toda la cantidad recibida`);
                    err.errorCode = 'RECEPTION_QC_INVALID';
                    err.statusCode = 409;
                    throw err;
                }

                const updateStock = async (loc, qty, isFailed = false) => {
                    if (qty <= 0) return;

                    await connection.query(`
                        INSERT INTO inventory_movements (
                            id, type, product_id, to_location, quantity, unit_cost,
                            reference_type, reference_id, performed_by, reason
                        ) VALUES (?, 'reception', ?, ?, ?, ?, 'reception', ?, ?, ?)
                    `, [
                        crypto.randomUUID(),
                        item.product_id,
                        loc,
                        qty,
                        item.unit_cost || 0,
                        receptionId,
                        actorUserId,
                        isFailed ? 'Control de Calidad: Mercadería defectuosa segregada' : 'Recepción aprobada'
                    ]);

                    const [existingInventory] = await connection.query(
                        'SELECT id FROM inventory WHERE product_id = ? AND location = ? LIMIT 1',
                        [item.product_id, loc]
                    );

                    if (existingInventory.length > 0) {
                        await connection.query(
                            'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                            [qty, existingInventory[0].id]
                        );
                    } else {
                        await connection.query(
                            'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                            [crypto.randomUUID(), item.product_id, loc, qty]
                        );
                    }

                    if (item.batch_number) {
                        await connection.query(`
                            INSERT INTO product_batches (
                                id, product_id, batch_number, expiration_date, supplier_id, reception_id,
                                quantity_initial, quantity_current, location
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE
                                quantity_current = quantity_current + VALUES(quantity_initial),
                                expiration_date = VALUES(expiration_date)
                        `, [
                            crypto.randomUUID(),
                            item.product_id,
                            item.batch_number,
                            item.expiration_date || null,
                            reception.supplier_id,
                            receptionId,
                            qty,
                            qty,
                            loc
                        ]);
                    }
                };

                await updateStock(location, passedQty, false);
                await updateStock('Cuarentena', failedQty, true);
                await connection.query(
                    `UPDATE reception_items
                     SET quantity_approved = ?, quantity_rejected = ?, rejection_reason = ?
                     WHERE id = ?`,
                    [passedQty, failedQty, qcRows[0].defect_description || null, item.id]
                );

                if (item.po_item_id) {
                    const [poItems] = await connection.query(
                        'SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE id = ? FOR UPDATE',
                        [item.po_item_id]
                    );
                    const pendingBalance = Number(poItems[0]?.quantity_ordered || 0) - Number(poItems[0]?.quantity_received || 0);
                    if (poItems.length === 0 || Number(item.quantity_received || 0) > pendingBalance) {
                        const err = new Error('La recepción excede el saldo pendiente de la orden y no puede aprobarse');
                        err.errorCode = 'RECEPTION_EXCEEDS_PENDING_QUANTITY';
                        err.statusCode = 409;
                        throw err;
                    }
                    await connection.query(
                        'UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?',
                        [item.quantity_received, item.po_item_id]
                    );
                }
            }

            if (reception.purchase_order_id) {
                const [totals] = await connection.query(`
                    SELECT
                        COALESCE(SUM(quantity_ordered), 0) AS ordered_qty,
                        COALESCE(SUM(quantity_received), 0) AS received_qty
                    FROM purchase_order_items
                    WHERE purchase_order_id = ?
                `, [reception.purchase_order_id]);

                const ordered = Number(totals[0].ordered_qty || 0);
                const received = Number(totals[0].received_qty || 0);
                let status = 'sent';
                if (received > 0 && received < ordered) status = 'partial';
                if (ordered > 0 && received >= ordered) status = 'received';

                await connection.query(
                    'UPDATE purchase_orders SET status = ? WHERE id = ?',
                    [status, reception.purchase_order_id]
                );
            }

            // Accounting entry is posted once, from the supplier invoice
            // (see supplierInvoiceController.createSupplierInvoice), to avoid
            // double-posting the same purchase to the ledger.

            await connection.query(
                'UPDATE receptions SET status = "approved", approved_by = ? WHERE id = ?',
                [approvedBy, receptionId]
            );

            await auditService.log({
                user_id: actorUserId,
                action: 'APPROVE_RECEPTION',
                entity_type: 'reception',
                entity_id: receptionId,
                old_values: { status: reception.status },
                new_values: { status: 'approved', approved_by: approvedBy },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { success: true };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new GoodsReceptionService();
