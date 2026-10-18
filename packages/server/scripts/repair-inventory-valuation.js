// Transición a la valuación por costo de última compra (ADR-027). Una sola vez, con la app detenida.
//
// Por defecto es una SIMULACIÓN: hace todo dentro de una transacción y la revierte, así se ve el
// informe sin escribir nada. Para aplicar (después de revisar la simulación):
//   node scripts/repair-inventory-valuation.js --apply --confirm=<DB_NAME>
// Opcional: --out=transicion.json
//
// Antes exige: migraciones 064-066, la reparación de stock C1 hecha y ningún asiento de recepción
// sin revertir. Pasos (ver RUNBOOK_VALUACION_INVENTARIO.md):
//   1. un solo costo por producto (purchase_price; cost_price como espejo);
//   2. las ventas que salieron sin costo registrado lo registran (o quedan vinculadas al costo que
//      asentó su factura con la regla anterior);
//   3. los remitos aprobados y sin facturar abren 2.1.01.02;
//   4. un ajuste final del mayor de Inventario al stock valuado, contra 3.1.03.01 (D4);
//   5. queda la fecha de corte; una segunda corrida no hace nada.
// Sale con código 1 si al final el mayor no coincide con el stock valuado (y no confirma nada).
import crypto from 'node:crypto';
import pool, { closePool } from '../config/db.js';
import accountingService from '../services/accounting.service.js';
import auditService from '../services/audit.service.js';
import { assertSafeDatabaseTarget, getEnvConfig } from '../config/env.js';
import { findAffectedOrders } from './stock-drift/stockDrift.js';
import { findReceptionEntries } from './purchase-entries/purchaseEntries.js';
import { checkCutoverPreconditions, runCutover } from './inventory-valuation/valuation.js';
import { assertMinimumMysqlVersion, describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

const args = parseArgs(process.argv.slice(2));
const apply = args.apply === true;
const target = describeTarget();

if (apply) {
    assertSafeDatabaseTarget(getEnvConfig());
    if (args.confirm !== target.database) {
        console.error(`Para aplicar se requiere --confirm=${target.database} (nombre exacto de la base destino).`);
        process.exit(2);
    }
}
console.error(`[transicion] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — ${apply ? 'APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);
if (!apply) {
    // It reverts everything, but it locks the products while it runs and uses entry numbers.
    console.error('[transicion] La simulación bloquea los productos mientras corre y deja saltos en la numeración de asientos: hacela con la app detenida, mejor sobre una copia restaurada del backup. Para solo mirar, usá diagnose-inventory-valuation.js.');
}

const connection = await pool.getConnection();
let report = null;
try {
    await assertMinimumMysqlVersion(connection);
    const problems = await checkCutoverPreconditions(connection, { findAffectedOrders, findReceptionEntries });
    if (problems.length > 0) {
        for (const problem of problems) console.error(`[transicion] ${problem}`);
        process.exitCode = 2;
    } else {
        await connection.beginTransaction();
        report = await runCutover(connection, { runId: crypto.randomUUID(), accounting: accountingService, audit: auditService });
        const ok = report.already_done || report.after?.ok;
        if (apply && ok && !report.already_done) await connection.commit();
        else await connection.rollback();
        if (report.already_done) console.error(`[transicion] Ya se hizo el ${new Date(report.since).toISOString()}: nada para hacer.`);
        else if (!ok) {
            console.error('[transicion] Después del ajuste el mayor no coincide con el stock valuado: no se confirmó nada.');
            process.exitCode = 1;
        }
        writeOutput(args.out, JSON.stringify({ target, applied: apply && ok && !report.already_done, ...report }, null, 2));
    }
} catch (error) {
    await connection.rollback().catch(() => {});
    console.error(`[transicion] Error: ${error.message}`);
    process.exitCode = 1;
} finally {
    connection.release();
    await closePool();
}
