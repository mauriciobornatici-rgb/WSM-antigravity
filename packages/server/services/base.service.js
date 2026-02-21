import pool from '../config/db.js';

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Column allowlists per table — only these columns can be used in dynamic queries
const TABLE_COLUMNS = {
    products: [
        'id', 'sku', 'barcode', 'name', 'description', 'category', 'image_url', 'location',
        'purchase_price', 'cost_price', 'sale_price',
        'brand', 'unit_measure', 'stock_current', 'stock_min', 'supplier_id', 'status',
        'created_at', 'updated_at', 'deleted_at'
    ],
    orders: [
        'id', 'client_id', 'customer_name', 'total_amount', 'status', 'payment_status', 'payment_method',
        'shipping_method', 'shipping_address', 'tracking_number', 'estimated_delivery',
        'dispatched_at', 'delivered_at', 'recipient_name', 'recipient_dni', 'delivery_notes',
        'invoice_id', 'created_at', 'updated_at', 'deleted_at'
    ],
    clients: [
        'id', 'name', 'email', 'phone', 'tax_id', 'address', 'credit_limit', 'current_account_balance',
        'city', 'state', 'type', 'status', 'notes', 'created_at', 'updated_at', 'deleted_at'
    ],
    suppliers: [
        'id', 'name', 'tax_id', 'contact_name', 'email', 'phone', 'address', 'active',
        'category', 'rating', 'account_balance', 'status', 'notes', 'created_at', 'updated_at', 'deleted_at'
    ],
    inventory: ['id', 'product_id', 'location', 'quantity', 'min_stock_level', 'created_at', 'updated_at', 'deleted_at'],
    users: ['id', 'name', 'email', 'role', 'status', 'created_at', 'updated_at', 'last_login', 'deleted_at'],
    warranty_claims: [
        'id', 'client_id', 'customer_name', 'product_id', 'serial_number', 'issue_description',
        'status', 'resolution_type', 'resolution_notes', 'created_at', 'updated_at', 'deleted_at'
    ],
    client_returns: [
        'id', 'client_id', 'customer_name', 'order_id', 'reason', 'status', 'total_amount',
        'created_at', 'updated_at', 'deleted_at'
    ],
    credit_notes: [
        'id', 'number', 'client_id', 'customer_name', 'reference_type', 'reference_id',
        'amount', 'status', 'created_at', 'deleted_at'
    ],
};

class BaseService {
    constructor(tableName) {
        this.tableName = tableName;
        this.allowedColumns = new Set(TABLE_COLUMNS[tableName] || []);
    }

    /**
     * Validate that a column name is in the allowlist.
     * Prevents SQL injection through dynamic column names.
     */
    _validateColumn(col) {
        const normalized = String(col || '').trim();
        if (!SQL_IDENTIFIER_PATTERN.test(normalized)) {
            throw new Error(`Invalid SQL identifier '${col}'`);
        }
        if (!this.allowedColumns.has(normalized)) {
            throw new Error(`Column '${col}' is not allowed for table '${this.tableName}'`);
        }
        return `\`${normalized}\``;
    }

    _parseLimit(rawLimit) {
        if (rawLimit == null || rawLimit === '') return null;
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
            throw new Error('Invalid limit. Must be an integer between 1 and 500.');
        }
        return limit;
    }

    _parseOffset(rawOffset) {
        if (rawOffset == null || rawOffset === '') return null;
        const offset = Number(rawOffset);
        if (!Number.isInteger(offset) || offset < 0) {
            throw new Error('Invalid offset. Must be an integer greater than or equal to 0.');
        }
        return offset;
    }

    async findAll(filters = {}, options = {}) {
        let query = `SELECT * FROM \`${this.tableName}\` WHERE (deleted_at IS NULL)`;
        const params = [];

        Object.keys(filters).forEach(key => {
            const safeCol = this._validateColumn(key);
            query += ` AND ${safeCol} = ?`;
            params.push(filters[key]);
        });

        if (options.orderBy) {
            const safeCol = this._validateColumn(options.orderBy);
            const order = String(options.order || 'ASC').trim().toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            query += ` ORDER BY ${safeCol} ${order}`;
        }

        const parsedLimit = this._parseLimit(options.limit);
        const parsedOffset = this._parseOffset(options.offset);

        if (parsedLimit != null) {
            query += ` LIMIT ?`;
            params.push(parsedLimit);
            if (parsedOffset != null) {
                query += ` OFFSET ?`;
                params.push(parsedOffset);
            }
        }

        const [rows] = await pool.query(query, params);
        return rows;
    }

    async findById(id) {
        const [rows] = await pool.query(`SELECT * FROM \`${this.tableName}\` WHERE id = ? AND deleted_at IS NULL`, [id]);
        return rows[0] || null;
    }

    async create(data) {
        const keys = Object.keys(data);
        const columns = keys.map(k => this._validateColumn(k)).join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        const values = Object.values(data);

        const [result] = await pool.query(
            `INSERT INTO \`${this.tableName}\` (${columns}) VALUES (${placeholders})`,
            values
        );
        return { id: data.id || result.insertId, ...data };
    }

    async update(id, data) {
        const sets = Object.keys(data).map(key => `${this._validateColumn(key)} = ?`).join(', ');
        const values = [...Object.values(data), id];

        await pool.query(`UPDATE \`${this.tableName}\` SET ${sets} WHERE id = ? AND deleted_at IS NULL`, values);
        return this.findById(id);
    }

    async delete(id) {
        // Perform Soft Delete
        await pool.query(`UPDATE \`${this.tableName}\` SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
        return { success: true, message: 'Registro eliminado (Soft Delete)' };
    }

    async hardDelete(id) {
        await pool.query(`DELETE FROM \`${this.tableName}\` WHERE id = ?`, [id]);
        return { success: true, message: 'Registro eliminado fisicamente' };
    }
}

export default BaseService;


