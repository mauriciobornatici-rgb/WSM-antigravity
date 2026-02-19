import crypto from 'crypto';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';

async function calculateShiftExpectedBalance(connection, shiftId) {
    const [payments] = await connection.query(`
        SELECT
            COALESCE(SUM(CASE WHEN type IN ('sale', 'income') THEN amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN type IN ('refund', 'expense') THEN amount ELSE 0 END), 0) AS outflow
        FROM shift_payments
        WHERE shift_id = ?
    `, [shiftId]);

    const [shifts] = await connection.query(
        'SELECT opening_balance FROM cash_shifts WHERE id = ? LIMIT 1',
        [shiftId]
    );
    const openingBalance = shifts.length > 0 ? Number(shifts[0].opening_balance || 0) : 0;
    const expected = openingBalance + Number(payments[0].inflow || 0) - Number(payments[0].outflow || 0);
    return {
        opening_balance: openingBalance,
        inflow: Number(payments[0].inflow || 0),
        outflow: Number(payments[0].outflow || 0),
        expected_balance: expected
    };
}

export const getTransactions = catchAsync(async (req, res) => {
    const { supplier_id, client_id, type } = req.query;
    let query = `
        SELECT t.*, c.name AS client_name, s.name AS supplier_name
        FROM transactions t
        LEFT JOIN clients c ON t.client_id = c.id
        LEFT JOIN suppliers s ON t.supplier_id = s.id
        WHERE 1=1
    `;
    const params = [];

    if (supplier_id) {
        query += ' AND t.supplier_id = ?';
        params.push(supplier_id);
    }
    if (client_id) {
        query += ' AND t.client_id = ?';
        params.push(client_id);
    }
    if (type) {
        query += ' AND t.type = ?';
        params.push(type);
    }
    query += ' ORDER BY t.date DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
});

