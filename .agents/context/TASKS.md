# Tarea actual — WSM SportsERP

## Objetivo

Endurecer la app (seguridad, confiabilidad, mantenibilidad, UX) con la capa Claude
adaptada de `C:\Dev\Base claude` (ADR-007; la plantilla fuente también se mejoró a
v2.1 por pedido del usuario). Decisiones de negocio en ADR-008 (precios de catálogo NETOS).

## Hecho — 2026-09-25 (rama codex/hardening-100, sin push)

- [x] `4221d26` línea base · `b201f2e` Ola A (seguridad, a11y, Node 24, capa `.claude/`) · `f51fe90` ErrorBoundary por ruta.
- [x] `0f62d53` C1: venta POS de mostrador descuenta stock + movimiento (`domains/inventory/StockLedger.js`).
- [x] `fd18df2` scripts `diagnose-stock-drift` / `repair-stock-drift` + runbook `docs/execution/RUNBOOK_REPARACION_STOCK_C1.md`.
- [x] `d221b12` NC con toma atómica, compras asentadas una vez, transferencias sin borrar filas.
- [x] `971626e` ARCA: importes = lo cobrado (antes −17 %), alícuotas, Factura C, apagado ordenado.
- [x] `405373b` permiso `ORDERS_PRICE_OVERRIDE` (admin, manager) + auditoría.
- [x] `d925dfa` transiciones con efecto de stock, sin clamps; Tiendanube vía transiciones.
- [x] `ba8391e` checkout POS atómico `POST /api/pos/checkout`; devoluciones con precio vendido e IVA.
- [x] Auditorías AUD-001 + guardián (ver `AUDIT.md`) → `de9ab70` correcciones + excepciones POS + scripts de asientos duplicados.
- [x] `988572a` venta offline sin stock con faltante auditado · `f8a47df` pantalla Excepciones POS (ADR-010).
- [x] Evidencia: unit 476/476, cliente 69 tests + lint/tipos/build, `qa:integration` 40/40.

- [x] AUD-002 re-auditoría del delta: 5 hallazgos corregidos (ver `AUDIT.md`).

## Sesión 2026-10-12

- [x] `98451fd` npm audit 12 → 0 (proxy-addr crítica, axios, undici); nodemon → `node --watch`.
- [x] `05e149a` devolución a proveedor espeja la compra (ADR-011) · `8967a7e` contador de excepciones POS en el menú.
- [x] CI: `qa:integration` en el job mysql-qa; smoke RBAC con 5 casos de POS/excepciones (17/17).
- [x] Evidencia: unit 477/477, cliente 69, `qa:integration` 44/44, preflight + smokes RBAC/integridad OK.
- [x] Push + PR https://github.com/mauriciobornatici-rgb/WSM-antigravity/pull/1 (vinculado a la sesión). CI: falla solo el job de cobertura (H-02, conocido).
- [x] `8cc348b` / `70ce507` E2E Playwright: checkout POS (1 llamada, rechazo de precio restaura) y Excepciones POS (gerente/cajero). E2E 6/6.

## Ola C — gate de cobertura (hecho)

- [x] `1ff2122` 312 tests nuevos (4 implementadores sonnet, revisados): cobertura backend 99,25 / 91,92 / 98,93 % (antes 81,4 / 89,1 / 74,9). Gate 90 % en verde.
- [x] Hallazgos de los implementadores verificados y corregidos: X-Request-Id antes de parsers/limitador; `status` del error siempre texto; `updateUser` protege al último admin activo y no edita borrados; código muerto en procurementController; supplier_id faltante → 400.
- [x] Descartados con evidencia: NC por $0 (Zod exige `amount` positivo); tipo de movimiento de caja (Zod restringe a income/expense).
- Evidencia: validate 0 (791 + 69), coverage 0, qa:integration 44/44, RBAC 17/17.

## Lint y CI (hecho)

- [x] ESLint del servidor (`packages/server/eslint.config.js`): 29 problemas → 0; en `npm run lint`, `validate` y CI. Ningún hallazgo era bug (imports/variables sobrantes).

- [x] `d39aaed` test del cargador de entorno portable (único fallo del CI Linux; verificado en node:24-alpine).

## En curso — rama `codex/sql-out-of-controllers` (apilada sobre `codex/hardening-100`)

