// Reversión de los asientos de compra duplicados (ADR-010).
//
// Por defecto es una SIMULACIÓN: solo lista qué se revertiría, no escribe nada.
// Para aplicar:
//   node scripts/reverse-purchase-entry-duplicates.js --apply --confirm=<DB_NAME>
//
// Por defecto solo revierte la clase 'exact' (factura vinculada por reception_id
// ya asentada — duplicado seguro). Para incluir otras clases (requieren revisión
// del contador antes de aplicar):
//   --include=probable,pending_invoice
// Para restringir a asientos puntuales ya revisados:
//   --entries=<id1,id2,...>
//
// Cada reversión es un contra-asiento real creado por
// accounting.service.js reverseJournalEntry(id, userId) (líneas con débito y
// crédito invertidos, en su propia transacción, con auditoría). Este script
// nunca escribe journal_entries directamente. Es idempotente: un asiento ya
// revertido (por ejemplo por una corrida anterior) se reporta como omitido,
// no como error. Los errores por asiento no detienen el resto; si hubo alguno,
// el proceso termina con código de salida 1.
import { closePool } from '../config/db.js';
import pool from '../config/db.js';
import accountingService from '../services/accounting.service.js';
import { assertSafeDatabaseTarget, getEnvConfig } from '../config/env.js';
import { diagnoseDuplicates, reverseDuplicates } from './purchase-entries/purchaseEntries.js';
import { assertMinimumMysqlVersion, describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

const args = parseArgs(process.argv.slice(2));
const apply = args.apply === true;
const target = describeTarget();
const classes = ['exact', ...String(args.include || '').split(',').map((c) => c.trim()).filter(Boolean)];
const entryIds = args.entries
    ? String(args.entries).split(',').map((id) => id.trim()).filter(Boolean)
    : null;

if (apply) {
    assertSafeDatabaseTarget(getEnvConfig());
    if (args.confirm !== target.database) {
        console.error(`Para aplicar se requiere --confirm=${target.database} (nombre exacto de la base destino).`);
        process.exit(2);
    }
}
console.error(`[reversion] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — ${apply ? 'APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
console.error(`[reversion] clases incluidas: ${classes.join(', ')}${entryIds ? `; restringido a asientos ${entryIds.join(', ')}` : ''}`);

const probe = await pool.getConnection();
let duplicates = [];
try {
    await assertMinimumMysqlVersion(probe);
    await probe.query('START TRANSACTION READ ONLY');
    duplicates = await diagnoseDuplicates(probe);
    await probe.query('ROLLBACK');
} finally {
    probe.release();
}

const targets = duplicates.filter(
    (dup) => classes.includes(dup.class) && (!entryIds || entryIds.includes(dup.entry_id))
);

const report = {
    target,
    applied: apply,
    classes,
    entry_filter: entryIds,
    would_reverse: targets.map((dup) => ({
        entry_id: dup.entry_id, entry_number: dup.entry_number, class: dup.class,
        reception_number: dup.reception_number, total_debit: dup.total_debit,
        matched_invoices: dup.matched_invoices,
    })),
    reversed: [],
    skipped: [],
    errors: [],
};

if (apply) {
    const result = await reverseDuplicates(accountingService, duplicates, { classes, entryIds, userId: null });
    report.reversed = result.reversed;
    report.skipped = result.skipped;
    report.errors = result.errors;
}

const totals = {
    candidates: targets.length,
    [apply ? 'reversed' : 'would_reverse']: apply ? report.reversed.length : targets.length,
    skipped: report.skipped.length,
    errors: report.errors.length,
};
console.error(`[reversion] ${JSON.stringify(totals)}`);
writeOutput(args.out, JSON.stringify({ ...report, totals }, null, 2));
await closePool();
if (report.errors.length > 0) process.exitCode = 1;
