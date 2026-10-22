# Runbook — transición a la valuación por costo de última compra (ADR-027)

## Qué cambia

Desde ADR-027 la mercadería se valúa al **costo de su última compra**:

- El mayor de **Inventario (1.1.04.01)** es igual al stock valuado al costo de cada producto.
  Mermas no tiene valor.
- El costo de lo vendido se asienta **cuando la mercadería sale** (venta de mostrador, armado
  del pedido), no al facturar.
- La recepción ingresa la mercadería contra **2.1.01.02 "Mercadería recibida a facturar"**, y la
  factura del proveedor salda esa cuenta.
- Un costo nuevo revalúa el stock contra **4.2.02.01 Resultado por tenencia**. Si el producto
  no tenía costo, el revalúo va contra 3.1.03.01.
- ADR-028 (contadora, buenas prácticas, RT 17): lo que corrige ejercicios anteriores va a
  **3.1.02.02 Ajuste de resultados de ejercicios anteriores**, en el patrimonio: el ajuste de la
  transición y el costo de lo vendido de ejercicios cerrados. El del ejercicio en curso va a costo
  de lo vendido.

Los datos cargados antes no cumplen eso. Este runbook los alinea **una sola vez**, al desplegar
la versión con ADR-027.

## Antes de empezar (obligatorio)

1. **Backup** de producción (`npm run db:backup`, revisando el destino), y verificá que se
   puede restaurar.
2. Producción con **MySQL 8.0.16 o posterior**.
3. Corridos los runbooks anteriores, en este orden:
   - `RUNBOOK_REPARACION_STOCK_C1.md`: ventas POS que no descontaron stock;
   - `RUNBOOK_ASIENTOS_COMPRA_DUPLICADOS.md`: compras asentadas dos veces.
   El script se niega a correr si alguno de los dos está pendiente.
4. **Inicio del ejercicio en curso:** la fecha del primer día (por ejemplo 2026-01-01). Lo que
   la transición asienta de ventas anteriores a esa fecha va a 3.1.02.02 (ADR-028). Se pasa con
   `--inicio-ejercicio=AAAA-MM-DD` (hora argentina). Para aplicar es obligatorio; la simulación, sin él,
   toma el 1 de enero del año en curso.
5. Desplegá la versión nueva con la **app detenida para la operación** (ventana de
   mantenimiento) y aplicá las migraciones 064 a 069 **sin arrancar el servidor**:

   ```powershell
   node scripts/run-migrations.js
   ```

   Arrancar el servidor también arranca los procesos automáticos de Tiendanube (pedidos y stock)
   y de ARCA: moverían stock y asentarían en medio de la transición.

## Pasos

Desde `packages/server`, con el entorno de producción:

1. **Diagnóstico** (solo lectura):

   ```powershell
   node scripts/diagnose-inventory-valuation.js --out=valuacion-antes.json
   ```

   Muestra el mayor de Inventario, el stock valuado, la diferencia y los productos con stock y
   sin costo. Conviene cargarles el costo antes de seguir: si no, quedan valuados en 0.

2. **Simulación** (no escribe: hace todo y lo revierte):

   ```powershell
   node scripts/repair-inventory-valuation.js --inicio-ejercicio=AAAA-MM-DD --out=transicion-simulacion.json
   ```

   Conviene correrla sobre **una copia restaurada del backup**: aunque revierte todo, MySQL no
   devuelve los números de asiento que usó, así que en producción deja saltos en la numeración.
   Mientras corre bloquea los productos (por eso la app tiene que estar detenida).

   Revisá el informe:

   | Campo | Qué es |
   |---|---|
   | `costs_from_cost_price` | Productos cuyo costo estaba solo en `cost_price` |
   | `sales_linked_to_invoice_cost` | Ventas cuyo costo ya lo había asentado la factura |
   | `reversed_costs_of_unpacked_orders` | Pedidos facturados y no armados: se revierte ese costo, que se asienta al armarlos |
   | `costs_posted_for_sales` | Ventas que salieron sin costo asentado (no facturadas, o facturadas antes del mayor). Los pedidos anulados no cuentan: su mercadería volvió. `this_year` va a costo de lo vendido; `earlier_years` (ventas anteriores a `--inicio-ejercicio`), a 3.1.02.02 |
   | `opened_goods_to_invoice` | Remitos aprobados y sin facturar: abren 2.1.01.02 |
   | `receptions_invoiced_by_their_order` | **Revisar a mano:** remitos sin factura propia cuya orden de compra tiene una factura que no nombra remitos (antes se facturaba así). No abren 2.1.01.02: su mercadería ya está en el mayor. En pantalla figuran como "facturado con la orden de compra". Si alguno no estaba incluido en esa factura, cargale la suya: el valor del remito va contra 3.1.02.02 (el ajuste de la transición), sin sumar inventario de nuevo, y una diferencia de precio va a 4.2.02.01 (ADR-029) |
   | `opened_with_returns_after` | **Revisar a mano:** remitos abiertos cuyo proveedor se llevó después mercadería de esos productos sin indicar remito. Su factura va a traer menos de lo abierto, y la diferencia bajaría el costo: conviene revisarla al cargarla |
   | `adjustment` | El ajuste final del mayor al stock valuado, contra 3.1.02.02 (ejercicios anteriores) |
   | `after.ok` | Mayor = stock valuado, 2.1.01.02 = pendiente de los remitos y 1.1.06.01 = notas de crédito a recibir de las facturas (ADR-029) |

3. **Aplicar**, confirmando el nombre exacto de la base:

   ```powershell
   node scripts/repair-inventory-valuation.js --apply --confirm=<DB_NAME> --inicio-ejercicio=AAAA-MM-DD --out=transicion-aplicada.json
   ```

   Si el servidor corre con `NODE_ENV=development` contra un host remoto, hace falta además
   `ALLOW_REMOTE_DB=true` (guarda deliberada). Si al final el mayor no coincide, no se confirma
   nada y el comando sale con código 1.

4. **Verificar:**

   ```powershell
   node scripts/diagnose-inventory-valuation.js --out=valuacion-despues.json
   ```

   Tiene que dar `ok: true` (sale con código 0). Una segunda corrida del paso 3 no hace nada:
   queda guardada la fecha de corte (`company_settings.inventory_valuation_since`).

5. Recién después se abre la app a la operación.

## Después

- Cada día (o semana), el diagnóstico tiene que seguir en `ok: true`. Si aparece una diferencia,
  algún camino movió stock sin asiento: `sales_without_entry` muestra las ventas sin costo
  posteriores al corte.
- La migración del CHECK de inventario (070) sigue después de esto (AP2).

## Verificación hecha

- QA: `inventory-valuation-cutover.integration.js` arma estados heredados y corre la transición
  en una transacción que se revierte. Comprueba cada paso, `ok: true` y que la segunda corrida
  no hace nada.
- Simulación sobre `wsm_simulacion`: el ajuste dio 0 (alcanzó con asentar el costo de 2 ventas
  viejas).
- Simulación sobre `wsm_sports_erp`: 70 remitos quedaron para revisar, facturados por la OC.
