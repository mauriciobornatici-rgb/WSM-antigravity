# Plan: valuación de la mercadería por costo de última compra (ADR-027)

Decisión del usuario del 2026-10-17: **opción a, costo de última compra (reposición, RT 17/41)**. El plan lo armó el `planificador` sobre `main` c84b638 y lo ejecuta la rama `feat/revaluacion-stock`.

## Invariantes

1. El mayor de **1.1.04.01** es igual a Σ (cantidad en ubicaciones valuadas × `products.purchase_price`), al centavo. Mermas vale 0 (D3).
2. El saldo de la cuenta puente **2.1.01.02 "Mercadería recibida a facturar"** es igual a Σ (remitos aprobados y no facturados × `unit_cost` del remito, menos lo devuelto).
3. Toda entrada o salida de stock deja su asiento en la misma transacción. Cada movimiento queda vinculado a su asiento (`inventory_movements.journal_entry_id`). El costo se lee bajo lock.
4. Un cambio de costo con stock revalúa contra **4.2.02.01 Resultado por tenencia**, o contra **3.1.03.01** si el costo venía de 0 (D6).

## Decisiones del usuario (2026-10-17)

| # | Decisión | Respuesta |
|---|---|---|
| D1 | De dónde sale el costo nuevo al comprar | Del remito (precio de la OC). Si la factura trae otro total, la diferencia se reparte y el costo se corrige (a2). **Agregado del usuario: dos casillas por producto, marcadas por defecto:** `auto_update_cost` (si se desmarca, el costo queda fijo y la diferencia va a resultado) y `auto_update_price` (si el costo cambia, el precio de venta se recalcula manteniendo el margen; si se desmarca, queda el precio cargado). |
| D2 | Factura de mercadería sin remito | **No se permite** (409 `goods_invoice_requires_reception`). Para compras chicas se hace un remito sin OC. |
| D3 | Pasar a Mermas | Es pérdida en ese momento: Debe 5.1.02.02 / Haber 1.1.04.01. Si vuelve, se recupera. |
| D4 | Contra qué cuenta va el ajuste de la transición | 3.1.02.02 "Ajuste de resultados de ejercicios anteriores" (ADR-028: la contadora pidió las buenas prácticas, RT 17). Antes decía 3.1.03.01. |
| D5 | Quién cambia el costo a mano | Solo administrador y gerente (permiso nuevo). |
| D6 | Costo cargado a un producto con stock y costo 0 | Ajuste de inventario inicial (3.1.03.01), no ganancia. |
| D7 | Devolución al proveedor de algo sin facturar | Se elige el remito; la factura descuenta lo devuelto. Sin remito y sin facturas de ese proveedor: no se permite. |
| D8 | Cuándo se asienta el costo de lo vendido | Cuando la mercadería sale (venta o armado del pedido), no al facturar. |
| D9 | Factura manual sin pedido | No descuenta mercadería ni asienta CMV. |

## Orden único de locks

1. **L1:** cabecera del documento (pedido, remito y OC, devolución, garantía, sesión de conteo, proveedor). Siguen las reglas existentes: Caja 2 antes que el turno, y el turno antes que el pedido.
2. **L2:** filas hijas (ítems, asignaciones, ítems de OC y de conteo con `FOR UPDATE OF item`, clientes).
3. **L3:** `inventory`, todas las filas de los productos del documento, en una sola sentencia `ORDER BY product_id, id FOR UPDATE`.
4. **L4:** `products`, ordenados por id: `FOR SHARE` para leer el costo y `FOR UPDATE` para cambiarlo. Siempre después de L3.
5. **L5:** secuencias, asientos y auditoría. Nunca se toma L3 o L4 después de L5.

Un interbloqueo o una espera agotada responden 409 `busy`.

## Asientos por camino

- **Salidas** (venta de mostrador, extras del retiro, armado, Tiendanube): Debe 5.1.01.01 / Haber 1.1.04.01, cantidad × costo vigente. Faltante offline: Debe 5.1.01.01 / Haber 5.1.02.02.
- **Factura:** solo la venta y el IVA. Asienta CMV únicamente para movimientos `sale` sin asiento (datos anteriores al cambio). Factura manual sin pedido: sin CMV.
- **Cancelación de un pedido armado y devolución de cliente:** reingreso al costo vigente contra 5.1.01.01 al costo de la salida; la diferencia va a 4.2.02.01. Pérdida: 5.1.02.02.
- **Garantía:**
  - ingreso: Debe 1.1.04.01 / Haber 5.1.02.03;
  - baja: al costo vigente;
  - reemplazo: Debe 5.1.02.03 / Haber 1.1.04.01.
- **Conteo:** contra 5.1.02.02 al costo vigente, bajo lock.
- **Transferencia:** sin asiento, salvo hacia o desde Mermas (D3).
- **Recepción:**
  1. revalúa el stock previo al costo del remito, si `auto_update_cost`;
  2. Debe 1.1.04.01 / Haber 2.1.01.02 por la cantidad × `unit_cost`;
  3. con costo fijo, la diferencia entre `unit_cost` y el costo va a 4.2.02.01.
  - `unit_cost` mayor a 0 es obligatorio.
  - `reference_type = 'goods_received'`, nunca `'reception'`: el script de asientos duplicados lo revertiría.
- **Factura de compra con remitos:** Debe 2.1.01.02 por lo pendiente + IVA / Haber Proveedores. La diferencia se reparte y corrige el costo (D1, con la casilla); lo saldado queda en `supplier_invoice_receptions.cleared_amount`.
- **Devolución a proveedor:** Haber 1.1.04.01 al costo en libros. Con remito sin facturar: Debe 2.1.01.02; si no, Debe Proveedores como hoy. La diferencia va a 4.2.02.01.
- **`POST /api/inventory-movements`:** se deshabilita (graba costos libres que contaminan el CMV).

## Incrementos

| # | Qué | Estado |
|---|---|---|
| I1 | Núcleo `domains/inventory/InventoryValuation.js`; migración 065 (cuenta 2.1.01.02, `journal_entry_id`, `inventory_valuation_since`, casillas por producto, permiso de costo); CMV al salir en el mostrador y en los extras del retiro; factura sin CMV duplicado; edición de costo con revaluación y orden L3/L4; casilla de precio; diagnóstico. | hecho (`5aa8a3c`) |
| I2 | Pedidos: CMV al armar, Tiendanube, cancelación, pedido facturado antes del picking, reemisión. | hecho (`8b61dc5`) |
| I3 | Devoluciones de clientes y garantías. | hecho (`cfd9f7e`) |
| I4 | Conteos, transferencias y Mermas, stock inicial, orden de locks de la importación. | hecho (`955d247`) |
| I5 | Compras: recepción con la cuenta puente y revaluación, factura que salda el puente y reparte la diferencia, sin factura de mercadería sin remito; migración 066. | hecho (`a48985e`) |
| I6 | Devoluciones a proveedor vinculadas al remito. | hecho (`aa35319`) |
| I7 | Unificación del costo (`cost_price` como espejo), quitar `productUnitCosts`, deshabilitar movimientos libres, simulación extendida. | hecho (`a360432`) |
| I8 | Script de transición (simulación por defecto, `--apply --confirm=<DB>`), runbook, cierre y revisión (AUD-016). | hecho; revisión AUD-016 corregida (ver `AUDIT.md`) |

El CHECK de inventario pasa a la migración **070** (la 067 y la 068 son de ADR-028; la 069, de ADR-029).
