// ADR-016 punto 6: productos creados por la importación del catálogo de Tiendanube antes de
// ADR-015 guardaron el precio final (con IVA) como si fuera neto: en pantalla se ven un 21 %
// más caros. Este script los lista y, con --apply, guarda el neto (precio / (1 + IVA)).
//
// Por defecto es una SIMULACIÓN (no escribe). Para aplicar:
//   node scripts/repair-tiendanube-prices.js --before=2026-10-13 --apply --confirm=<DB_NAME>
// --before: fecha del despliegue de ADR-015 (importaciones posteriores ya guardan el neto).
//
// Solo toca productos que la importación creó (el producto nace junto con su vínculo, con
// menos de 2 minutos de diferencia) y que nadie editó después en el ERP: los editados se
// listan para revisar a mano. Cada corrección deja auditoría REPAIR_TN_IMPORTED_PRICE, que
// además hace idempotente una segunda corrida.
// Excluye los productos dados de alta en el ERP desde "Tienda online" con stock inicial (nacían
// con precio neto). Uno dado de alta ahí sin stock no se distingue de una importación: revisá
// la lista de la simulación antes de aplicar.
// Después de aplicar, publicá los precios en Tiendanube desde la pantalla Tienda online: este
// script corrige la base local, no la tienda.
import pool, { closePool } from '../config/db.js';
import auditService from '../services/audit.service.js';
import { assertSafeDatabaseTarget, getEnvConfig } from '../config/env.js';
import { describeTarget, parseArgs, writeOutput } from './stock-drift/cli.js';

export const REPAIR_ACTION = 'REPAIR_TN_IMPORTED_PRICE';

export async function findImportedGrossPrices(connection, before) {
    const [rows] = await connection.query(
        `SELECT p.id, p.sku, p.name, p.sale_price, COALESCE(p.vat_rate, 21) AS vat_rate, v.created_at AS linked_at,
                EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id
                        AND a.action = 'UPDATE_PRODUCT' AND a.created_at >= v.created_at) AS edited_after,
                EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'product' AND a.entity_id = p.id
                        AND a.action = ?) AS already_repaired
         FROM tiendanube_catalog_variants v
         JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL
         WHERE v.created_at < ?
           AND ABS(TIMESTAMPDIFF(SECOND, p.created_at, v.created_at)) <= 120
           AND p.sale_price > 0
           -- Products created in the ERP from "Tienda online" (createCatalogFamily) were born
           -- with a net price: they are not imports. Those created with stock leave this
           -- movement; one created without stock cannot be told apart, so review the list.
           AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id
                           AND m.type = 'initial_stock' AND m.reason = 'Alta desde Tienda online')
         ORDER BY p.sku`,
        [REPAIR_ACTION, before]
    );
    return rows.map((row) => {
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
            edited_after: Boolean(row.edited_after),
            already_repaired: Boolean(row.already_repaired),
        };
    });
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

    const products = await findImportedGrossPrices(pool, args.before);
    const report = { target, applied: apply, repaired: [], review: [], skipped: [] };
    for (const product of products) {
        if (product.already_repaired) {
            report.skipped.push({ ...product, reason: 'ya corregido' });
            continue;
        }
        if (product.edited_after) {
            report.review.push({ ...product, reason: 'editado en el ERP después de importarlo: revisar a mano' });
            continue;
        }
        if (apply) {
            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();
                const [locked] = await connection.query('SELECT sale_price FROM products WHERE id = ? FOR UPDATE', [product.id]);
                if (Number(locked[0]?.sale_price) !== product.stored_net) throw new Error('el precio cambió durante la corrida');
                await connection.query('UPDATE products SET sale_price = ? WHERE id = ?', [product.corrected_net, product.id]);
                await auditService.log({
                    action: REPAIR_ACTION,
                    entity_type: 'product',
                    entity_id: product.id,
                    old_values: { sale_price: product.stored_net },
                    new_values: { sale_price: product.corrected_net, reason: 'precio final de Tiendanube guardado como neto (ADR-016)' },
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
        report.repaired.push(product);
    }
    const totals = { found: products.length, [apply ? 'repaired' : 'would_repair']: report.repaired.length, review: report.review.length, skipped: report.skipped.length };
    console.error(`[precios-tn] ${JSON.stringify(totals)}`);
    writeOutput(args.out, JSON.stringify({ ...report, totals }, null, 2));
    await closePool();
}
