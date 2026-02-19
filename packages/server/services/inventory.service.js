import crypto from 'crypto';
import BaseService from './base.service.js';
import pool from '../config/db.js';
import auditService from './audit.service.js';

class InventoryService extends BaseService {
    constructor() {
        super('products');
    }

    async getProductsWithInventoryStock(filters = {}, options = {}) {
        let query = `
            SELECT
                p.*,
                COALESCE(inv.total_quantity, 0) AS inventory_stock_current
            FROM products p
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS total_quantity
                FROM inventory
                GROUP BY product_id
            ) inv ON inv.product_id = p.id
            WHERE p.deleted_at IS NULL
        `;
        const params = [];

        if (filters.supplier_id) {
            query += ' AND p.supplier_id = ?';
            params.push(filters.supplier_id);
        }

        let total = null;
        if (options.includeTotal) {
            let countQuery = 'SELECT COUNT(*) AS total FROM products p WHERE p.deleted_at IS NULL';
            const countParams = [];
            if (filters.supplier_id) {
                countQuery += ' AND p.supplier_id = ?';
                countParams.push(filters.supplier_id);
            }
            const [countRows] = await pool.query(countQuery, countParams);
            total = Number(countRows[0]?.total || 0);
        }

        query += ' ORDER BY p.created_at DESC';
        if (options.limit != null) {
            query += ' LIMIT ?';
            params.push(Number(options.limit));
            if (options.offset != null) {
                query += ' OFFSET ?';
                params.push(Number(options.offset));
            }
        }

        const [rows] = await pool.query(query, params);
        const mappedRows = rows.map((row) => {
            const { inventory_stock_current, ...product } = row;
            return {
                ...product,
                stock_current: Number(inventory_stock_current || 0)
            };
        });

        if (options.includeTotal) {
            return { rows: mappedRows, total: total ?? mappedRows.length };
        }

        return mappedRows;
    }

    async getInventoryWithDetails() {
        const [rows] = await pool.query(`
            SELECT i.*, p.name AS product_name, p.sku, p.category
            FROM inventory i
            LEFT JOIN products p ON i.product_id = p.id
            ORDER BY p.name ASC, i.location ASC
        `);
        return rows;
    }

    async createProduct(productData, userId) {
        const id = crypto.randomUUID();
        const normalized = { ...productData };

        if (normalized.cost_price != null && normalized.purchase_price == null) {
            normalized.purchase_price = normalized.cost_price;
        }
        delete normalized.cost_price;

        const data = { id, ...normalized };
        const result = await this.create(data);

        await auditService.log({
            user_id: userId,
            action: 'CREATE_PRODUCT',
            entity_type: 'product',
            entity_id: id,
            new_values: data
        });

        return result;
    }

