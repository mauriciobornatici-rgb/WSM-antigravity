import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { calculateShiftExpectedBalance } from './cashShift.service.js';
import { businessError } from '../utils/businessError.js';

class CashRegisterService {
    async listCashRegisters() {
        const [rows] = await pool.query(`
        SELECT cr.*, cs.opened_at, cs.opening_balance, cs.expected_balance
        FROM cash_registers cr
        LEFT JOIN cash_shifts cs ON cr.current_shift_id = cs.id
        ORDER BY cr.name ASC
    `);
        return rows;
    }

    async listRegisterPayments(registerId) {
        const [rows] = await pool.query(`
        SELECT sp.*, cs.cash_register_id
        FROM shift_payments sp
        JOIN cash_shifts cs ON sp.shift_id = cs.id
        WHERE cs.cash_register_id = ?
        ORDER BY sp.created_at DESC
    `, [registerId]);
        return rows;
    }

    async getOpenShift(registerId) {
        const [registers] = await pool.query('SELECT * FROM cash_registers WHERE id = ? LIMIT 1', [registerId]);
        if (registers.length === 0) {
            throw businessError(404, { error: 'not_found', message: 'Caja no encontrada' });
        }

        const register = registers[0];
        if (!register.current_shift_id || register.status !== 'open') {
            throw businessError(404, { error: 'no_open_shift', message: 'La caja no tiene turno abierto' });
        }

        const [shifts] = await pool.query('SELECT * FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1', [register.current_shift_id]);
        if (shifts.length === 0) {
            throw businessError(404, { error: 'no_open_shift', message: 'La caja no tiene turno abierto' });
        }

        const shift = shifts[0];
        const summary = await calculateShiftExpectedBalance(pool, shift.id);
        await pool.query('UPDATE cash_shifts SET expected_balance = ? WHERE id = ?', [summary.expected_balance, shift.id]);

        return {
            ...shift,
            ...summary
        };
    }

    // The actor (`openedBy`) is always the authenticated user, never the request body.
    async openShift(registerId, { openingBalance, openedBy, ipAddress }) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [registers] = await connection.query('SELECT * FROM cash_registers WHERE id = ? FOR UPDATE', [registerId]);
            if (registers.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Caja no encontrada' });
            }

            if (registers[0].status === 'open') {
                throw businessError(409, { error: 'already_open', message: 'La caja ya tiene un turno abierto' });
            }

            const shiftId = crypto.randomUUID();
            await connection.query(`
            INSERT INTO cash_shifts (id, cash_register_id, opened_by, opening_balance, expected_balance, status)
            VALUES (?, ?, ?, ?, ?, 'open')
        `, [shiftId, registerId, openedBy, openingBalance || 0, openingBalance || 0]);

            await connection.query(
                'UPDATE cash_registers SET status = "open", current_shift_id = ? WHERE id = ?',
                [shiftId, registerId]
            );

