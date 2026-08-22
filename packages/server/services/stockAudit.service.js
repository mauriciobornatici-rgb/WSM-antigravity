import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';

const ACTIVE_STATUS = 'in_progress';
const FINAL_STATUSES = new Set(['completed', 'adjusted']);

function businessError(message, statusCode, errorCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.errorCode = errorCode;
    return error;
}

function asNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyStockByValue(rows) {
    const sorted = rows
        .map((row) => ({
            product_id: row.product_id,
            stock_value: Math.max(0, asNumber(row.purchase_price)) * Math.max(0, asNumber(row.total_stock)),
        }))
        .sort((left, right) => right.stock_value - left.stock_value);
    const totalValue = sorted.reduce((total, row) => total + row.stock_value, 0);
    const classes = new Map();
    let cumulative = 0;
    let classACount = 0;

    for (const row of sorted) {
        cumulative += row.stock_value;
        const share = totalValue > 0 ? (cumulative / totalValue) * 100 : 0;
        let abcClass = 'C';
        if (totalValue > 0 && (share <= 80 || classACount === 0)) {
            abcClass = 'A';
            classACount += 1;
        } else if (totalValue > 0 && share <= 95) {
            abcClass = 'B';
        }
        classes.set(row.product_id, abcClass);
    }

    return classes;
}

function normalizeItem(row) {
    return {
        ...row,
        expected_quantity: asNumber(row.expected_quantity),
        counted_quantity: row.counted_quantity == null ? null : asNumber(row.counted_quantity),
        variance: row.variance == null ? null : asNumber(row.variance),
        is_unexpected: Boolean(row.is_unexpected),
        count_attempts: Number(row.count_attempts || 0),
    };
}

function normalizeSession(row) {
    const totalItems = Number(row.total_items || 0);
    const countedItems = Number(row.counted_items || 0);
    const exactItems = Number(row.exact_items || 0);
    return {
        ...row,
        blind_count: Boolean(row.blind_count),
        total_items: totalItems,
        counted_items: countedItems,
        pending_items: Math.max(0, totalItems - countedItems),
        exact_items: exactItems,
        variance_units: asNumber(row.variance_units),
        accuracy_percent: countedItems > 0 ? Math.round((exactItems / countedItems) * 10000) / 100 : 0,
    };
}

class StockAuditService {
    async getAbcMap(executor = pool) {
        const [rows] = await executor.query(`
            SELECT p.id AS product_id, p.purchase_price,
                   COALESCE(SUM(CASE
                       WHEN i.location NOT IN ('Cuarentena', 'Devoluciones a Proveedores', 'Mermas')
                       THEN i.quantity ELSE 0 END), 0) AS total_stock
            FROM products p
            LEFT JOIN inventory i ON i.product_id = p.id
            WHERE p.deleted_at IS NULL
            GROUP BY p.id, p.purchase_price
        `);
        return classifyStockByValue(rows);
    }

    async listSessions(filters = {}, executor = pool) {
        const params = [];
        let where = 'WHERE 1 = 1';
        if (filters.status) {
            where += ' AND session.status = ?';
            params.push(filters.status);
        }
        if (filters.abc_class) {
            where += ' AND session.abc_class = ?';
            params.push(filters.abc_class);
        }
        if (filters.location_code) {
            where += ' AND session.location_code = ?';
            params.push(filters.location_code);
        }

        const [rows] = await executor.query(`
            SELECT session.*, location.name AS location_name, creator.name AS created_by_name,
                   adjuster.name AS adjusted_by_name,
                   (SELECT COUNT(*) FROM stock_audit_items item WHERE item.audit_id = session.id) AS total_items,
                   (SELECT COUNT(*) FROM stock_audit_items item WHERE item.audit_id = session.id AND item.counted_quantity IS NOT NULL) AS counted_items,
                   (SELECT COUNT(*) FROM stock_audit_items item WHERE item.audit_id = session.id AND item.counted_quantity IS NOT NULL AND item.variance = 0) AS exact_items,
                   (SELECT COALESCE(SUM(ABS(item.variance)), 0) FROM stock_audit_items item WHERE item.audit_id = session.id AND item.counted_quantity IS NOT NULL) AS variance_units
            FROM stock_audit_sessions session
            LEFT JOIN warehouse_locations location ON location.code = session.location_code
            LEFT JOIN users creator ON creator.id = session.created_by
            LEFT JOIN users adjuster ON adjuster.id = session.adjusted_by
            ${where}
            ORDER BY session.started_at DESC
            LIMIT 50
        `, params);
        return rows.map(normalizeSession);
    }

