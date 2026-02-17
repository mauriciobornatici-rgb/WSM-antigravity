export async function nextDocumentSequence(connection, scope, minimumValue = 0) {
    await connection.query(
        'INSERT IGNORE INTO document_sequences (scope, last_value) VALUES (?, 0)',
        [scope]
    );

    const [rows] = await connection.query(
        'SELECT last_value FROM document_sequences WHERE scope = ? FOR UPDATE',
        [scope]
    );

    const currentValue = Number(rows[0]?.last_value || 0);
    const safeMinimum = Number(minimumValue || 0);
    const baseValue = Math.max(currentValue, Number.isFinite(safeMinimum) ? safeMinimum : 0);
    const nextValue = baseValue + 1;

    await connection.query(
        'UPDATE document_sequences SET last_value = ? WHERE scope = ?',
        [nextValue, scope]
    );

    return nextValue;
}
