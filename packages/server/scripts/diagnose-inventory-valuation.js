// Diagnóstico de solo lectura de la valuación de la mercadería (ADR-027): compara el mayor de
// Inventario (1.1.04.01) con el stock valuado al costo de cada producto.
//
// Uso (desde packages/server, con el ENV_FILE del entorno a revisar):
//   node scripts/diagnose-inventory-valuation.js                 resumen en JSON
//   node scripts/diagnose-inventory-valuation.js --out=valuacion.json
//
// Corre dentro de START TRANSACTION READ ONLY: MySQL rechaza cualquier escritura.
// Sale con código 1 si el mayor no coincide con el stock valuado.
import pool, { closePool } from '../config/db.js';
import { checkInventoryValuation } from './inventory-valuation/valuation.js';
import { describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

const args = parseArgs(process.argv.slice(2));
const target = describeTarget();
console.error(`[valuacion] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — solo lectura`);

const connection = await pool.getConnection();
try {
    await connection.query('START TRANSACTION READ ONLY');
    const result = await checkInventoryValuation(connection);
    await connection.query('ROLLBACK');
    console.error(`[valuacion] mayor ${result.inventory_ledger} · stock valuado ${result.stock_valued} · diferencia ${result.difference}`);
    writeOutput(args.out, JSON.stringify({ target, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
} catch (error) {
    console.error(`[valuacion] Error: ${error.message}`);
    process.exitCode = 1;
} finally {
    connection.release();
    await closePool();
}
