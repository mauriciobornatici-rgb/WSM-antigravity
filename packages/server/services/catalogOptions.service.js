import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { businessError } from '../utils/businessError.js';

const CATALOG_OPTION_TYPES = new Set(['group', 'subgroup', 'brand', 'size', 'color']);
const CATALOG_PRODUCT_FIELDS = Object.freeze({
    group: { id: 'category_option_id', value: 'category' },
    subgroup: { id: 'subcategory_option_id', value: 'subcategory' },
    brand: { id: 'brand_option_id', value: 'brand' },
    size: { id: 'size_option_id', value: 'size' },
    color: { id: 'color_option_id', value: 'color' }
});

function normalizeCatalogOptionName(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function catalogOptionKey(type, name, parentId = null) {
    return crypto.createHash('sha256').update(`${type}|${parentId || ''}|${name.toLocaleLowerCase('es-AR')}`).digest('hex');
}

class CatalogOptionsService {
    async validateParent(type, parentId) {
        if (type !== 'subgroup') {
            if (parentId) {
                const error = new Error('Solo los subgrupos pueden depender de otro valor.');
                error.statusCode = 400;
                throw error;
            }
            return null;
        }
        if (!parentId) {
            const error = new Error('El subgrupo debe pertenecer a un grupo.');
            error.statusCode = 400;
            throw error;
        }
        const [rows] = await pool.query(
            "SELECT id FROM product_catalog_options WHERE id = ? AND type = 'group' LIMIT 1",
            [parentId]
        );
        if (rows.length === 0) {
            const error = new Error('El grupo seleccionado no existe.');
            error.statusCode = 400;
            throw error;
        }
        return parentId;
    }

    async getOptions(query = {}) {
        const type = String(query.type || '').trim();
        if (type && !CATALOG_OPTION_TYPES.has(type)) {
            throw businessError(400, { error: 'invalid_option_type', message: 'Tipo de maestro inválido' });
        }
        const params = [];
        let sql = `
        SELECT catalog_option.*, parent.name AS parent_name,
               (SELECT COUNT(*) FROM products product
                WHERE product.deleted_at IS NULL AND (
                    product.category_option_id = catalog_option.id OR
                    product.subcategory_option_id = catalog_option.id OR
                    product.brand_option_id = catalog_option.id OR
                    product.size_option_id = catalog_option.id OR
                    product.color_option_id = catalog_option.id
                )) AS usage_count
        FROM product_catalog_options catalog_option
        LEFT JOIN product_catalog_options parent ON parent.id = catalog_option.parent_id
        WHERE 1 = 1`;
        if (type) {
            sql += ' AND catalog_option.type = ?';
            params.push(type);
        }
        if (query.parent_id) {
            sql += ' AND catalog_option.parent_id = ?';
            params.push(query.parent_id);
        }
        if (String(query.include_inactive || '') !== 'true') {
            sql += ' AND catalog_option.active = TRUE';
        }
        sql += " ORDER BY FIELD(catalog_option.type, 'group', 'subgroup', 'brand', 'size', 'color'), catalog_option.sort_order, catalog_option.name";
        const [rows] = await pool.query(sql, params);
        return rows.map((row) => ({ ...row, active: Boolean(row.active), usage_count: Number(row.usage_count || 0) }));
    }

    async createOption(body, userId, ipAddress) {
        const type = String(body?.type || '').trim();
        const name = normalizeCatalogOptionName(body?.name);
        if (!CATALOG_OPTION_TYPES.has(type) || !name || name.length > 100) {
            throw businessError(400, { error: 'invalid_catalog_option', message: 'Tipo y nombre válido son obligatorios' });
        }
        const parentId = await this.validateParent(type, body?.parent_id || null);
        const id = crypto.randomUUID();
        try {
            await pool.query(
                `INSERT INTO product_catalog_options
                (id, option_key, type, name, normalized_name, parent_id, active, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)`,
                [id, catalogOptionKey(type, name, parentId), type, name, name.toLocaleLowerCase('es-AR'), parentId, Number(body?.sort_order || 0), userId || null]
            );
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, { error: 'duplicate_catalog_option', message: 'Ese valor ya existe en el maestro seleccionado' });
            }
            throw error;
        }
        await auditService.log({
            user_id: userId || null,
            action: 'CREATE_PRODUCT_CATALOG_OPTION',
            entity_type: 'product_catalog_option',
            entity_id: id,
            new_values: { type, name, parent_id: parentId },
            ip_address: ipAddress
        });
        const [rows] = await pool.query('SELECT * FROM product_catalog_options WHERE id = ?', [id]);
        return { ...rows[0], active: Boolean(rows[0].active), usage_count: 0 };
    }

    async updateOption(optionId, body, userId, ipAddress) {
        const [existingRows] = await pool.query('SELECT * FROM product_catalog_options WHERE id = ?', [optionId]);
        if (existingRows.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Valor de catálogo no encontrado' });
        }
        const existing = existingRows[0];
        const name = body?.name == null ? existing.name : normalizeCatalogOptionName(body.name);
        if (!name || name.length > 100) {
            throw businessError(400, { error: 'invalid_catalog_option', message: 'El nombre es obligatorio y admite hasta 100 caracteres' });
        }
        const requestedParent = Object.prototype.hasOwnProperty.call(body || {}, 'parent_id') ? body.parent_id : existing.parent_id;
        const parentId = await this.validateParent(existing.type, requestedParent || null);
        const active = body?.active == null ? Boolean(existing.active) : Boolean(body.active);
        const sortOrder = body?.sort_order == null ? Number(existing.sort_order || 0) : Number(body.sort_order || 0);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `UPDATE product_catalog_options
             SET option_key = ?, name = ?, normalized_name = ?, parent_id = ?, active = ?, sort_order = ?
             WHERE id = ?`,
                [catalogOptionKey(existing.type, name, parentId), name, name.toLocaleLowerCase('es-AR'), parentId, active, sortOrder, optionId]
            );
            if (name !== existing.name) {
                const fields = CATALOG_PRODUCT_FIELDS[existing.type];
                await connection.query(
                    `UPDATE products SET \`${fields.value}\` = ? WHERE \`${fields.id}\` = ? AND deleted_at IS NULL`,
                    [name, optionId]
                );
                if (existing.type === 'group' || existing.type === 'brand') {
                    const familyField = existing.type === 'group' ? 'category' : 'brand';
                    await connection.query(
                        `UPDATE product_families family
                     JOIN products product ON product.family_id = family.id AND product.deleted_at IS NULL
                     SET family.\`${familyField}\` = ?
                     WHERE product.\`${fields.id}\` = ? AND family.deleted_at IS NULL`,
                        [name, optionId]
                    );
                }
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            if (error?.code === 'ER_DUP_ENTRY') {
                throw businessError(409, { error: 'duplicate_catalog_option', message: 'Ese valor ya existe en el maestro seleccionado' });
            }
            throw error;
        } finally {
            connection.release();
        }
        await auditService.log({
            user_id: userId || null,
            action: 'UPDATE_PRODUCT_CATALOG_OPTION',
            entity_type: 'product_catalog_option',
            entity_id: optionId,
            old_values: existing,
            new_values: { name, parent_id: parentId, active, sort_order: sortOrder },
            ip_address: ipAddress
        });
        const [rows] = await pool.query(`
        SELECT catalog_option.*, parent.name AS parent_name
        FROM product_catalog_options catalog_option
        LEFT JOIN product_catalog_options parent ON parent.id = catalog_option.parent_id
        WHERE catalog_option.id = ?`, [optionId]);
        return { ...rows[0], active: Boolean(rows[0].active) };
    }
}

export default new CatalogOptionsService();