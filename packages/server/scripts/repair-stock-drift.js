// Reparación del defecto C1 (ventas POS que nunca descontaron stock).
//
// Por defecto es una SIMULACIÓN: repara cada pedido dentro de una transacción y la
// revierte, así se detectan las anomalías sin escribir nada. Para aplicar:
//   node scripts/repair-stock-drift.js --apply --confirm=<DB_NAME>
// Opcional: --cancel-unpaid  cancela los pedidos de clase C (sin factura ni pago)
//           liberando su reserva. Sin esta opción la clase C solo se lista.
//
// Clase A (facturado o pagado): descuenta stock, libera la reserva y registra el
//   movimiento 'sale' con la fecha original de la venta.
// Clase B (como A, pero un conteo posterior ya corrigió el stock físico): solo
//   libera la reserva, para no descontar dos veces.
// Cada pedido va en su propia transacción y deja un registro de auditoría
// REPAIR_POS_STOCK_C1, que también hace idempotente una segunda corrida.
// Correr fuera del horario de atención: bloquea brevemente filas de inventario.
import { closePool } from '../config/db.js';
import pool from '../config/db.js';
import auditService from '../services/audit.service.js';
import { assertSafeDatabaseTarget, getEnvConfig } from '../config/env.js';
import { DRIFT_CLASSES, REPAIR_AUDIT_ACTION, findAffectedOrders, repairOrder } from './stock-drift/stockDrift.js';
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
console.error(`[reparacion] destino ${target.host}:${target.port}/${target.database} (NODE_ENV=${target.node_env}) — ${apply ? 'APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);

const report = { target, applied: apply, repaired: [], skipped: [], anomalies: [] };
let orders = [];
const probe = await pool.getConnection();
try {
    await assertMinimumMysqlVersion(probe);
    await probe.query('START TRANSACTION READ ONLY');
    orders = await findAffectedOrders(probe);
    await probe.query('ROLLBACK');
} finally {
    probe.release();
}

for (const order of orders) {
    let mode = null;
    if (order.drift_class === DRIFT_CLASSES.A) mode = 'sale';
    else if (order.drift_class === DRIFT_CLASSES.B) mode = 'release';
    else if (args['cancel-unpaid'] === true) mode = 'cancel';

    if (!mode) {
        report.skipped.push({ order_id: order.id, drift_class: order.drift_class, reason: 'clase C: revisar manualmente o usar --cancel-unpaid' });
        continue;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const changes = await repairOrder(connection, order, { mode: mode === 'cancel' ? 'release' : mode });
        if (mode === 'cancel') {
            await connection.query("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [order.id]);
        }
        await auditService.log({
            action: REPAIR_AUDIT_ACTION,
            entity_type: 'order',
            entity_id: order.id,
            new_values: { drift_class: order.drift_class, mode, changes },
        }, connection);

        if (apply) await connection.commit();
        else await connection.rollback();
        report.repaired.push({ order_id: order.id, drift_class: order.drift_class, mode, changes });
    } catch (error) {
        await connection.rollback();
        report.anomalies.push({ order_id: order.id, drift_class: order.drift_class, error: error.message });
    } finally {
        connection.release();
    }
}

const totals = {
    affected: orders.length,
    [apply ? 'repaired' : 'would_repair']: report.repaired.length,
    skipped: report.skipped.length,
    anomalies: report.anomalies.length,
};
console.error(`[reparacion] ${JSON.stringify(totals)}`);
writeOutput(args.out, JSON.stringify({ ...report, totals }, null, 2));
await closePool();
if (report.anomalies.length > 0) process.exitCode = 1;