    async getMovements(filters = {}, options = {}) {
        let query = `
            SELECT im.*, p.name AS product_name, p.sku
            FROM inventory_movements im
            LEFT JOIN products p ON im.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.product_id) {
            query += ' AND im.product_id = ?';
            params.push(filters.product_id);
        }
        if (filters.type) {
            query += ' AND im.type = ?';
            params.push(filters.type);
        }
        if (filters.start_date) {
            query += ' AND DATE(im.created_at) >= DATE(?)';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            query += ' AND DATE(im.created_at) <= DATE(?)';
            params.push(filters.end_date);
        }

        query += ' ORDER BY im.created_at DESC';

        if (options.limit) {
            query += ' LIMIT ?';
            params.push(Number(options.limit));
        }

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async recordMovement(movementData, userId) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO inventory_movements
            (id, type, product_id, from_location, to_location, quantity,
             unit_cost, reason, reference_type, reference_id, notes, performed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            movementData.type,
            movementData.product_id,
            movementData.from_location || null,
            movementData.to_location || null,
            movementData.quantity,
            movementData.unit_cost || 0,
            movementData.reason || null,
            movementData.reference_type || 'manual',
            movementData.reference_id || null,
            movementData.notes || null,
            movementData.performed_by || userId || null
        ]);

        await auditService.log({
            user_id: userId,
            action: 'INVENTORY_MOVEMENT',
            entity_type: 'inventory',
            entity_id: movementData.product_id,
            new_values: movementData
        });

        return { id, ...movementData };
    }

    async getProductMovements(productId) {
        return this.getMovements({ product_id: productId });
    }

    async getBatches({ product_id, status } = {}) {
        let query = `
            SELECT b.*, p.name AS product_name
            FROM product_batches b
            JOIN products p ON b.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (product_id) {
            query += ' AND b.product_id = ?';
            params.push(product_id);
        }
        if (status) {
            query += ' AND b.status = ?';
            params.push(status);
        }

        query += ' ORDER BY b.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createBatch(data) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO product_batches (
                id, product_id, batch_number, manufacturing_date, expiration_date,
                supplier_id, quantity_initial, quantity_current, location, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            data.product_id,
            data.batch_number,
            data.manufacturing_date || null,
            data.expiration_date || null,
            data.supplier_id || null,
            data.quantity_initial,
            data.quantity_initial,
            data.location || null,
            data.notes || null
        ]);

        return { id };
    }

    async updateBatch(id, data) {
        await pool.query(
            `UPDATE product_batches SET quantity_current = ?, status = COALESCE(?, status) WHERE id = ?`,
            [data.quantity_current, data.status || null, id]
        );
        const [rows] = await pool.query('SELECT * FROM product_batches WHERE id = ?', [id]);
        return rows[0] || null;
    }

    async getSerials({ product_id, status } = {}) {
        let query = `
            SELECT s.*, p.name AS product_name
            FROM serial_numbers s
            JOIN products p ON s.product_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (product_id) {
            query += ' AND s.product_id = ?';
            params.push(product_id);
        }
        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }

        query += ' ORDER BY s.created_at DESC';
        const [rows] = await pool.query(query, params);
        return rows;
    }

    async createSerialNumber(data) {
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO serial_numbers (
                id, product_id, serial_number, batch_id, location, status, warranty_expiration
            ) VALUES (?, ?, ?, ?, ?, 'available', ?)
        `, [
            id,
            data.product_id,
            data.serial_number,
            data.batch_id || null,
            data.location || null,
            data.warranty_months
                ? new Date(Date.now() + data.warranty_months * 30 * 24 * 60 * 60 * 1000)
                : null
        ]);
        return { id };
    }

    async updateSerialNumber(id, data) {
        const allowed = ['status', 'sold_to_client_id', 'sold_in_order_id', 'location'];
        const keys = Object.keys(data).filter((k) => allowed.includes(k));
        if (keys.length === 0) return null;

        const setClause = keys.map((k) => `${k} = ?`).join(', ');
        const values = keys.map((k) => data[k]);

        await pool.query(`UPDATE serial_numbers SET ${setClause} WHERE id = ?`, [...values, id]);
        const [rows] = await pool.query('SELECT * FROM serial_numbers WHERE id = ?', [id]);
        return rows[0] || null;
    }

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

                await connection.query(`
                    INSERT INTO inventory_movements (
                        id, type, product_id, to_location, quantity, unit_cost,
                        reference_type, reference_id, performed_by
                    ) VALUES (?, 'reception', ?, ?, ?, ?, 'reception', ?, ?)
                `, [
                    crypto.randomUUID(),
                    item.product_id,
                    location,
                    item.quantity_received,
                    item.unit_cost || 0,
                    receptionId,
                    actorUserId
                ]);

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
                        item.quantity_received,
                        item.quantity_received,
                        location
                    ]);
                }

                const [existingInventory] = await connection.query(
                    'SELECT id FROM inventory WHERE product_id = ? AND location = ? LIMIT 1',
                    [item.product_id, location]
                );

                if (existingInventory.length > 0) {
                    await connection.query(
                        'UPDATE inventory SET quantity = quantity + ? WHERE id = ?',
                        [item.quantity_received, existingInventory[0].id]
                    );
                } else {
                    await connection.query(
                        'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                        [crypto.randomUUID(), item.product_id, location, item.quantity_received]
                    );
                }

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

export default new InventoryService();
