# Simulación operativa de punta a punta — 2026-10-12

Script: `packages/server/scripts/simulation/simulacion-operativa.mjs` (reutilizable).
Corre contra la API local (`localhost:3001`) y la base Docker local. Opera como un usuario
real (login con cookie y origen del frontend) y, **después de cada paso**, compara lo
esperado con la base: stock por producto y ubicación, reservas, saldos, caja y asientos.
Sin Tiendanube ni ARCA: no llama a los endpoints de autorización.

Resultado final (corrida `20261012135501`): **109 de 109 controles OK, 0 pasos fallidos.**

## Recorrido y resultados

| # | Operación | Qué se verificó | Resultado |
|---|---|---|---|
| 1 | Alta de proveedor, 2 clientes, 3 productos, 2 ubicaciones | Stock inicial 0; CUIT de proveedor duplicado rechazado | OK |
| 2 | OC 10 zapatillas, 20 pelotas, 5 remeras (neto 440.000 + IVA = 532.400) | Total correcto; enviar la OC no mueve stock | OK |
| 3 | Recepción parcial: 8 zapatillas + 20 pelotas; QC con 2 pelotas defectuosas | Pendiente de QC no suma stock; anular la OC con mercadería en QC → 409; aprobada: +8, +18 al depósito y +2 a Cuarentena; OC parcial | OK |
| 4 | Segunda recepción: 2 zapatillas + 5 remeras | OC recibida; no se puede reabrir (409); recepción extra sobre OC cerrada → 409 | OK |
| 5 | Factura de proveedor 532.400 y pago de 200.000 | Saldo 0 → 532.400 → 332.400; factura duplicada → 409 | OK |
| 6 | Devolución al proveedor de las 2 pelotas defectuosas | −2 de Cuarentena; saldo −12.100 (neto + IVA) → 320.300 | OK |
| 7 | Transferencias Depósito → Salón; conteo cíclico ciego con 1 zapatilla faltante | Totales intactos al transferir; transferir sin stock → 409; el conteo no toca stock hasta ajustar; el ajuste resta 1 | OK |
| 8–9 | Caja: apertura 20.000; venta POS 1 zapatilla + 2 pelotas (84.700: 60.500 efectivo + 24.200 débito) | Descuenta 3 unidades con movimiento; la caja suma solo el efectivo; el reintento no duplica; factura B local; venta sin stock → 409 sin cambios | OK |
| 10 | Pedido con envío a cta cte: reserva → picking → preparado → despacho (con tracking) → entrega | Reserva sin tocar el físico; al preparar descuenta 5 y libera reservas; despacho/entrega no descuentan de nuevo; trazabilidad completa | OK |
| 11 | Factura A 175.450 y cobro de 100.000 por transferencia | Cta cte 175.450 → 75.450; aparece en cobranzas pendientes | OK |
| 12 | Devolución de cliente: 1 pelota vendible + 1 dañada | Vendible +1 al stock; dañada registrada como merma; NC 24.200 al precio vendido; devolver de más → rechazado | OK (tras corrección D1) |
| 13 | Reintegro 12.100 y gasto 3.000 en caja; NC manual 5.450 repetida | Caja baja lo justo; la NC repetida no se duplica; cta cte 70.000 | OK |
| 14 | Garantía: recibida → en curso → enviada a proveedor → aprobada → resuelta (reemplazo) | Estados y auditoría | OK (tras corrección D2) |
| 15 | Pedido cancelado | Reserva liberada; cta cte sin cambios | OK |
| 16 | Retiro en mostrador cobrado en caja (18.150) | −1 remera; caja +18.150 | OK |
| 17 | Cierre de caja | Esperado 83.550 = 20.000 + 60.500 − 12.100 − 3.000 + 18.150; diferencia 0 | OK |
| 18 | Contabilidad e inventario global | Ningún asiento desbalanceado; debe = haber; kardex = stock en los 3 productos; sin negativos ni sobre-reservas | OK |

Stock final: zapatilla 6 (3 depósito + 3 salón), pelota 17 (8 + 8 + 1 reingresada),
remera 1. Coincide con 10 − 1 − 1 − 2 = 6, 20 − 2 − 2 + 1 = 17 y 5 − 3 − 1 = 1.

## Defectos encontrados y corregidos en esta sesión

- **D1 (alta).** Aprobar una devolución de un cliente registrado daba **siempre 500**: leía
  `clients.tax_condition_id`, una columna que no existe. Ahora la letra de la NC sale de la
  factura original (A → A, C → C; si no hay factura, B). Test de integración nuevo (MySQL).
- **D2 (alta).** Cambiar el estado de una garantía desde la pantalla daba **siempre 500**:
  enviaba `notes`, que no es columna de la tabla. Ahora se guarda como `resolution_notes`,
  devuelve 404 si la garantía no existe y deja auditoría (antes no había).
- **D3 (media).** Una transferencia sin stock suficiente se rechazaba con un 500 genérico. Ahora
  responde 409 con el motivo (disponible, físico y reservado).

## Hallazgos pendientes de decisión (no corregidos)

La contabilidad de compras, ventas, costo, cobros, devoluciones y NC por devolución es
correcta y está balanceada. Pero algunas operaciones **no generan asiento**, así que el
mayor contable no coincide con las cuentas corrientes ni con la caja:

| ID | Operación | Hoy | Asiento propuesto |
|---|---|---|---|
| C1 | Pago a proveedor desde "Proveedores" (`/supplier-payments`) | Baja el saldo, sin asiento. El pago masivo de "Pagos a proveedores" sí asienta | Proveedores / Banco o Caja |
| C2 | NC manual (bonificación) | Baja la cta cte, sin asiento | Ventas (o Descuentos) + IVA DF / Deudores |
| C3 | Ajuste de stock por conteo | Mueve stock, sin asiento | Pérdida por faltantes (5.1.02.02) / Inventario, al costo |
| C4 | Reintegros y gastos de caja | Mueven la caja, sin asiento | Deudores o Gastos generales / Caja |
| C5 | Cobro con tarjeta/QR | Se asienta en "Caja Principal" | Cuenta "Tarjetas a cobrar" o Banco (la caja física no lo incluye) |
| C6 | Devolución de cliente con reingreso | Revierte venta e IVA, no revierte el costo | Inventario / CMV por lo reingresado; Pérdida por la merma |

Otros puntos de uso:
- **U1.** La garantía resuelta con reemplazo no mueve stock: no descuenta la unidad entregada ni registra la defectuosa recibida.
- **U2.** La devolución vendible reingresa en la ubicación "General", no en la de origen.
- **U3.** El POS tomó la zapatilla del depósito aunque había en el salón. No hay prioridad de ubicación para venta de mostrador.
