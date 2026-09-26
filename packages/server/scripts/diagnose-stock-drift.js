// Diagnóstico de solo lectura del defecto C1 (ventas POS que nunca descontaron stock).
//
// Uso (desde packages/server, con el ENV_FILE del entorno a revisar):
//   node scripts/diagnose-stock-drift.js                  resumen + detalle en JSON
//   node scripts/diagnose-stock-drift.js --format=csv --out=drift.csv
//
// Corre dentro de START TRANSACTION READ ONLY: MySQL rechaza cualquier escritura.
import { closePool } from '../config/db.js';
import pool from '../config/db.js';
import { findAffectedOrders, findInvariantViolations, summarize } from './stock-drift/stockDrift.js';
import { assertMinimumMysqlVersion, describeTarget, parseArgs, toCsv, writeOutput } from './stock-drift/cli.js';

const args = parseArgs(process.argv.slice(2));
const target = describeTarget();
console.error(`[diagnostico] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — solo lectura`);

const connection = await pool.getConnection();
try {
    const mysqlVersion = await assertMinimumMysqlVersion(connection);
    await connection.query('START TRANSACTION READ ONLY');
    const orders = await findAffectedOrders(connection);
    const violations = await findInvariantViolations(connection);
    await connection.query('ROLLBACK');

    const summary = summarize(orders, violations);
    console.error(`[diagnostico] MySQL ${mysqlVersion}: ${JSON.stringify(summary)}`);
    if (args.format === 'csv') {
        writeOutput(args.out, toCsv(orders));
    } else {
        writeOutput(args.out, JSON.stringify({ target, mysql_version: mysqlVersion, summary, orders, violations }, null, 2));
    }
} catch (error) {
    console.error(`[diagnostico] Error: ${error.message}`);
    process.exitCode = 1;
} finally {
    connection.release();
    await closePool();
}
