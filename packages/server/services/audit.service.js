import pool from '../config/db.js';

class AuditService {
    /**
     * Log a business action
     * @param {Object} data { user_id, action, entity_type, entity_id, old_values, new_values, ip_address }
     * @param {Object} [executor] - mysql2 connection/pool. Pass the open transaction
     *   connection when logging inside one, so the audit entry commits or rolls
     *   back together with the business operation.
     */
    async log(data, executor = pool) {
        try {
            const sql = `
                INSERT INTO audit_logs
                (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            const params = [
                data.user_id || null,
                data.action,
                data.entity_type,
                data.entity_id || null,
                data.old_values ? JSON.stringify(data.old_values) : null,
                data.new_values ? JSON.stringify(data.new_values) : null,
                data.ip_address || null
            ];

            await executor.query(sql, params);
        } catch (err) {
            console.error('Audit Log Error:', err);
            // With an open transaction, auditability is a business invariant:
            // a failed audit insert must roll back the whole operation.
            if (executor !== pool) throw err;
        }
    }

    async getLogs(filters = {}, options = {}) {
        let sql = `
            SELECT al.*, u.name as user_name, u.email as user_email
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.entity_type) {
            sql += ' AND al.entity_type = ?';
            params.push(filters.entity_type);
        }
        if (filters.entity_id) {
            sql += ' AND al.entity_id = ?';
            params.push(filters.entity_id);
        }

        let total = null;
        if (options.includeTotal) {
            const countQuery = `SELECT COUNT(*) AS total FROM (${sql}) AS filtered_audit_logs`;
            const [countRows] = await pool.query(countQuery, params);
            total = Number(countRows[0]?.total || 0);
        }

        sql += ' ORDER BY al.created_at DESC';

        if (options.limit != null) {
            sql += ' LIMIT ?';
            params.push(Number(options.limit));
            if (options.offset != null) {
                sql += ' OFFSET ?';
                params.push(Number(options.offset));
            }
        } else {
            // Backward compatibility: legacy endpoint returned latest 100 by default.
            sql += ' LIMIT 100';
        }

        const [rows] = await pool.query(sql, params);

        if (options.includeTotal) {
            return { rows, total: total ?? rows.length };
        }

        return rows;
    }
}

export default new AuditService();
