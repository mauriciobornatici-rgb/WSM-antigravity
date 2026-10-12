import fs from 'node:fs';
import { getEnvConfig } from '../../config/env.js';

export function parseArgs(argv) {
    const args = {};
    for (const raw of argv) {
        if (!raw.startsWith('--')) continue;
        const [key, ...rest] = raw.slice(2).split('=');
        args[key] = rest.length > 0 ? rest.join('=') : true;
    }
    return args;
}

export function describeTarget() {
    const env = getEnvConfig();
    return {
        node_env: env.nodeEnv,
        host: process.env.DB_HOST || 'localhost',
        port: env.dbPort,
        database: process.env.DB_NAME || 'sports_erp',
    };
}

export async function assertMinimumMysqlVersion(connection) {
    const [[row]] = await connection.query('SELECT VERSION() AS version');
    const [major, minor, patch] = String(row.version).split(/[.-]/).map(Number);
    const supported = major > 8 || (major === 8 && (minor > 0 || patch >= 16));
    if (!supported) throw new Error(`MySQL ${row.version} no soportado: se requiere 8.0.16 o superior`);
    return row.version;
}

export function writeOutput(path, content) {
    if (path) {
        fs.writeFileSync(path, content, 'utf8');
        console.error(`Resultado escrito en ${path}`);
    } else {
        process.stdout.write(`${content}\n`);
    }
}

export function toCsv(orders) {
    const header = ['order_id', 'clase', 'estado', 'fecha', 'factura', 'pago_en_caja', 'sin_asignaciones', 'product_id', 'producto', 'cantidad', 'contado_despues'];
    const lines = [header.join(',')];
    for (const order of orders) {
        for (const item of order.items) {
            lines.push([
                order.id, order.drift_class, order.status, new Date(order.created_at).toISOString(), order.invoice_id || '',
                order.has_shift_payment, order.legacy_without_allocations, item.product_id,
                `"${String(item.product_name || '').replaceAll('"', '""')}"`, item.quantity, item.counted_after,
            ].join(','));
        }
    }
    return lines.join('\n');
}
