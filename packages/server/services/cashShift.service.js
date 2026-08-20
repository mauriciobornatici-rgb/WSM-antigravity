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
        expected_balance: openingBalance + inflow - outflow
    };
}
