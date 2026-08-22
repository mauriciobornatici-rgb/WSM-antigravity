import crypto from 'crypto';
import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import getRequestIp from '../utils/requestIp.js';
import financeService from '../services/finance.service.js';
import { calculateShiftExpectedBalance } from '../services/cashShift.service.js';

export const getTransactions = catchAsync(async (req, res) => {
    const { supplier_id, client_id, type, start_date, end_date } = req.query;
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
    if (start_date) {
        query += ' AND DATE(t.date) >= DATE(?)';
        params.push(start_date);
    }
    if (end_date) {
        query += ' AND DATE(t.date) <= DATE(?)';
        params.push(end_date);
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
        }, connection);
        await connection.commit();
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
        }, connection);
        await connection.commit();
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
            'SELECT id FROM cash_shifts WHERE id = ? AND status = "open" LIMIT 1 FOR UPDATE',
            [id]
        );
        if (shifts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'not_found', message: 'Turno abierto no encontrado' });
        }

        if (order_id) {
            const resolvedMethod = payment_method || 'cash';
            const resolvedType = type || 'sale';
            const [existingPayments] = await connection.query(
                `SELECT id
                 FROM shift_payments
                 WHERE shift_id = ? AND order_id = ? AND payment_method = ? AND type = ?
                 LIMIT 1`,
                [id, order_id, resolvedMethod, resolvedType]
            );
            if (existingPayments.length > 0) {
                const summary = await calculateShiftExpectedBalance(connection, id);
                await connection.commit();
                return res.json({
                    id: existingPayments[0].id,
                    expected_balance: summary.expected_balance,
                    idempotent_replay: true
                });
            }
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
        }, connection);
        await connection.commit();
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
        }, connection);
        await connection.commit();

        res.json({ id: paymentId, success: true, expected_balance: summary.expected_balance });
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
});

export const getPendingInvoices = catchAsync(async (req, res) => {
    const { client_id } = req.query;
    let query = `
        SELECT i.*, c.name AS client_name, c.tax_id AS client_tax_id
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        WHERE i.deleted_at IS NULL
          AND i.payment_status IN ('pending', 'partial')
    `;
    const params = [];

    if (client_id) {
        query += ' AND i.client_id = ?';
        params.push(client_id);
    }

    query += ' ORDER BY i.issue_date ASC';

    const [invoiceRows] = await pool.query(query, params);

    // Get paid amounts from transactions to compute exact pending amount
    if (invoiceRows.length > 0) {
        const invoiceIds = invoiceRows.map(r => r.id);
        const [paymentRows] = await pool.query(`
            SELECT reference_id, SUM(amount) as paid_amount
            FROM transactions
            WHERE reference_id IN (?) AND type = 'sale'
            GROUP BY reference_id
        `, [invoiceIds]);

        const paidMap = {};
        for (const pr of paymentRows) {
            paidMap[pr.reference_id] = Number(pr.paid_amount || 0);
        }

        for (const row of invoiceRows) {
            const paid = paidMap[row.id] || 0;
            const total = Number(row.total_amount || 0);
            row.paid_amount = paid;
            row.pending_amount = Math.max(0, total - paid);
            row.document_type = 'invoice';
            row.fiscal_status = row.cae ? 'authorized' : 'pending_cae';
        }
    }

    let orderQuery = `
        SELECT o.id, o.id AS order_id, o.client_id, c.name AS client_name, c.tax_id AS client_tax_id,
               o.customer_name, o.created_at AS issue_date, o.payment_status, o.payment_method,
               CASE
                   WHEN COALESCE(SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END), 0) > 0
                       THEN SUM(CASE WHEN op.payment_method = 'credit_account' THEN op.amount ELSE 0 END)
                   WHEN o.payment_method = 'credit_account' THEN o.total_amount
                   ELSE 0
               END AS total_amount
        FROM orders o
        JOIN clients c ON c.id = o.client_id AND c.deleted_at IS NULL
        LEFT JOIN order_payments op ON op.order_id = o.id
        WHERE o.deleted_at IS NULL AND o.invoice_id IS NULL
          AND o.status NOT IN ('cancelled', 'returned')
    `;
    const orderParams = [];
    if (client_id) {
        orderQuery += ' AND o.client_id = ?';
        orderParams.push(client_id);
    }
    orderQuery += `
        GROUP BY o.id, o.client_id, c.name, c.tax_id, o.customer_name, o.created_at, o.payment_status, o.payment_method, o.total_amount
        HAVING total_amount > 0
        ORDER BY o.created_at ASC
    `;
    const [orderRows] = await pool.query(orderQuery, orderParams);
    if (orderRows.length > 0) {
        const orderIds = orderRows.map((row) => row.id);
        const [paymentRows] = await pool.query(`
            SELECT reference_id, SUM(amount) AS paid_amount
            FROM transactions
            WHERE reference_id IN (?) AND type = 'sale'
            GROUP BY reference_id
        `, [orderIds]);
        const paidMap = new Map(paymentRows.map((row) => [row.reference_id, Number(row.paid_amount || 0)]));
        for (const row of orderRows) {
            row.document_type = 'order';
            row.fiscal_status = 'not_invoiced';
            row.paid_amount = paidMap.get(row.id) || 0;
            row.pending_amount = Math.max(0, Number(row.total_amount || 0) - row.paid_amount);
        }
    }

    res.json([...invoiceRows, ...orderRows]
        .filter((row) => Number(row.pending_amount || 0) > 0.009)
        .sort((a, b) => new Date(a.issue_date).getTime() - new Date(b.issue_date).getTime()));
});

