import crypto from 'crypto';
import pool from '../../config/db.js';
import auditService from '../../services/audit.service.js';

export class QualityCheckService {
    async createQualityCheck(data, inspectorId, ipAddress = null) {
        const {
            reception_id,
            product_id,
            result,
            quantity_checked,
            quantity_passed,
            quantity_failed,
            defect_description,
            action_taken,
            notes
        } = data;
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [receptions] = await connection.query(
                'SELECT id, status FROM receptions WHERE id = ? FOR UPDATE',
                [reception_id]
            );
            if (receptions.length === 0) {
                const error = new Error('Recepción no encontrada');
                error.statusCode = 404;
                throw error;
            }
            if (receptions[0].status !== 'pending_qc') {
                const error = new Error('El control de calidad sólo puede modificarse mientras la recepción está pendiente');
                error.statusCode = 409;
                throw error;
            }

            const [receptionItems] = await connection.query(
                `SELECT id, quantity_received
                 FROM reception_items
                 WHERE reception_id = ? AND product_id = ?
                 FOR UPDATE`,
                [reception_id, product_id]
            );
            if (receptionItems.length !== 1) {
                const error = new Error(receptionItems.length === 0
                    ? 'El producto no pertenece a la recepción'
                    : 'El producto está repetido en la recepción; unifique las líneas antes de controlar');
                error.statusCode = 409;
                throw error;
            }
            const receivedQuantity = Number(receptionItems[0].quantity_received || 0);
            if (Number(quantity_checked) !== receivedQuantity
                || Number(quantity_passed) + Number(quantity_failed) !== receivedQuantity) {
                const error = new Error('El control de calidad debe cubrir exactamente toda la cantidad recibida');
                error.statusCode = 409;
                throw error;
            }

            const [existingRows] = await connection.query(
                `SELECT * FROM quality_checks
                 WHERE reception_id = ? AND product_id = ?
                 ORDER BY check_date DESC, id DESC
                 LIMIT 1 FOR UPDATE`,
                [reception_id, product_id]
            );
            const id = existingRows[0]?.id || crypto.randomUUID();
            const authenticatedInspectorId = inspectorId || null;
            const values = [
                authenticatedInspectorId,
                result,
                quantity_checked,
                quantity_passed,
                quantity_failed,
                defect_description || null,
                action_taken || 'approve',
                notes || null
            ];
            if (existingRows.length > 0) {
                await connection.query(
                    `UPDATE quality_checks
                     SET inspector_id = ?, result = ?, quantity_checked = ?, quantity_passed = ?,
                         quantity_failed = ?, defect_description = ?, action_taken = ?, notes = ?, check_date = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [...values, id]
                );
            } else {
                await connection.query(
                    `INSERT INTO quality_checks (
                        id, reception_id, product_id, inspector_id, result,
                        quantity_checked, quantity_passed, quantity_failed, defect_description, action_taken, notes
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, reception_id, product_id, ...values]
                );
            }

            const safeValues = {
                id,
                reception_id,
                product_id,
                inspector_id: authenticatedInspectorId,
                result,
                quantity_checked,
                quantity_passed,
                quantity_failed,
                defect_description: defect_description || null,
                action_taken: action_taken || 'approve',
                notes: notes || null
            };
            await auditService.log({
                user_id: authenticatedInspectorId,
                action: existingRows.length > 0 ? 'UPDATE_QUALITY_CHECK' : 'CREATE_QUALITY_CHECK',
                entity_type: 'quality_check',
                entity_id: id,
                old_values: existingRows[0] || null,
                new_values: safeValues,
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id, success: true };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new QualityCheckService();
