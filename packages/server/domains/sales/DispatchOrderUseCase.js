import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class DispatchOrderUseCase {
    constructor(dependencies = {}) {
        this.pool = dependencies.pool || pool;
        this.auditService = dependencies.auditService || auditService;
        this.normalizeOrderStatus = dependencies.normalizeOrderStatus;
        this.assertOrderTransition = dependencies.assertOrderTransition;
    }

    async execute(orderId, data, userId) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();

            const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
            if (orders.length === 0) throw new Error('Order not found');
            const currentStatus = typeof this.normalizeOrderStatus === 'function'
                ? this.normalizeOrderStatus(orders[0].status)
                : orders[0].status;

            const isPickup = data.shipping_method === 'pickup';
            const requestedNextStatus = isPickup ? 'delivered' : 'dispatched';
            const nextStatus = typeof this.assertOrderTransition === 'function'
                ? this.assertOrderTransition(currentStatus, requestedNextStatus)
                : requestedNextStatus;

            await connection.query(`
                UPDATE orders
                SET
                    status = ?,
                    shipping_method = ?,
                    tracking_number = ?,
                    estimated_delivery = ?,
                    shipping_address = ?,
                    recipient_name = ?,
                    recipient_dni = ?,
                    dispatched_at = NOW(),
                    delivered_at = CASE WHEN ? = 1 THEN NOW() ELSE delivered_at END
                WHERE id = ?
            `, [
                nextStatus,
                data.shipping_method || null,
                data.tracking_number || null,
                data.estimated_delivery || null,
                data.shipping_address || null,
                data.recipient_name || null,
                data.recipient_dni || null,
                isPickup ? 1 : 0,
                orderId
            ]);

            await this.auditService.log({
                user_id: userId,
                action: 'DISPATCH_ORDER',
                entity_type: 'order',
                entity_id: orderId,
                new_values: { status: nextStatus, ...data }
            }, connection);

            await connection.commit();
            const [updated] = await connection.query('SELECT * FROM orders WHERE id = ?', [orderId]);
            return updated[0];
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new DispatchOrderUseCase();