export const getCashRegisters = catchAsync(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT cr.*, cs.opened_at, cs.opening_balance, cs.expected_balance
        FROM cash_registers cr
        LEFT JOIN cash_shifts cs ON cr.current_shift_id = cs.id
        ORDER BY cr.name ASC
    `);
    res.json(rows);
});

export const getCashRegisterTransactions = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [rows] = await pool.query(`
        SELECT sp.*, cs.cash_register_id
        FROM shift_payments sp
        JOIN cash_shifts cs ON sp.shift_id = cs.id
        WHERE cs.cash_register_id = ?
        ORDER BY sp.created_at DESC
    `, [id]);
    res.json(rows);
});

export const getOpenShift = catchAsync(async (req, res) => {
    const { id } = req.params;
    const [registers] = await pool.query('SELECT * FROM cash_registers WHERE id = ? LIMIT 1', [id]);
    if (registers.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Caja no encontrada' });
    }

    const register = registers[0];
    if (!register.current_shift_id || register.status !== 'open') {
        return res.status(404).json({ error: 'no_open_shift', message: 'La caja no tiene turno abierto' });
    }

    const [shifts] = await pool.query('SELECT * FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1', [register.current_shift_id]);
    if (shifts.length === 0) {
        return res.status(404).json({ error: 'no_open_shift', message: 'La caja no tiene turno abierto' });
    }

    const shift = shifts[0];
    const summary = await calculateShiftExpectedBalance(pool, shift.id);
    await pool.query('UPDATE cash_shifts SET expected_balance = ? WHERE id = ?', [summary.expected_balance, shift.id]);

    res.json({
        ...shift,
        ...summary
    });
});

export const openShift = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { opening_balance, opened_by } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [registers] = await connection.query('SELECT * FROM cash_registers WHERE id = ? FOR UPDATE', [id]);
        if (registers.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Caja no encontrada' });
        }

        if (registers[0].status === 'open') {
            await connection.rollback();
            return res.status(409).json({ error: 'already_open', message: 'La caja ya tiene un turno abierto' });
        }

        const shiftId = crypto.randomUUID();
        await connection.query(`
            INSERT INTO cash_shifts (id, cash_register_id, opened_by, opening_balance, expected_balance, status)
            VALUES (?, ?, ?, ?, ?, 'open')
        `, [shiftId, id, opened_by || req.user?.id || null, opening_balance || 0, opening_balance || 0]);

        await connection.query(
            'UPDATE cash_registers SET status = "open", current_shift_id = ? WHERE id = ?',
            [shiftId, id]
        );

        await connection.commit();
        await auditService.log({
            user_id: req.user?.id || opened_by || null,
            action: 'OPEN_SHIFT',
            entity_type: 'cash_shift',
            entity_id: shiftId,
            new_values: {
                cash_register_id: id,
                opening_balance: opening_balance || 0,
                opened_by: opened_by || req.user?.id || null,
                status: 'open'
            },
            ip_address: getRequestIp(req)
        });
        res.json({ id: shiftId, success: true });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const closeShift = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { actual_balance, notes, closed_by } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [shifts] = await connection.query('SELECT * FROM cash_shifts WHERE id = ? FOR UPDATE', [id]);
        if (shifts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Turno no encontrado' });
        }

        const shift = shifts[0];
        if (shift.status !== 'open') {
            await connection.rollback();
            return res.status(409).json({ error: 'already_closed', message: 'El turno ya esta cerrado' });
        }

        const summary = await calculateShiftExpectedBalance(connection, id);
        const expectedBalance = summary.expected_balance;
        const actualBalance = Number(actual_balance || 0);
        const difference = actualBalance - expectedBalance;

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
        `, [closed_by || req.user?.id || null, expectedBalance, actualBalance, difference, notes || null, id]);

        await connection.query(
            'UPDATE cash_registers SET status = "closed", current_shift_id = NULL WHERE id = ?',
            [shift.cash_register_id]
        );

        await connection.commit();
        await auditService.log({
            user_id: req.user?.id || closed_by || null,
            action: 'CLOSE_SHIFT',
            entity_type: 'cash_shift',
            entity_id: id,
            old_values: {
                status: shift.status,
                expected_balance: shift.expected_balance,
                opening_balance: shift.opening_balance
            },
            new_values: {
                status: 'closed',
                expected_balance: expectedBalance,
                actual_balance: actualBalance,
                difference,
                closed_by: closed_by || req.user?.id || null,
                notes: notes || null
            },
            ip_address: getRequestIp(req)
        });
        res.json({
            success: true,
            expected_balance: expectedBalance,
            actual_balance: actualBalance,
            difference
        });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const addShiftPayment = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { order_id, payment_method, amount, type } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [shifts] = await connection.query(
            'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1',
            [id]
        );
        if (shifts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Turno abierto no encontrado' });
        }

        const paymentId = crypto.randomUUID();
        await connection.query(`
            INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [paymentId, id, order_id || null, payment_method || 'cash', amount || 0, type || 'sale']);

        const summary = await calculateShiftExpectedBalance(connection, id);
        await connection.query(
            'UPDATE cash_shifts SET expected_balance = ? WHERE id = ?',
            [summary.expected_balance, id]
        );

        await connection.commit();
        await auditService.log({
            user_id: req.user?.id || null,
            action: 'ADD_SHIFT_PAYMENT',
            entity_type: 'shift_payment',
            entity_id: paymentId,
            new_values: {
                shift_id: id,
                order_id: order_id || null,
                payment_method: payment_method || 'cash',
                amount: amount || 0,
                type: type || 'sale',
                expected_balance: summary.expected_balance
            },
            ip_address: getRequestIp(req)
        });
        res.json({ id: paymentId, expected_balance: summary.expected_balance });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const createCashTransaction = catchAsync(async (req, res) => {
    const { register_id, type, amount, reason, notes } = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [registers] = await connection.query(
            'SELECT current_shift_id, status FROM cash_registers WHERE id = ? FOR UPDATE',
            [register_id]
        );
        if (registers.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Caja no encontrada' });
        }
        if (registers[0].status !== 'open' || !registers[0].current_shift_id) {
            await connection.rollback();
            return res.status(409).json({ error: 'closed_register', message: 'La caja debe estar abierta para registrar movimientos' });
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

        await connection.commit();

        await auditService.log({
            user_id: req.user?.id || null,
            action: 'CREATE_CASH_TRANSACTION',
            entity_type: 'transaction',
            entity_id: paymentId,
            new_values: {
                register_id,
                shift_id: shiftId,
                type: paymentType,
                amount,
                reason,
                notes: notes || null,
                expected_balance: summary.expected_balance
            },
            ip_address: getRequestIp(req)
        });

        res.json({ id: paymentId, success: true, expected_balance: summary.expected_balance });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});
