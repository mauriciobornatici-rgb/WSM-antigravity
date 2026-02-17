import pool from '../config/db.js';

class AuditService {
    /**
     * Log a business action
     * @param {Object} data { user_id, action, entity_type, entity_id, old_values, new_values, ip_address }
     */
    async log(data) {
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

            await pool.query(sql, params);
        } catch (err) {
            // We never fail a request because of a logging error, but we log it to console
            console.error('Audit Log Error:', err);
        }
    }

    async getLogs(filters = {}) {
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

        sql += ' ORDER BY al.created_at DESC LIMIT 100';
        const [rows] = await pool.query(sql, params);
        return rows;
    }
}

export default new AuditService();
