import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class DeliverOrderUseCase {
    constructor(dependencies = {}) {
        this.pool = dependencies.pool || pool;
        this.auditService = dependencies.auditService || auditService;
        this.assertOrderTransition = dependencies.assertOrderTransition;
    }

    async execute(orderId, data, userId) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [orders] = await connection.query(
                'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [orderId]
            );
            if (orders.length === 0) throw new Error('Order not found');
            if (typeof this.assertOrderTransition === 'function') {
                this.assertOrderTransition(orders[0].status, 'delivered');
            }

            await connection.query(`
                UPDATE orders
                SET status = 'delivered',
                    recipient_name = ?,
                    recipient_dni = ?,
                    delivery_notes = ?,
                    delivered_at = NOW()
                WHERE id = ?
            `, [data.recipient_name || null, data.recipient_dni || null, data.delivery_notes || null, orderId]);

            await this.auditService.log({
                user_id: userId,
                action: 'DELIVER_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                old_values: { status: orders[0].status },
                new_values: { status: 'delivered', ...data }
            }, connection);

            const [updated] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
            await connection.commit();
            return updated[0];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new DeliverOrderUseCase();