            await auditService.log({
                user_id: openedBy,
                action: 'OPEN_SHIFT',
                entity_type: 'cash_shift',
                entity_id: shiftId,
                new_values: {
                    cash_register_id: registerId,
                    opening_balance: openingBalance || 0,
                    opened_by: openedBy,
                    status: 'open'
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id: shiftId, success: true };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    // The actor (`closedBy`) is always the authenticated user, never the request body.
    async closeShift(shiftId, { actualBalance, notes, closedBy, ipAddress }) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [shifts] = await connection.query('SELECT * FROM cash_shifts WHERE id = ? FOR UPDATE', [shiftId]);
            if (shifts.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Turno no encontrado' });
            }

            const shift = shifts[0];
            if (shift.status !== 'open') {
                throw businessError(409, { error: 'already_closed', message: 'El turno ya esta cerrado' });
            }

            const summary = await calculateShiftExpectedBalance(connection, shiftId);
            const expectedBalance = summary.expected_balance;
            const actualBalanceNumber = Number(actualBalance || 0);
            const difference = actualBalanceNumber - expectedBalance;

            await connection.query(`
            UPDATE cash_shifts
            SET status = 'closed',
                closed_by = ?,
                closed_at = NOW(),
                expected_balance = ?,
                actual_balance = ?,
                difference = ?,
                notes = ?
            WHERE id = ?
        `, [closedBy, expectedBalance, actualBalanceNumber, difference, notes || null, shiftId]);

            await connection.query(
                'UPDATE cash_registers SET status = "closed", current_shift_id = NULL WHERE id = ?',
                [shift.cash_register_id]
            );

            await auditService.log({
                user_id: closedBy,
                action: 'CLOSE_SHIFT',
                entity_type: 'cash_shift',
                entity_id: shiftId,
                old_values: {
                    status: shift.status,
                    expected_balance: shift.expected_balance,
                    opening_balance: shift.opening_balance
                },
                new_values: {
                    status: 'closed',
                    expected_balance: expectedBalance,
                    actual_balance: actualBalanceNumber,
                    difference,
                    closed_by: closedBy,
                    notes: notes || null
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return {
                success: true,
                expected_balance: expectedBalance,
                actual_balance: actualBalanceNumber,
                difference
            };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    // Idempotent per (shift, order, method, type): a replay answers the existing payment.
    async addShiftPayment(shiftId, { orderId, paymentMethod, amount, type, userId, ipAddress }) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [shifts] = await connection.query(
                'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1 FOR UPDATE',
                [shiftId]
            );
            if (shifts.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Turno abierto no encontrado' });
            }

            if (orderId) {
                const resolvedMethod = paymentMethod || 'cash';
                const resolvedType = type || 'sale';
                const [existingPayments] = await connection.query(
                    `SELECT id
                 FROM shift_payments
                 WHERE shift_id = ? AND order_id = ? AND payment_method = ? AND type = ?
                 LIMIT 1`,
                    [shiftId, orderId, resolvedMethod, resolvedType]
                );
                if (existingPayments.length > 0) {
                    const summary = await calculateShiftExpectedBalance(connection, shiftId);
                    await connection.commit();
                    return {
                        id: existingPayments[0].id,
                        expected_balance: summary.expected_balance,
                        idempotent_replay: true
                    };
                }
            }

            const paymentId = crypto.randomUUID();
            await connection.query(`
            INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [paymentId, shiftId, orderId || null, paymentMethod || 'cash', amount || 0, type || 'sale']);

            const summary = await calculateShiftExpectedBalance(connection, shiftId);
            await connection.query(
                'UPDATE cash_shifts SET expected_balance = ? WHERE id = ?',
                [summary.expected_balance, shiftId]
            );

            await auditService.log({
                user_id: userId,
                action: 'ADD_SHIFT_PAYMENT',
                entity_type: 'shift_payment',
                entity_id: paymentId,
                new_values: {
                    shift_id: shiftId,
                    order_id: orderId || null,
                    payment_method: paymentMethod || 'cash',
                    amount: amount || 0,
                    type: type || 'sale',
                    expected_balance: summary.expected_balance
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();
            return { id: paymentId, expected_balance: summary.expected_balance };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async createCashTransaction({ registerId, type, amount, reason, notes, userId, ipAddress }) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            const [registers] = await connection.query(
                'SELECT current_shift_id, status FROM cash_registers WHERE id = ? FOR UPDATE',
                [registerId]
            );
            if (registers.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Caja no encontrada' });
            }
            if (registers[0].status !== 'open' || !registers[0].current_shift_id) {
                throw businessError(409, { error: 'closed_register', message: 'La caja debe estar abierta para registrar movimientos' });
            }

            const paymentType = type === 'income' ? 'income' : 'expense';
            const shiftId = registers[0].current_shift_id;
            const paymentId = crypto.randomUUID();

            await connection.query(`
            INSERT INTO shift_payments (id, shift_id, payment_method, amount, type)
            VALUES (?, ?, 'cash', ?, ?)
        `, [paymentId, shiftId, amount, paymentType]);

            await connection.query(`
            INSERT INTO transactions (id, type, amount, description, reference_id)
            VALUES (?, 'adjustment', ?, ?, ?)
        `, [
                crypto.randomUUID(),
                amount,
                `${type === 'income' ? 'Ingreso' : 'Egreso'} de caja: ${reason}${notes ? ` (${notes})` : ''}`,
                paymentId
            ]);

            const summary = await calculateShiftExpectedBalance(connection, shiftId);
            await connection.query(
                'UPDATE cash_shifts SET expected_balance = ? WHERE id = ?',
                [summary.expected_balance, shiftId]
            );

            await auditService.log({
                user_id: userId,
                action: 'CREATE_CASH_TRANSACTION',
                entity_type: 'transaction',
                entity_id: paymentId,
                new_values: {
                    register_id: registerId,
                    shift_id: shiftId,
                    type: paymentType,
                    amount,
                    reason,
                    notes: notes || null,
                    expected_balance: summary.expected_balance
                },
                ip_address: ipAddress
            }, connection);
            await connection.commit();

            return { id: paymentId, success: true, expected_balance: summary.expected_balance };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new CashRegisterService();
