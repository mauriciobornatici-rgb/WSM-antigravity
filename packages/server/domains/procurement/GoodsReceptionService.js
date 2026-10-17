import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';
import accountingService from '../../services/accounting.service.js';
import defaultValuation, { effectiveCost, isValuedLocation, roundCost, valueCents } from '../inventory/InventoryValuation.js';
import { ACCOUNTS } from '../../utils/paymentAccounts.js';
import { businessError } from '../../utils/businessError.js';

export class GoodsReceptionService {
    constructor({ valuation = defaultValuation } = {}) {
        this.valuation = valuation;
    }

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

            // Lock the order before its items (same order as createReception) and refuse
            // to bring stock in against a cancelled order (ADR-012).
            let currentOrderStatus = null;
            if (reception.purchase_order_id) {
                const [orders] = await connection.query(
                    'SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE',
                    [reception.purchase_order_id]
                );
                currentOrderStatus = orders[0]?.status ?? null;
                if (currentOrderStatus === 'cancelled') {
                    const err = new Error('La orden de compra está anulada; la recepción no puede aprobarse');
                    err.errorCode = 'RECEPTION_PURCHASE_ORDER_CANCELLED';
                    err.statusCode = 409;
                    throw err;
                }
            }

            const [items] = await connection.query('SELECT * FROM reception_items WHERE reception_id = ? ORDER BY id FOR UPDATE', [receptionId]);
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
            // ADR-027: the goods enter the ledger at the delivery note's cost, so it must have one.
            const uncosted = items.filter((item) => !(roundCost(item.unit_cost) > 0));
            if (uncosted.length > 0) {
                const err = new Error('Falta el costo de algún producto del remito: cargalo en la orden de compra o en el remito antes de aprobar.');
                err.errorCode = 'RECEPTION_COST_REQUIRED';
                err.statusCode = 409;
                throw err;
            }

            // The order's lines before the stock (L2 before L3, ADR-027), in a stable order.
            const poItemIds = items.map((item) => item.po_item_id).filter(Boolean).sort();
            const [poItemRows] = poItemIds.length > 0
                ? await connection.query(
                    'SELECT id, quantity_ordered, quantity_received FROM purchase_order_items WHERE id IN (?) ORDER BY id FOR UPDATE',
                    [poItemIds]
                )
                : [[]];
            const poItemsById = new Map(poItemRows.map((row) => [row.id, row]));

            const checks = new Map();
            for (const item of items) {
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
                checks.set(item.id, qcRows[0]);
            }

            // The stock of every product (L3), then the products FOR UPDATE (L4): a purchase at
            // another cost changes the product's cost and revalues its stock (D1).
            const productIds = items.map((item) => item.product_id);
            const stockByProduct = await this.valuation.lockStock(connection, productIds);
            const products = await this.valuation.lockCosts(connection, productIds, { forUpdate: true });
            let inventoryCents = 0;
            let lossCents = 0;
            let bridgeCents = 0;
            const movementIds = [];