Decisión del coordinador (el usuario delegó la elección): el PR #1 queda congelado para revisión; el refactor va en rama/PR propio que se re-apunta a `main` tras el merge del #1.
- [x] `151c5d1` 125 consultas SQL en 10 controladores → 0 (servicios de dominio), sin cambiar SQL, transacciones, cuerpos ni códigos HTTP. Errores de negocio unificados en `utils/businessError.js` (catchAsync + middleware); se eliminaron 4 helpers locales y 25 try/catch. 791 tests sin editar, lint 0, coverage 99,25/91,82/99,00, integración 44/44, RBAC OK.
- [x] CI del PR #1: **verde completo** (`d39aaed`).
- [x] Revisión independiente (opus): seguridad sin hallazgos explotables; integridad sin regresiones (comparó todos los literales SQL antes/después).
- [x] Endurecimientos aplicados: clase `BusinessError` (solo 4xx propios se responden; nunca cuerpos de librerías), `headersSent`, rollback único e incondicional en `user.service`, Tiendanube con `this.db`; NC manual audita dentro de la transacción; el GET del turno no pisa el saldo de un turno ya cerrado. 5 tests nuevos.
- [x] Evidencia: validate 0 (796 + 69), coverage 99,26/91,78/99,00, qa:integration 44/44, RBAC OK.
- [x] PR #2 abierto (base `codex/hardening-100`; re-apuntar a `main` tras el merge del #1).
- [x] ADR-012 (decisión del usuario): OC solo avanza (`received`/`cancelled` finales, cancelar solo desde `draft`/`sent`; transición con `FOR UPDATE` y 409 `invalid_transition`); NC manual con `idempotency_key` (migración 045, aplicada solo en QA; replay devuelve la NC existente; reintento único ante duplicado/deadlock). Guardián (AUD-003): 5 hallazgos verificados y corregidos (recepción contra OC anulada o recibida; clave de NC reusada → 409; reintentos acotados; no-op sin auditoría). Evidencia: validate 0 (810 + 69), coverage 99,27/91,81/99,01, qa:integration 52/52 ×3, RBAC OK.

- [x] Bajos anotados resueltos (2026-10-13): borrado de proveedor con lock (y factura de compra a proveedor eliminado → 404), renombre de ubicación atómico, 404 de cliente con mensaje, CUIT de proveedor serializado con lock por nombre (sin CUIT no se controla). Remitos facturables solo con control de calidad aprobado.

## Simulación operativa y contabilidad completa — rama `codex/simulacion-operativa` (local, sin push)

- [x] `ec8dfcd` simulación de punta a punta (`packages/server/scripts/simulation/simulacion-operativa.mjs`), D1 devolución con cliente (500), D2 estado de garantía (500), D3 transferencia sin stock (409).
- [x] ADR-013: C1–C6, U1 y U2. La simulación da 116/116 y el mayor concilia con los submayores. El guardián encontró 7 puntos técnicos, todos corregidos. Migración 046 (cuentas) aplicada en la base local y en QA.
- Evidencia: validate 0 (821 + 69), coverage 99,05/91,57/99,03, qa:integration 58/58 ×2, RBAC OK.
- [x] ADR-014 (puntos 1-4 aprobados por el usuario): NC fiscal vinculada a factura, con CbtesAsoc en ARCA (defecto fiscal previo); efectivo a proveedores desde la caja; recorrido de la unidad defectuosa de garantía; acreditación de tarjetas. Migraciones 047 y 048, aplicadas en local y QA; el CHECK de inventario pasa a 051. El guardián encontró 2 altos y varios medios, todos los técnicos corregidos. Simulación 137/137; validate 0 (837 + 69); coverage 98,22/91,08/97,85; integración 65/65 ×3; RBAC y E2E OK.
- Pendiente de decisión del usuario:
  1. IVA de la comisión de tarjeta (¿crédito fiscal aparte?) y retenciones del procesador.
  2. Pagos en efectivo de tesorería fuera de un turno de POS.
  3. Idempotencia del pago a proveedor (doble clic). Ya existía; ahora también movería la caja.
  4. Prioridad de ubicación del POS (U3).
  5. Probar en homologación de ARCA una NC con comprobante asociado antes de producción.

- [x] ADR-015 (pedido del usuario): precios finales con IVA en pantalla y netos de 4 decimales en la base. Incluye:
  - IVA de la comisión de tarjeta como crédito fiscal;
  - Caja 2 (tesorería) con traspasos y pagos a proveedor;
  - idempotencia de pagos y traspasos;
  - el mostrador vende primero del salón y el pedido sale primero del depósito.
  - Migraciones 049 y 050, aplicadas en local y QA.
  - AUD-004: los hallazgos técnicos del guardián y los 13 puntos de UX quedaron corregidos.
  - Evidencia: validate 0 (853 + 77); coverage 98,30/90,88/97,33; integración 69/69 ×3; RBAC OK; E2E 6/6; simulación 147/147.
