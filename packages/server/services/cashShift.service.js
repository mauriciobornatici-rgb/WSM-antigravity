import crypto from 'crypto';

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function calculateShiftExpectedBalance(connection, shiftId) {
    const [payments] = await connection.query(`
        SELECT
            COALESCE(SUM(CASE WHEN payment_method = 'cash' AND type IN ('sale', 'income') THEN amount ELSE 0 END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' AND type IN ('refund', 'expense') THEN amount ELSE 0 END), 0) AS outflow
        FROM shift_payments
        WHERE shift_id = ?
    `, [shiftId]);

    const [shifts] = await connection.query(
        'SELECT opening_balance FROM cash_shifts WHERE id = ? LIMIT 1',
        [shiftId]
    );
    const openingBalance = shifts.length > 0 ? Number(shifts[0].opening_balance || 0) : 0;
    const inflow = Number(payments[0]?.inflow || 0);
    const outflow = Number(payments[0]?.outflow || 0);
    return {
        opening_balance: openingBalance,
        inflow,
        outflow,
        expected_balance: roundMoney(openingBalance + inflow - outflow)
    };
}

function shiftNotOpenError() {
    const err = new Error('El turno de caja no existe o no está abierto.');
    err.statusCode = 409;
    err.status = 'fail';
    err.errorCode = 'CASH_SHIFT_NOT_OPEN';
    return err;
}

/**
 * Locks the shift that will receive a sale's payments. A sale captured offline may
 * find its shift already closed: it then goes to the register's currently open shift
 * (ADR-008), and `reassigned` reports it for the audit trail.
 */
export async function lockOpenShift(connection, shiftId, { allowReassign = false } = {}) {
    const [shifts] = await connection.query(
        'SELECT id, status, cash_register_id FROM cash_shifts WHERE id = ? FOR UPDATE',
        [shiftId]
    );
    const shift = shifts[0];
    if (shift && String(shift.status).toLowerCase() === 'open') {
        return { shiftId: shift.id, reassigned: false };
    }
    if (!shift || !allowReassign) throw shiftNotOpenError();

    const [openShifts] = await connection.query(
        `SELECT id FROM cash_shifts
         WHERE cash_register_id = ? AND status = 'open'
         ORDER BY opened_at DESC, id
         LIMIT 1
         FOR UPDATE`,
        [shift.cash_register_id]
    );
    if (openShifts.length === 0) throw shiftNotOpenError();
    return { shiftId: openShifts[0].id, reassigned: true, originalShiftId: shift.id };
}

/**
 * Records a sale's payments in a shift, one line per method (split lines of the same
 * method are added up), skipping methods already recorded for that order so a replay
 * is idempotent. Updates the shift's expected balance. Runs in the caller's transaction.
 */
export async function recordShiftSalePayments(connection, { shiftId, orderId, payments }) {
    const byMethod = new Map();
    for (const payment of payments || []) {
        const amount = roundMoney(payment.amount);
        if (!payment.method || amount <= 0) continue;
        byMethod.set(payment.method, roundMoney((byMethod.get(payment.method) || 0) + amount));
    }

    // Looked up by order, in ANY shift: a replay may land in a different (reassigned)
    // shift than the attempt that already recorded the cash, which must not count twice.
    const [existing] = await connection.query(
        "SELECT payment_method FROM shift_payments WHERE order_id = ? AND type = 'sale'",
        [orderId]
    );
    const alreadyRecorded = new Set(existing.map((row) => row.payment_method));

    const inserted = [];
    for (const [method, amount] of byMethod) {
        if (alreadyRecorded.has(method)) continue;
        const id = crypto.randomUUID();
        await connection.query(
            "INSERT INTO shift_payments (id, shift_id, order_id, payment_method, amount, type) VALUES (?, ?, ?, ?, ?, 'sale')",
            [id, shiftId, orderId, method, amount]
        );
        inserted.push({ id, payment_method: method, amount });
    }

    const summary = await calculateShiftExpectedBalance(connection, shiftId);
    await connection.query('UPDATE cash_shifts SET expected_balance = ? WHERE id = ?', [summary.expected_balance, shiftId]);
    return { inserted, expected_balance: summary.expected_balance };
}
