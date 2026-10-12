// Diagnóstico de solo lectura de los asientos de compra duplicados (ADR-010):
// hasta 2026-09-25 una compra se asentaba dos veces — al aprobar la recepción
// (journal_entries.reference_type='reception') y otra vez al registrar la
// factura del proveedor (reference_type='supplier_invoice'), con las mismas
// cuentas (Mercadería, IVA Crédito Fiscal, Proveedores). Este script solo lee:
// clasifica cada asiento de recepción sin revertir según si ya existe una
// factura asentada que lo duplica.
//
// Clases:
//   exact           factura vinculada por reception_id, ya asentada.
//   probable        sin vínculo directo, pero una factura de la misma orden de
//                   compra ya está asentada (los importes pueden diferir con
//                   recepciones parciales: requiere revisión del contador).
//   pending_invoice ninguna factura asentada todavía (con la política nueva,
//                   el asiento duplicado aparecerá recién cuando llegue la
//                   factura).
//
// Uso (desde packages/server, con el ENV_FILE del entorno a revisar):
//   node scripts/diagnose-purchase-entry-duplicates.js
//   node scripts/diagnose-purchase-entry-duplicates.js --format=csv --out=duplicados.csv
//
// Corre dentro de START TRANSACTION READ ONLY: MySQL rechaza cualquier escritura.
import { closePool } from '../config/db.js';
import pool from '../config/db.js';
import { diagnoseDuplicates, summarize } from './purchase-entries/purchaseEntries.js';
import { assertMinimumMysqlVersion, describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

function toCsv(duplicates) {
    const header = [
        'entry_id', 'entry_number', 'fecha', 'clase', 'recepcion', 'proveedor_id', 'orden_compra_id',
        'total_debito', 'factura_id', 'factura_numero', 'factura_total', 'vinculo',
    ];
    const lines = [header.join(',')];
    for (const dup of duplicates) {
        if (dup.matched_invoices.length === 0) {
            lines.push([
                dup.entry_id, dup.entry_number, new Date(dup.date).toISOString(), dup.class,
                dup.reception_number, dup.supplier_id, dup.purchase_order_id || '', dup.total_debit, '', '', '', '',
            ].join(','));
            continue;
        }
        for (const invoice of dup.matched_invoices) {
            lines.push([
                dup.entry_id, dup.entry_number, new Date(dup.date).toISOString(), dup.class,
                dup.reception_number, dup.supplier_id, dup.purchase_order_id || '', dup.total_debit,
                invoice.invoice_id, invoice.invoice_number, invoice.total_amount, invoice.linked_by,
            ].join(','));
        }
    }
    return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const target = describeTarget();
console.error(`[diagnostico] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — solo lectura`);

const connection = await pool.getConnection();
try {
    const mysqlVersion = await assertMinimumMysqlVersion(connection);
    await connection.query('START TRANSACTION READ ONLY');
    const duplicates = await diagnoseDuplicates(connection);
    await connection.query('ROLLBACK');

    const summary = summarize(duplicates);
    console.error(`[diagnostico] MySQL ${mysqlVersion}: ${JSON.stringify(summary)}`);
    if (args.format === 'csv') {
        writeOutput(args.out, toCsv(duplicates));
    } else {
        writeOutput(args.out, JSON.stringify({ target, mysql_version: mysqlVersion, summary, duplicates }, null, 2));
    }
} catch (error) {
    console.error(`[diagnostico] Error: ${error.message}`);
    process.exitCode = 1;
} finally {
    connection.release();
    await closePool();
}
