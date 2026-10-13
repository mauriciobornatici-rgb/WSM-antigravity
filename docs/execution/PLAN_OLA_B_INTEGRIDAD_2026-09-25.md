# Plan Ola B — integridad de stock y dinero (2026-09-25)

Autor: agente `planificador` (Opus). Revisado y aprobado por el coordinador.
Decisiones de negocio: ADR-008 en `.agents/context/DECISIONS.md` (precios netos).

## Incrementos

| # | Qué | Estado |
|---|---|---|
| I1 | Venta POS de mostrador descuenta stock + movimiento `sale` en `CreateOrderUseCase` (locks ordenados, UPDATE condicional). Nuevo `domains/inventory/StockLedger.js`. | hecho (`0f62d53`) |
| I2 | Harness de integración MySQL real: `packages/server/integration/*.integration.js`, modo `integration` en `qa-runner`, `npm run qa:integration`. | hecho (29 tests MySQL) |
| I3 | `common/src/pricing.ts` (neto + IVA, redondeo por línea) usado por cliente, servidor y ARCA; permiso `ORDERS_PRICE_OVERRIDE` (admin, manager) con auditoría. | hecho (`405373b`; pricing unificado sin archivo común aparte) |
| I4 | `POST /api/pos/checkout` atómico (pedido + stock + factura + pagos de caja, idempotente, reanuda estados legados); POS y cola offline usan una sola llamada; `addShiftPayment` 409 si el replay difiere. | hecho (`ba8391e`) |
| I5 | `OrderStatusService` único; sin `GREATEST(…,0)`; pagos/facturas no saltan estados; Tiendanube vía servicio; devoluciones a proveedor respetan reservas. | hecho (`d925dfa` + correcciones de auditoría) |
| I6 | Resto H4 (factura manual, devoluciones), H3 (lock NC), H5 (recepción no asienta), M8 (transferencia no borra), `beginTransaction` dentro de `try`. | hecho (`d221b12`, `ba8391e`) |
| I7 | `scripts/diagnose-stock-drift.js` (READ ONLY) y `repair-stock-drift.js` (dry-run por defecto, `--apply --confirm=<DB>`), clases A/B/C. | hecho (`fd18df2` + refuerzos de auditoría) |
| I8 | Migración 060 CHECK de inventario con precondición; se publica solo después de reparar prod. | pendiente (AP2) |

H2 (numeración ARCA / recuperación de CAE) queda para una fase con homologación.

## Criterios de aceptación clave

1. Venta POS: baja `quantity`, no toca `reserved_quantity`, movimientos `sale` = cantidad vendida, pedido `completed`.
2. Replay con la misma `idempotency_key` no duplica stock, factura ni pago.
3. 10 checkouts concurrentes de 1 unidad sobre stock 5 → 5 OK + 5 × 409; sin deadlocks con carritos cruzados.
4. Sin clamps silenciosos; con 045, un negativo falla con error 3819.
5. Precio distinto al de catálogo sin permiso → 403; con permiso → auditado.
6. Neto/IVA idénticos en cliente, servidor y ARCA.
7. Recepción no asienta; factura de proveedor asienta una vez.
8. Dos autorizaciones de NC en paralelo → una llamada a ARCA.
9. Diagnóstico no escribe; reparación idempotente y en dry-run por defecto.
10. `npm run validate` verde; archivos nuevos ≥90 % de cobertura.

## Puntos de aprobación pendientes

- AP2: migración 060 solo tras correr la reparación en producción y preflight limpio.
- AP3: el usuario revisa el dry-run de producción (clases B y C) antes de `--apply`.