export const getFiscalSalesStatus = catchAsync(async (_req, res) => {
    const [rows] = await pool.query(`
        SELECT o.id AS order_id, o.created_at AS sale_date, o.total_amount AS order_total,
               o.customer_name, c.id AS client_id, c.name AS client_name, c.tax_id AS client_tax_id,
               i.id AS invoice_id, i.invoice_type, i.point_of_sale, i.invoice_number,
               i.total_amount AS invoice_total, i.status AS invoice_status, i.cae, i.cae_expiration_date,
               CASE
                   WHEN i.id IS NULL THEN 'not_invoiced'
                   WHEN i.cae IS NULL OR i.cae = '' THEN 'pending_cae'
                   ELSE 'authorized'
               END AS fiscal_status
        FROM orders o
        JOIN clients c ON c.id = o.client_id AND c.deleted_at IS NULL
        LEFT JOIN invoices i ON i.order_id = o.id AND i.deleted_at IS NULL
        WHERE o.deleted_at IS NULL AND o.status NOT IN ('cancelled', 'returned')
        ORDER BY o.created_at DESC
    `);
    res.json(rows);
});

export const registerBulkPayments = catchAsync(async (req, res) => {
    const userId = req.user?.id || null;
    const result = await financeService.registerBulkInvoicePayments(req.body, userId);
    res.json(result);
});

export const getCustomerChecks = catchAsync(async (req, res) => {
    const rows = await financeService.getCustomerChecks(req.query || {});
    res.json(rows);
});

export const getCustomerCheck = catchAsync(async (req, res) => {
    const row = await financeService.getCustomerCheck(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Cheque no encontrado' });
    res.json(row);
});

export const updateCustomerCheckStatus = catchAsync(async (req, res) => {
    const row = await financeService.updateCustomerCheckStatus(req.params.id, req.body, req.user?.id || null);
    res.json(row);
});

export const getOutgoingChecks = catchAsync(async (req, res) => {
    const rows = await financeService.getOutgoingChecks(req.query || {});
    res.json(rows);
});

export const getOutgoingCheck = catchAsync(async (req, res) => {
    const row = await financeService.getOutgoingCheck(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Cheque emitido no encontrado' });
    res.json(row);
});

export const updateOutgoingCheckStatus = catchAsync(async (req, res) => {
    const row = await financeService.updateOutgoingCheckStatus(req.params.id, req.body, req.user?.id || null);
    res.json(row);
});
