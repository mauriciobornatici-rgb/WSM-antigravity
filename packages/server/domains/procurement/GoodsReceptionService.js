import crypto from 'crypto';
import pool from '../../config/db.js';
import accountingService from '../../services/accounting.service.js';

export class GoodsReceptionService {
    async processReceptionApproval(receptionId, options = {}) {
        const approvedBy = options.approvedBy || null;
        const actorUserId = options.actorUserId || null;
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
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

            for (const item of items) {
                const location = item.location_assigned || 'General';

                const [qcRows] = await connection.query(`
                    SELECT quantity_passed, quantity_failed
                    FROM quality_checks
                    WHERE reception_id = ? AND product_id = ?
                    LIMIT 1
                `, [receptionId, item.product_id]);

                let passedQty = item.quantity_received;
                let failedQty = 0;

                if (qcRows.length > 0) {
                    passedQty = Number(qcRows[0].quantity_passed ?? item.quantity_received);
                    failedQty = Number(qcRows[0].quantity_failed ?? 0);
                }

                if (passedQty + failedQty !== item.quantity_received) {
                    passedQty = item.quantity_received;
                    failedQty = 0;
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

                if (item.po_item_id) {
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

            let netPurchaseSubtotal = 0;
            for (const item of items) {
                netPurchaseSubtotal += Number(item.quantity_received || 0) * Number(item.unit_cost || 0);
            }
            netPurchaseSubtotal = Math.round(netPurchaseSubtotal * 100) / 100;
            const vatAmount = Math.round((netPurchaseSubtotal * 0.21) * 100) / 100;
            const totalPurchase = Math.round((netPurchaseSubtotal + vatAmount) * 100) / 100;

            if (totalPurchase > 0) {
                await accountingService.createJournalEntry(connection, {
                    date: reception.reception_date || new Date(),
                    description: `Ingreso de Mercadería - Recepción ${reception.reception_number}`,
                    reference_type: 'reception',
                    reference_id: reception.id,
                    lines: [
                        { account_code: '1.1.04.01', debit: netPurchaseSubtotal, credit: 0, notes: 'Ingreso al Almacén' },
                        { account_code: '1.1.05.02', debit: vatAmount, credit: 0, notes: 'IVA Crédito Fiscal 21%' },
                        { account_code: '2.1.01.01', debit: 0, credit: totalPurchase, notes: `Cuenta Corriente Proveedor` }
                    ]
                });
            }

            await connection.query(
                'UPDATE receptions SET status = "approved", approved_by = ? WHERE id = ?',
                [approvedBy, receptionId]
            );

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