- Pendiente de decisión del usuario (ADR-015):
  - quién carga el saldo inicial de Caja 2;
  - traspasos sin control de saldo bancario;
  - el gerente no ve Caja 2;
  - IVA de la comisión siempre 21 % (retenciones y monotributo);
  - envío y descuentos de Tiendanube;
  - corrección de datos previos;
  - centavos en devoluciones parciales.

- [x] ADR-016 (decisiones del usuario sobre lo pendiente de ADR-015). Guardián AUD-005: corregido (ver `AUDIT.md`).
  - Saldo inicial de Caja 2 solo para el administrador.
  - Banco con saldo, movimientos y débitos (sueltos o dentro del movimiento).
  - El gerente ve Caja 2.
  - Alícuotas editables, con el IVA asentado por alícuota.
  - Envío y descuentos de Tiendanube en la factura.
  - Migración 052 (totales previos) y script `repair-tiendanube-prices.js`.
  - Devoluciones parciales exactas al centavo.
  - Migraciones 051 y 052 aplicadas en local y QA; el CHECK de inventario pasa a 060.
  - Evidencia: validate 0 (873 + 83); coverage 98,03/90,48/95,97; integración 74/74 en 4 de 5 corridas (en 1 falló completo `purchase-order-lifecycle`, sin aserción: a investigar); RBAC OK; E2E 6/6; simulación 153/153.
- Regla del usuario: todo texto visible de la app va en español.
- [x] ADR-017 (AUD-006 corregido):
  - envío cobrado o absorbido por pedido (IVA 21 %, editable);
  - bonificación del envío en devoluciones;
  - compras con varias alícuotas y de tipo flete o gasto;
  - origen de productos y script de precios sin adivinar;
  - alícuota de producto editable;
  - stock inicial con asiento.
  - Migración 053 aplicada en local y QA; el CHECK de inventario pasa a 060.
  - Evidencia: validate 0 (878 + 84); coverage 96,88/90,17/94,75; integración 81/81 ×3; RBAC OK; E2E 6/6; simulación 153/153.


- [x] ADR-018: stock inicial con costo obligatorio y cuenta de ajuste 3.1.03.01 (migración 055); envío bonificado o editado solo con gerente o administrador; NC anulada libera el envío. Evidencia: validate 0 (881 + 84); coverage 96,88/90,32/94,66; integración 82/82 ×3; RBAC OK; E2E 6/6; simulación 153/153.
- [x] ADR-019 (AUD-007 corregido): varios remitos por factura de compra; stock único con Tiendanube (disponible menos lo que deben los pedidos online, conciliación cada 20 s, completa cada hora, forzada diaria, stock de seguridad opcional por check); pedidos online sin stock registrados y reservados al entrar mercadería. Migraciones 056 y 057; el CHECK de inventario pasa a 060. Evidencia: validate 0 (890 + 87); coverage 96,81/90,29/94,24; integración 88/88 ×3; RBAC OK; E2E 6/6; simulación 153/153.

## Próximos pasos

1. Usuario: revisar y mergear PR #1; después re-apuntar PR #2 a `main`.
2. Usuario: correr en producción los runbooks (`docs/execution/RUNBOOK_REPARACION_STOCK_C1.md`, `RUNBOOK_ASIENTOS_COMPRA_DUPLICADOS.md`) y aplicar la migración 045 con el despliegue.
3. I8: migración 060 (CHECK de inventario) — solo después de la reparación en producción (AP2).
4. [x] Fase H2 (ADR-020, AUD-008): autorización ARCA sin doble CAE ni CAE perdido (número guardado antes de pedir, verificación del número exacto, enfriamiento de 2 min, worker cada 2 min, conflicto terminal), NC con número de ARCA, RG 5616 (condición IVA del receptor). Migraciones 058 y 059; el CHECK de inventario pasa a 060. Evidencia: validate 0 (947 + 91); coverage 96,57/90,67/94,13; integración 104/104 ×3 (14 escenarios ARCA con base real); RBAC OK; E2E 6/6; simulación 153/153. Pendiente del usuario: probar en homologación (NC con CbtesAsoc, Factura/NC C, RG 5616).
5. Riesgos bajos de arriba.

## Límites

Sin mutaciones en la DB remota (`.env` apunta a producción). Migraciones nuevas solo en
QA (`wsm_qa` 127.0.0.1:33308, `docker compose -f docker-compose.test.yml up -d`). Push solo
a las ramas de los PR; sin merge sin aprobación ni despliegue. Flaky conocido: `health-and-correlation.test.js` bajo carga.
Verificación: `npm run validate`, `npm run qa:integration`, `node scripts/qa-runner.js coverage`.