    async getDashboard(filters = {}) {
        const sessions = await this.listSessions(filters);
        const [totalsRows] = await pool.query(`
            SELECT COUNT(DISTINCT session.id) AS total_audits,
                   COUNT(item.id) AS counted_items,
                   SUM(CASE WHEN item.variance = 0 THEN 1 ELSE 0 END) AS exact_items,
                   COALESCE(SUM(ABS(item.variance)), 0) AS variance_units
            FROM stock_audit_sessions session
            LEFT JOIN stock_audit_items item ON item.audit_id = session.id AND item.counted_quantity IS NOT NULL
            WHERE session.status IN ('completed', 'adjusted')
        `);
        const [classRows] = await pool.query(`
            SELECT item.abc_class,
                   COUNT(*) AS counted_items,
                   SUM(CASE WHEN item.variance = 0 THEN 1 ELSE 0 END) AS exact_items,
                   COALESCE(SUM(ABS(item.variance)), 0) AS variance_units
            FROM stock_audit_items item
            INNER JOIN stock_audit_sessions session ON session.id = item.audit_id
            WHERE session.status IN ('completed', 'adjusted') AND item.counted_quantity IS NOT NULL
            GROUP BY item.abc_class
            ORDER BY item.abc_class
        `);
        const totals = totalsRows[0] || {};
        const countedItems = Number(totals.counted_items || 0);
        const exactItems = Number(totals.exact_items || 0);
        const byClass = ['A', 'B', 'C'].map((abcClass) => {
            const row = classRows.find((candidate) => candidate.abc_class === abcClass) || {};
            const counted = Number(row.counted_items || 0);
            const exact = Number(row.exact_items || 0);
            return {
                abc_class: abcClass,
                counted_items: counted,
                exact_items: exact,
                variance_units: asNumber(row.variance_units),
                accuracy_percent: counted > 0 ? Math.round((exact / counted) * 10000) / 100 : 0,
            };
        });

        return {
            summary: {
                total_audits: Number(totals.total_audits || 0),
                active_audits: sessions.filter((session) => session.status === ACTIVE_STATUS).length,
                counted_items: countedItems,
                exact_items: exactItems,
                variance_units: asNumber(totals.variance_units),
                accuracy_percent: countedItems > 0 ? Math.round((exactItems / countedItems) * 10000) / 100 : 0,
            },
            by_class: byClass,
            sessions,
        };
    }

    async getSession(id, executor = pool) {
        const [sessionRows] = await executor.query(`
            SELECT session.*, location.name AS location_name, creator.name AS created_by_name,
                   adjuster.name AS adjusted_by_name
            FROM stock_audit_sessions session
            LEFT JOIN warehouse_locations location ON location.code = session.location_code
            LEFT JOIN users creator ON creator.id = session.created_by
            LEFT JOIN users adjuster ON adjuster.id = session.adjusted_by
            WHERE session.id = ?
            LIMIT 1
        `, [id]);
        if (sessionRows.length === 0) {
            throw businessError('La auditoría de stock no existe.', 404, 'STOCK_AUDIT_NOT_FOUND');
        }
        const [itemRows] = await executor.query(`
            SELECT item.*, product.name AS product_name, product.sku, product.barcode,
                   (SELECT COUNT(*) FROM stock_audit_count_events event WHERE event.audit_item_id = item.id) AS count_attempts,
                   counter.name AS counted_by_name
            FROM stock_audit_items item
            INNER JOIN products product ON product.id = item.product_id
            LEFT JOIN users counter ON counter.id = item.counted_by
            WHERE item.audit_id = ?
            ORDER BY item.counted_quantity IS NOT NULL, product.name, product.sku
        `, [id]);
        const items = itemRows.map(normalizeItem);
        const countedItems = items.filter((item) => item.counted_quantity != null).length;
        const exactItems = items.filter((item) => item.counted_quantity != null && item.variance === 0).length;
        const session = normalizeSession({
            ...sessionRows[0],
            total_items: items.length,
            counted_items: countedItems,
            exact_items: exactItems,
            variance_units: items.reduce((total, item) => total + Math.abs(item.variance || 0), 0),
        });
        return { ...session, items };
    }