            for (const item of items) {
                const location = item.location_assigned || 'General';
                const qc = checks.get(item.id);
                const passedQty = Number(qc.quantity_passed || 0);
                const failedQty = Number(qc.quantity_failed || 0);
                const receiptCost = roundCost(item.unit_cost);
                const product = products.get(item.product_id) || { id: item.product_id };
                // D1: the cost becomes the delivery note's, unless the product keeps a fixed cost (then
                // the difference is holding result). A product without a cost always takes it (D6).
                const fixedCost = Number(product.auto_update_cost ?? 1) === 0 && effectiveCost(product) > 0;
                const valuedCost = fixedCost ? effectiveCost(product) : receiptCost;
                if (!fixedCost) {
                    await this.valuation.changeCost(connection, {
                        product,
                        stockRows: stockByProduct.get(item.product_id) || [],
                        newCost: receiptCost,
                        userId: actorUserId,
                        source: 'reception',
                        details: { reception_id: receptionId },
                    });
                }

                const updateStock = async (loc, qty, isFailed = false) => {
                    if (qty <= 0) return;
                    const valued = isValuedLocation(loc);
                    bridgeCents += valueCents(qty, receiptCost);
                    if (valued) inventoryCents += valueCents(qty, valuedCost);
                    else lossCents += valueCents(qty, receiptCost);

                    const movementId = crypto.randomUUID();
                    movementIds.push(movementId);
                    await connection.query(`
                        INSERT INTO inventory_movements (
                            id, type, product_id, to_location, quantity, unit_cost,
                            reference_type, reference_id, performed_by, reason
                        ) VALUES (?, 'reception', ?, ?, ?, ?, 'reception', ?, ?, ?)
                    `, [
                        movementId,
                        item.product_id,
                        loc,
                        qty,
                        valued ? valuedCost : 0,
                        receptionId,
                        actorUserId,
                        isFailed ? 'Control de Calidad: Mercadería defectuosa segregada' : 'Recepción aprobada'
                    ]);

                    // From the rows locked above (a plain read could miss a row committed meanwhile).
                    const productRows = stockByProduct.get(item.product_id) || [];
                    const existing = productRows.find((row) => row.location === loc);
                    if (existing) {
                        await connection.query(
                            'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                            [qty, existing.id]
                        );
                    } else {
                        const inventoryId = crypto.randomUUID();
                        await connection.query(
                            'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                            [inventoryId, item.product_id, loc, qty]
                        );
                        productRows.push({ id: inventoryId, product_id: item.product_id, location: loc, quantity: 0, reserved_quantity: 0 });
                        stockByProduct.set(item.product_id, productRows);
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
                    [passedQty, failedQty, qc.defect_description || null, item.id]
                );

                if (item.po_item_id) {
                    const poItem = poItemsById.get(item.po_item_id);
                    const pendingBalance = Number(poItem?.quantity_ordered || 0) - Number(poItem?.quantity_received || 0);
                    if (!poItem || Number(item.quantity_received || 0) > pendingBalance) {
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
                // An order closed by hand as received stays received (orders only move forward).
                if (currentOrderStatus === 'received') status = 'received';

                if (status !== currentOrderStatus) {
                    await connection.query(
                        'UPDATE purchase_orders SET status = ? WHERE id = ?',
                        [status, reception.purchase_order_id]
                    );
                }
            }

            // ADR-027: the goods enter the ledger now, against what is owed for them until the supplier
            // invoices it (2.1.01.02); the invoice clears that account. Never reference_type
            // 'reception': the duplicate-entries runbook reverses those (N5).
            const holdingCents = inventoryCents + lossCents - bridgeCents;
            const entryId = await accountingService.createJournalEntryIfAny(connection, {
                date: new Date(),
                description: `Mercadería recibida ${reception.remito_number ? `remito ${reception.remito_number}` : reception.reception_number || receptionId.slice(0, 8)}`,
                reference_type: 'goods_received',
                reference_id: receptionId,
                lines: [
                    { account_code: ACCOUNTS.INVENTORY, debit: inventoryCents / 100, credit: 0, notes: 'Mercadería ingresada al depósito' },
                    { account_code: ACCOUNTS.INVENTORY_LOSSES, debit: lossCents / 100, credit: 0, notes: 'Ingresada a una ubicación sin valor' },
                    { account_code: ACCOUNTS.HOLDING_RESULT, debit: holdingCents < 0 ? -holdingCents / 100 : 0, credit: holdingCents > 0 ? holdingCents / 100 : 0, notes: 'Diferencia con el costo fijo del producto' },
                    { account_code: ACCOUNTS.GOODS_TO_INVOICE, debit: 0, credit: bridgeCents / 100, notes: 'Mercadería recibida a facturar' },
                ],
            });
            await this.valuation.linkMovements(connection, movementIds, entryId);

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
            if (error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT') {
                throw businessError(409, { error: 'busy', message: 'Otra operación estaba usando estos productos. Reintentá en unos segundos.' });
            }
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new GoodsReceptionService();
