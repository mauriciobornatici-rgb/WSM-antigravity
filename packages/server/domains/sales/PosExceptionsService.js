import pool from '../../config/db.js';
import defaultAuditService from '../../services/audit.service.js';

// Offline POS sales are honoured even when they break a rule (ADR-010): a price that
// differs from the catalog, or stock the system did not have when they synced. Each
// case is written to the (immutable) audit log; this service lists the ones a manager
// has not reviewed yet and records the review as another audit entry.
export const EXCEPTION_TYPES = Object.freeze({
    PRICE: 'price',
    STOCK_SHORTAGE: 'stock_shortage',
    // ADR-019: an online-store order recorded without enough stock to reserve.
    CHANNEL_SHORTAGE: 'channel_stock_shortage',
});
export const REVIEW_ACTION = 'POS_EXCEPTION_REVIEWED';

const EXCEPTION_FILTER_SQL = `(
    (a.action = 'ORDER_PRICE_OVERRIDE' AND JSON_UNQUOTE(JSON_EXTRACT(a.new_values, '$.source')) = 'offline_pos')
    OR a.action = 'OFFLINE_SALE_STOCK_SHORTAGE'
    OR a.action = 'CHANNEL_ORDER_STOCK_SHORTAGE'
)`;

function parseJson(value) {
    if (value == null || typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

export class PosExceptionsService {
    constructor({ db = pool, auditService = defaultAuditService } = {}) {
        this.db = db;
        this.auditService = auditService;
    }

    async list({ status = 'pending', limit = 100 } = {}) {
        const reviewedFilter = status === 'reviewed' ? 'EXISTS' : 'NOT EXISTS';
        const [rows] = await this.db.query(
            `SELECT a.id, a.action, a.entity_id AS order_id, a.user_id, a.new_values, a.created_at,
                    o.customer_name, o.total_amount, u.name AS user_name,
                    r.new_values AS review, r.user_id AS reviewed_by, r.created_at AS reviewed_at
             FROM audit_logs a
             LEFT JOIN orders o ON o.id = a.entity_id
             LEFT JOIN users u ON u.id = a.user_id
             LEFT JOIN audit_logs r ON r.action = ? AND r.entity_type = 'audit_log' AND r.entity_id = CAST(a.id AS CHAR)
             WHERE ${EXCEPTION_FILTER_SQL}
               AND ${reviewedFilter} (
                   SELECT 1 FROM audit_logs rv
                   WHERE rv.action = ? AND rv.entity_type = 'audit_log' AND rv.entity_id = CAST(a.id AS CHAR)
               )
             ORDER BY a.created_at DESC, a.id DESC
             LIMIT ?`,
            [REVIEW_ACTION, REVIEW_ACTION, Math.min(Math.max(Number(limit) || 100, 1), 500)]
        );
        return rows.map((row) => ({
            id: row.id,
            type: row.action === 'OFFLINE_SALE_STOCK_SHORTAGE'
                ? EXCEPTION_TYPES.STOCK_SHORTAGE
                : row.action === 'CHANNEL_ORDER_STOCK_SHORTAGE' ? EXCEPTION_TYPES.CHANNEL_SHORTAGE : EXCEPTION_TYPES.PRICE,
            order_id: row.order_id,
            customer_name: row.customer_name,
            total_amount: row.total_amount == null ? null : Number(row.total_amount),
            user_id: row.user_id,
            user_name: row.user_name,
            created_at: row.created_at,
            details: parseJson(row.new_values),
            review: row.review ? { ...parseJson(row.review), reviewed_by: row.reviewed_by, reviewed_at: row.reviewed_at } : null,
        }));
    }

    async review(exceptionId, { decision, notes = null }, userId) {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            const [exceptions] = await connection.query(
                `SELECT a.id, a.entity_id FROM audit_logs a WHERE a.id = ? AND ${EXCEPTION_FILTER_SQL} FOR UPDATE`,
                [exceptionId]
            );
            if (exceptions.length === 0) {
                throw Object.assign(new Error('Excepción no encontrada'), { statusCode: 404, errorCode: 'POS_EXCEPTION_NOT_FOUND' });
            }
            const [reviews] = await connection.query(
                "SELECT id FROM audit_logs WHERE action = ? AND entity_type = 'audit_log' AND entity_id = ? LIMIT 1",
                [REVIEW_ACTION, String(exceptionId)]
            );
            if (reviews.length > 0) {
                throw Object.assign(new Error('La excepción ya fue revisada'), { statusCode: 409, errorCode: 'POS_EXCEPTION_ALREADY_REVIEWED' });
            }
            await this.auditService.log({
                user_id: userId,
                action: REVIEW_ACTION,
                entity_type: 'audit_log',
                entity_id: String(exceptionId),
                new_values: { decision, notes, order_id: exceptions[0].entity_id },
            }, connection);
            await connection.commit();
            return { id: Number(exceptionId), decision, notes };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new PosExceptionsService();