    async createSession(data, userId) {
        const connection = await pool.getConnection();
        const id = crypto.randomUUID();
        const auditNumber = `AUD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${id.slice(0, 6).toUpperCase()}`;
        try {
            await connection.beginTransaction();
            const [locationRows] = await connection.query(
                'SELECT code, name FROM warehouse_locations WHERE code = ? AND active = TRUE LIMIT 1 FOR UPDATE',
                [data.location_code]
            );
            if (locationRows.length === 0) {
                throw businessError('La ubicación indicada no existe o está archivada.', 404, 'WAREHOUSE_LOCATION_NOT_FOUND');
            }
            const [activeRows] = await connection.query(
                `SELECT id FROM stock_audit_sessions
                 WHERE location_code = ? AND abc_class = ? AND status = 'in_progress'
                 LIMIT 1 FOR UPDATE`,
                [data.location_code, data.abc_class]
            );
            if (activeRows.length > 0) {
                throw businessError('Ya existe un conteo activo para esa ubicación y clase ABC.', 409, 'STOCK_AUDIT_ALREADY_ACTIVE');
            }

            const abcMap = await this.getAbcMap(connection);
            const [inventoryRows] = await connection.query(`
                SELECT MIN(i.id) AS inventory_id, i.product_id, SUM(i.quantity) AS expected_quantity,
                       p.name AS product_name, p.sku, p.barcode
                FROM inventory i
                INNER JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
                WHERE i.location = ?
                GROUP BY i.product_id, p.name, p.sku, p.barcode
                ORDER BY p.name, p.sku
            `, [data.location_code]);
            const scopedRows = inventoryRows.filter((row) => data.abc_class === 'ALL' || abcMap.get(row.product_id) === data.abc_class);
            if (scopedRows.length === 0) {
                throw businessError('No hay productos de la clase seleccionada en esa ubicación.', 400, 'STOCK_AUDIT_EMPTY_SCOPE');
            }

            await connection.query(`
                INSERT INTO stock_audit_sessions
                    (id, audit_number, location_code, abc_class, status, blind_count, notes, created_by)
                VALUES (?, ?, ?, ?, 'in_progress', TRUE, ?, ?)
            `, [id, auditNumber, data.location_code, data.abc_class, data.notes || null, userId || null]);

            const placeholders = scopedRows.map(() => '(?, ?, ?, ?, ?, ?, ?, FALSE)').join(', ');
            const values = scopedRows.flatMap((row) => [
                crypto.randomUUID(), id, row.inventory_id || null, row.product_id,
                data.location_code, abcMap.get(row.product_id) || 'C', asNumber(row.expected_quantity),
            ]);
            await connection.query(`
                INSERT INTO stock_audit_items
                    (id, audit_id, inventory_id, product_id, location_code, abc_class, expected_quantity, is_unexpected)
                VALUES ${placeholders}
            `, values);
            await auditService.log({
                user_id: userId || null,
                action: 'CREATE_STOCK_AUDIT',
                entity_type: 'stock_audit',
                entity_id: id,
                new_values: {
                    audit_number: auditNumber,
                    location_code: data.location_code,
                    abc_class: data.abc_class,
                    item_count: scopedRows.length,
                },
            }, connection);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return this.getSession(id);
    }

    async countItem(auditId, data, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [sessionRows] = await connection.query(
                'SELECT * FROM stock_audit_sessions WHERE id = ? LIMIT 1 FOR UPDATE',
                [auditId]
            );
            const session = sessionRows[0];
            if (!session) throw businessError('La auditoría de stock no existe.', 404, 'STOCK_AUDIT_NOT_FOUND');
            if (session.status !== ACTIVE_STATUS) {
                throw businessError('El conteo ya está cerrado y no admite cambios.', 409, 'STOCK_AUDIT_NOT_ACTIVE');
            }
            const normalizedCode = data.code.trim();
            const [productRows] = await connection.query(`
                SELECT id, name, sku, barcode
                FROM products
                WHERE deleted_at IS NULL AND (sku = ? OR barcode = ?)
                LIMIT 1
            `, [normalizedCode, normalizedCode]);
            const product = productRows[0];
            if (!product) {
                throw businessError('No se encontró un producto con ese SKU o código de barras.', 404, 'STOCK_AUDIT_PRODUCT_NOT_FOUND');
            }

            let [itemRows] = await connection.query(
                'SELECT * FROM stock_audit_items WHERE audit_id = ? AND product_id = ? LIMIT 1 FOR UPDATE',
                [auditId, product.id]
            );
            let item = itemRows[0];
            if (!item) {
                const abcMap = await this.getAbcMap(connection);
                const abcClass = abcMap.get(product.id) || 'C';
                if (session.abc_class !== 'ALL' && session.abc_class !== abcClass) {
                    throw businessError(`El producto pertenece a clase ${abcClass} y no forma parte de este conteo ${session.abc_class}.`, 409, 'STOCK_AUDIT_PRODUCT_OUT_OF_SCOPE');
                }
                const [inventoryRows] = await connection.query(
                    'SELECT id, quantity FROM inventory WHERE product_id = ? AND location = ? LIMIT 1 FOR UPDATE',
                    [product.id, session.location_code]
                );
                const inventory = inventoryRows[0];
                item = {
                    id: crypto.randomUUID(),
                    audit_id: auditId,
                    inventory_id: inventory?.id || null,
                    product_id: product.id,
                    location_code: session.location_code,
                    abc_class: abcClass,
                    expected_quantity: asNumber(inventory?.quantity),
                    counted_quantity: null,
                };
                await connection.query(`
                    INSERT INTO stock_audit_items
                        (id, audit_id, inventory_id, product_id, location_code, abc_class, expected_quantity, is_unexpected)
                    VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
                `, [item.id, auditId, item.inventory_id, product.id, session.location_code, abcClass, item.expected_quantity]);
            }

            const countedQuantity = asNumber(data.quantity);
            const variance = countedQuantity - asNumber(item.expected_quantity);
            await connection.query(`
                UPDATE stock_audit_items
                SET counted_quantity = ?, variance = ?, notes = ?, counted_by = ?, counted_at = NOW()
                WHERE id = ?
            `, [countedQuantity, variance, data.notes || null, userId || null, item.id]);
            await connection.query(`
                INSERT INTO stock_audit_count_events
                    (id, audit_id, audit_item_id, product_id, previous_counted_quantity, counted_quantity, performed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [crypto.randomUUID(), auditId, item.id, product.id, item.counted_quantity, countedQuantity, userId || null]);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return this.getSession(auditId);
    }

    async completeSession(id, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [sessionRows] = await connection.query(
                'SELECT * FROM stock_audit_sessions WHERE id = ? LIMIT 1 FOR UPDATE',
                [id]
            );
            const session = sessionRows[0];
            if (!session) throw businessError('La auditoría de stock no existe.', 404, 'STOCK_AUDIT_NOT_FOUND');
            if (session.status !== ACTIVE_STATUS) {
                throw businessError('La auditoría ya fue cerrada.', 409, 'STOCK_AUDIT_NOT_ACTIVE');
            }
            const [countRows] = await connection.query(`
                SELECT COUNT(*) AS total_items,
                       SUM(CASE WHEN counted_quantity IS NULL THEN 1 ELSE 0 END) AS pending_items
                FROM stock_audit_items
                WHERE audit_id = ?
            `, [id]);
            const totalItems = Number(countRows[0]?.total_items || 0);
            const pendingItems = Number(countRows[0]?.pending_items || 0);
            if (totalItems === 0 || pendingItems > 0) {
                throw businessError(`Faltan contar ${pendingItems || totalItems} productos antes de cerrar.`, 409, 'STOCK_AUDIT_PENDING_ITEMS');
            }
            await connection.query(
                "UPDATE stock_audit_sessions SET status = 'completed', completed_at = NOW() WHERE id = ?",
                [id]
            );
            await auditService.log({
                user_id: userId || null,
                action: 'COMPLETE_STOCK_AUDIT',
                entity_type: 'stock_audit',
                entity_id: id,
                new_values: { status: 'completed', total_items: totalItems },
            }, connection);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return this.getSession(id);
    }

    async cancelSession(id, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [sessionRows] = await connection.query(
                'SELECT * FROM stock_audit_sessions WHERE id = ? LIMIT 1 FOR UPDATE',
                [id]
            );
            const session = sessionRows[0];
            if (!session) throw businessError('La auditoría de stock no existe.', 404, 'STOCK_AUDIT_NOT_FOUND');
            if (![ACTIVE_STATUS, 'completed'].includes(session.status)) {
                throw businessError('Sólo se puede descartar una auditoría en curso o pendiente de ajuste.', 409, 'STOCK_AUDIT_NOT_CANCELLABLE');
            }
            await connection.query(
                "UPDATE stock_audit_sessions SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?",
                [id]
            );
            await auditService.log({
                user_id: userId || null,
                action: 'CANCEL_STOCK_AUDIT',
                entity_type: 'stock_audit',
                entity_id: id,
                old_values: { status: session.status },
                new_values: { status: 'cancelled' },
            }, connection);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return this.getSession(id);
    }

    async applyAdjustments(id, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [sessionRows] = await connection.query(
                'SELECT * FROM stock_audit_sessions WHERE id = ? LIMIT 1 FOR UPDATE',
                [id]
            );
            const session = sessionRows[0];
            if (!session) throw businessError('La auditoría de stock no existe.', 404, 'STOCK_AUDIT_NOT_FOUND');
            if (!FINAL_STATUSES.has(session.status) || session.status === 'adjusted') {
                throw businessError('La auditoría debe estar completada y sin aplicar.', 409, 'STOCK_AUDIT_NOT_ADJUSTABLE');
            }
            const [items] = await connection.query(`
                SELECT item.*, product.name AS product_name, product.sku, product.purchase_price
                FROM stock_audit_items item
                INNER JOIN products product ON product.id = item.product_id
                WHERE item.audit_id = ?
                ORDER BY product.name
                FOR UPDATE
            `, [id]);
            const lockedInventory = new Map();
            const conflicts = [];
            for (const item of items) {
                const [inventoryRows] = await connection.query(
                    'SELECT id, quantity, reserved_quantity FROM inventory WHERE product_id = ? AND location = ? LIMIT 1 FOR UPDATE',
                    [item.product_id, session.location_code]
                );
                const inventory = inventoryRows[0] || null;
                lockedInventory.set(item.product_id, inventory);
                if (Math.abs(asNumber(inventory?.quantity) - asNumber(item.expected_quantity)) > 0.0001) {
                    conflicts.push(item.sku || item.product_name);
                }
                if (asNumber(item.counted_quantity) < asNumber(inventory?.reserved_quantity)) {
                    conflicts.push(`${item.sku || item.product_name} (reservado)`);
                }
            }
            if (conflicts.length > 0) {
                throw businessError(
                    `El stock cambió o posee reservas posteriores al inicio: ${[...new Set(conflicts)].slice(0, 5).join(', ')}. Inicie un conteo nuevo.`,
                    409,
                    'STOCK_AUDIT_STALE_SNAPSHOT'
                );
            }

            let adjustedItems = 0;
            for (const item of items) {
                const variance = asNumber(item.variance);
                if (variance === 0) continue;
                const countedQuantity = asNumber(item.counted_quantity);
                const inventory = lockedInventory.get(item.product_id);
                if (inventory) {
                    await connection.query('UPDATE inventory SET quantity = ? WHERE id = ?', [countedQuantity, inventory.id]);
                } else {
                    await connection.query(
                        'INSERT INTO inventory (id, product_id, location, quantity) VALUES (?, ?, ?, ?)',
                        [crypto.randomUUID(), item.product_id, session.location_code, countedQuantity]
                    );
                }
                await connection.query(`
                    INSERT INTO inventory_movements
                        (id, type, product_id, from_location, to_location, quantity, unit_cost,
                         reason, reference_type, reference_id, performed_by)
                    VALUES (?, 'stock_adjustment', ?, ?, ?, ?, ?, ?, 'stock_audit', ?, ?)
                `, [
                    crypto.randomUUID(), item.product_id,
                    variance < 0 ? session.location_code : null,
                    variance > 0 ? session.location_code : null,
                    Math.abs(variance), asNumber(item.purchase_price),
                    `Ajuste por auditoría ${session.audit_number}`, id, userId || null,
                ]);
                adjustedItems += 1;
            }
            await connection.query(
                "UPDATE stock_audit_sessions SET status = 'adjusted', adjusted_by = ?, adjusted_at = NOW() WHERE id = ?",
                [userId || null, id]
            );
            await auditService.log({
                user_id: userId || null,
                action: 'APPLY_STOCK_AUDIT_ADJUSTMENTS',
                entity_type: 'stock_audit',
                entity_id: id,
                old_values: { status: 'completed' },
                new_values: { status: 'adjusted', adjusted_items: adjustedItems },
            }, connection);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return this.getSession(id);
    }
}

export default new StockAuditService();
