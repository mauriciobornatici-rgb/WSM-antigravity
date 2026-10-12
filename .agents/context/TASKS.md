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

## Próximos pasos

- [x] ESLint del servidor (`packages/server/eslint.config.js`): 29 problemas → 0; en `npm run lint`, `validate` y CI. Ningún hallazgo era bug (imports/variables sobrantes).

1. Confirmar CI verde del PR #1 tras el push.
2. Sacar SQL de controladores por dominio (169 consultas; con la red de tests ya puesta).
3. Usuario: correr los runbooks en producción tras el merge.
2. I8: migración 045 (CHECK de inventario) — solo después de que el usuario corra la reparación en producción (AP2). Runbooks: `docs/execution/RUNBOOK_REPARACION_STOCK_C1.md`, `RUNBOOK_ASIENTOS_COMPRA_DUPLICADOS.md`.
3. Fase H2 (numeración ARCA, recuperación de CAE y de NC en `authorizing`), ESLint del servidor, E2E de checkout.

## Límites

Sin mutaciones en la DB remota (`.env` apunta a producción). Migraciones nuevas solo en
QA (`wsm_qa` 127.0.0.1:33308, `docker compose -f docker-compose.test.yml up -d`). Sin push
ni despliegue. Flaky conocido: `health-and-correlation.test.js` bajo carga.
Verificación: `npm run validate`, `npm run qa:integration`, `node scripts/qa-runner.js coverage`.
