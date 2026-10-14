// ADR-016/017 punto 5: productos creados por la importación de Tiendanube antes de ADR-015
// guardaron el precio final (con IVA) como si fuera neto: en pantalla se ven un 21 % más caros.
// Este script los encuentra sin adivinar y, con --apply, guarda el neto (precio / (1 + IVA)).
//
// Por defecto es una SIMULACIÓN (no escribe). Para aplicar:
//   node scripts/repair-tiendanube-prices.js --before=2026-10-13 --apply --confirm=<DB_NAME>
// --before: fecha del despliegue de ADR-015 (las importaciones posteriores ya guardan el neto).
//
// Cómo decide el origen de cada producto vinculado a Tiendanube:
// 1. Si el producto tiene `origin` (ADR-017), manda: solo 'tiendanube_import' se corrige.
// 2. Si no (productos anteriores), se consulta a Tiendanube (solo lectura) cuándo se creó el
//    producto allá: si existía en la tienda ANTES que su familia en el ERP, vino de una
//    importación (precio final guardado como neto). Si se creó después, se publicó desde el
//    ERP (precio neto correcto) y no se toca.
// 3. Si Tiendanube no responde o falta el dato, queda "sin verificar" y NO se corrige.
// Los productos editados en el ERP después de vincularse se listan para revisar a mano.
// Cada corrección deja auditoría REPAIR_TN_IMPORTED_PRICE (además hace idempotente una
// segunda corrida) y marca el producto con origin = 'tiendanube_import'. El precio que ve el
// cliente en Tiendanube no cambia: ya era ese precio final.
import pool, { closePool } from '../config/db.js';
import auditService from '../services/audit.service.js';
import tiendanubeService from '../services/tiendanube.service.js';
import { assertSafeDatabaseTarget, getEnvConfig } from '../config/env.js';
import { describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

export const REPAIR_ACTION = 'REPAIR_TN_IMPORTED_PRICE';
// Clock differences between Tiendanube and the database.
const CLOCK_TOLERANCE_MS = 60 * 1000;

export async function findLinkedProducts(connection, before) {
    const [rows] = await connection.query(
        `SELECT p.id, p.sku, p.name, p.sale_price, COALESCE(p.vat_rate, 21) AS vat_rate, p.origin,
                f.remote_product_id, f.created_at AS family_created_at, v.created_at AS linked_at,
                p.created_at AS product_created_at,
                EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id
                        AND a.action = 'CREATE_PRODUCT') AS created_in_erp,
                EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id
                        AND a.action = 'UPDATE_PRODUCT' AND a.created_at >= v.created_at) AS edited_after,
                EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id
                        AND a.action = ?) AS already_repaired
         FROM tiendanube_catalog_variants v
         JOIN tiendanube_catalog_families f ON f.id = v.family_id
         JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL
         WHERE p.created_at < ? AND p.sale_price > 0
         ORDER BY p.sku`,
        [REPAIR_ACTION, before]
    );
    return rows;
}

/**
 * Classifies a product: 'imported' (fix it), 'erp' (leave it) or 'unverified' (leave it, review).
 * remoteCreatedAt(remoteProductId) returns the Tiendanube creation date or null.
 */
export async function classifyOrigin(row, remoteCreatedAt) {
    if (row.origin === 'tiendanube_import') return { origin: 'imported', evidence: 'origen registrado' };
    if (row.origin) return { origin: 'erp', evidence: `origen registrado: ${row.origin}` };
    if (!row.remote_product_id) return { origin: 'erp', evidence: 'sin producto en Tiendanube' };
    // Created here and linked later by SKU (the import does not touch its price): the ERP's.
    if (Number(row.created_in_erp)) return { origin: 'erp', evidence: 'alta registrada en el ERP' };
    if (row.product_created_at && row.linked_at
        && new Date(row.product_created_at).getTime() < new Date(row.linked_at).getTime() - 2 * CLOCK_TOLERANCE_MS) {
        return { origin: 'erp', evidence: 'existía en el ERP antes de vincularse con Tiendanube' };
    }
    const remote = await remoteCreatedAt(row.remote_product_id);
    if (!remote) return { origin: 'unverified', evidence: 'Tiendanube no informó la fecha de creación' };
    const local = new Date(row.family_created_at).getTime();
    if (remote.getTime() < local - CLOCK_TOLERANCE_MS) {
        return { origin: 'imported', evidence: `creado en Tiendanube ${remote.toISOString()} antes que en el ERP` };
    }
    return { origin: 'erp', evidence: `creado en Tiendanube ${remote.toISOString()} después que en el ERP (publicado desde acá)` };
}

export function correction(row) {
    const current = Number(row.sale_price);
    const rate = Number(row.vat_rate);
    return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        vat_rate: rate,
        stored_net: current,
        final_shown_now: Math.round(current * (1 + rate / 100) * 100) / 100,
        corrected_net: Math.round((current / (1 + rate / 100)) * 10000) / 10000,
        final_after: Math.round(current * 100) / 100,
    };
}

