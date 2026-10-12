# Runbook — reparación del stock histórico de ventas POS (defecto C1)

## Qué pasó

Hasta el commit `0f62d53` (2026-09-25) una venta de mostrador del POS solo
**reservaba** stock: `inventory.quantity` nunca bajaba, `reserved_quantity` crecía y
no quedaba movimiento `sale`. El stock *disponible* (cantidad − reservado) sí bajaba,
por eso la operación diaria no lo mostraba. Consecuencias: cantidades físicas
infladas, reservas que nunca se liberan, historial de movimientos incompleto y
conteos cíclicos que comparan contra un "esperado" incorrecto.

El código ya está corregido. Este runbook repara los datos existentes.

## Clases

| Clase | Condición | Acción de la reparación |
|---|---|---|
| A | Pedido POS con factura o pago en caja | Descuenta stock, libera la reserva, crea movimiento `sale` con la fecha original, pedido → `completed` |
| B | Como A, pero hubo un conteo/ajuste del producto después de la venta | Solo libera la reserva (el conteo ya corrigió el físico) |
| C | Sin factura ni pago en caja | Solo se lista. `--cancel-unpaid` libera la reserva y cancela el pedido |

Cada pedido reparado deja una auditoría `REPAIR_POS_STOCK_C1` y no vuelve a
procesarse (la reparación es idempotente). Cada pedido va en su propia transacción:
si uno tiene una anomalía (p. ej. su reserva ya no existe), se informa y los demás siguen.

## Pasos (los ejecuta el usuario)

1. **Backup** de producción (`npm run db:backup`, revisando el destino) y verificá que restaura.
2. Desplegá primero la versión con el fix `0f62d53`, así no se generan casos nuevos.
3. Desde `packages/server`, con el entorno de producción:

   ```powershell
   node scripts/diagnose-stock-drift.js --out=drift.json
   node scripts/diagnose-stock-drift.js --format=csv --out=drift.csv
   ```

   Solo lectura (`START TRANSACTION READ ONLY`). Revisá el resumen y, en el CSV, los
   pedidos de clase B y C.
4. **Simulación** (no escribe; ejecuta la reparación y la revierte). Correla fuera del
   horario de atención, porque bloquea filas un instante:

   ```powershell
   node scripts/repair-stock-drift.js --out=repair-dryrun.json
   ```

   Revisá `anomalies`: son pedidos que requieren revisión manual.
5. **Aplicar**, confirmando el nombre exacto de la base:

   ```powershell
   node scripts/repair-stock-drift.js --apply --confirm=<DB_NAME> --out=repair-applied.json
   ```

   Si el servidor corre con `NODE_ENV=development` contra un host remoto, además
   hace falta `ALLOW_REMOTE_DB=true` (guarda deliberada).
6. Volvé a correr el diagnóstico: las clases A y B deben quedar en 0.
7. Recomendado: un conteo cíclico de los productos con anomalías.
8. Recién después se puede publicar la migración 047 (CHECK de inventario, Ola B I8).

## Verificación hecha en QA

- `npm run qa:integration`: 10/10 contra MySQL 8 (clases A con y sin asignaciones,
  B, C, idempotencia y anomalía).
- Corrida de los CLI en `wsm_qa`: diagnóstico, simulación, `--confirm` erróneo
  rechazado (exit 2), anomalías con exit 1 sin cambios.