async function remoteCreatedAtFromApi() {
    const creds = await tiendanubeService.getCredentials();
    if (!creds) return async () => null;
    const cache = new Map();
    return async (remoteProductId) => {
        if (cache.has(remoteProductId)) return cache.get(remoteProductId);
        let value = null;
        try {
            const response = await tiendanubeService.apiRequest('get', creds, `/products/${remoteProductId}`);
            const parsed = response?.data?.created_at ? new Date(response.data.created_at) : null;
            value = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
        } catch {
            value = null;
        }
        cache.set(remoteProductId, value);
        return value;
    };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop());
if (isMain) {
    const args = parseArgs(process.argv.slice(2));
    const apply = args.apply === true;
    const target = describeTarget();
    if (typeof args.before !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.before)) {
        console.error('Falta --before=AAAA-MM-DD (fecha del despliegue de ADR-015).');
        process.exit(2);
    }
    if (apply) {
        assertSafeDatabaseTarget(getEnvConfig());
        if (args.confirm !== target.database) {
            console.error(`Para aplicar se requiere --confirm=${target.database} (nombre exacto de la base destino).`);
            process.exit(2);
        }
    }
    console.error(`[precios-tn] destino ${target.host}:${target.port}/${target.database} — ${apply ? 'APLICANDO CAMBIOS' : 'simulación (no escribe)'}`);

    const rows = await findLinkedProducts(pool, args.before);
    const remoteCreatedAt = await remoteCreatedAtFromApi();
    const report = { target, applied: apply, repaired: [], review: [], unverified: [], kept: [], skipped: [] };
    for (const row of rows) {
        const product = correction(row);
        if (row.already_repaired) {
            report.skipped.push({ ...product, reason: 'ya corregido' });
            continue;
        }
        const { origin, evidence } = await classifyOrigin(row, remoteCreatedAt);
        if (origin === 'erp') {
            report.kept.push({ id: product.id, sku: product.sku, evidence });
            continue;
        }
        if (origin === 'unverified') {
            report.unverified.push({ ...product, evidence });
            continue;
        }
        if (row.edited_after) {
            report.review.push({ ...product, evidence, reason: 'editado en el ERP después de importarlo: revisar a mano' });
            continue;
        }
        if (apply) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const [locked] = await connection.query('SELECT sale_price FROM products WHERE id = ? FOR UPDATE', [product.id]);
                if (Number(locked[0]?.sale_price) !== product.stored_net) throw new Error('el precio cambió durante la corrida');
                await connection.query("UPDATE products SET sale_price = ?, origin = 'tiendanube_import' WHERE id = ?", [product.corrected_net, product.id]);
                await auditService.log({
                    action: REPAIR_ACTION,
                    entity_type: 'product',
                    entity_id: product.id,
                    old_values: { sale_price: product.stored_net },
                    new_values: { sale_price: product.corrected_net, evidence, reason: 'precio final de Tiendanube guardado como neto (ADR-016)' },
                }, connection);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                report.skipped.push({ ...product, reason: error.message });
                continue;
            } finally {
                connection.release();
            }
        }
        report.repaired.push({ ...product, evidence });
    }
    const totals = {
        linked: rows.length,
        [apply ? 'repaired' : 'would_repair']: report.repaired.length,
        kept_erp: report.kept.length,
        unverified: report.unverified.length,
        review: report.review.length,
        skipped: report.skipped.length,
    };
    console.error(`[precios-tn] ${JSON.stringify(totals)}`);
    writeOutput(args.out, JSON.stringify({ ...report, totals }, null, 2));
    await closePool();
}
