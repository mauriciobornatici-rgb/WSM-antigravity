# Current Work State — WSM SportsERP

Este archivo refleja el punto de control actual del desarrollo y los siguientes pasos inmediatos.

## Objetivo Activo
Normalización y gobierno del workspace bajo las mejores prácticas de Google Antigravity, garantizando un marco de desarrollo profesional, seguro, verificable y de alto rendimiento de contexto para continuar con los gates de preproducción.

## Criterios de Aceptación Observables
- [x] Reglas de Antigravity (`GEMINI.md` y `AGENTS.md`) desplegadas en la raíz con directivas específicas de WSM.
- [x] Capa de contexto `.agents/context/` activa con comandos reales de validación.
- [x] Plugin de ingeniería `wsm-erp-engineering` normalizado al estándar oficial de Antigravity.
- [x] Verificación determinista (`npm run typecheck` y validaciones) pasando limpiamente.

## Estado Actual
`in_progress`

## Evidencia Completada
- Bloque P0 completado:
  - Vulnerabilidades de dependencias resueltas con `npm audit fix` (0 vulnerabilidades).
  - Árbol de trabajo respaldado en Git (commit `96e7dc3`).
- Bloque P1 completado:
  - Migración `044_harden_order_picking.sql` ejecutada en BD y respaldada por script CLI `run-migrations.js` (`npm -w @wsm/server run migrate`).
  - `CreateOrderUseCase` ahora persiste asignaciones atómicas en `order_item_allocations` vinculando ítem, ubicación de stock y cantidades reservadas.
  - `sales.service.js` actualizado para:
    - Liberar reservas exactas por ubicación desde `order_item_allocations` al cancelar pedidos.
    - Descontar existencias físicas en base a ubicaciones asignadas y registrar mermas/faltantes (`shortage_quantity`) en la transición a `packed`.
    - Registrar eventos de picking con `order_item_id`, `allocation_id` y `picker_id`.
    - Devolver `allocations` en `getOrderSummary`.
  - Frontend (`@wsm/client`): interfaz `OrderItemAllocation` y actualización de contratos DTO en `api.ts`.
  - Seguridad de Secretos (Eje 3): Cifrado simétrico AES-256-GCM verificado y operativo en `utils/crypto.js` para certificados y tokens de integración.
  - Circuito Comercial (Eje 2): Facturación desacoplada de cobranza inmediata y soporte de cobranzas con pagos mixtos/divididos y cheques en `Collections.tsx`.
  - Preflight de Integridad: 40 relaciones validadas sin huérfanos (`preflight:integrity` exit 0).
  - Determinismo Total: `npm run validate` exit 0 (379 tests server, 50 tests client, lint, typecheck y build limpios).

## Hallazgos y Datos Relevantes
- La arquitectura de picking ahora cuenta con trazabilidad a nivel de ubicación física por ítem de pedido.
- Toda la suite de 379 tests en Node.js y 50 tests en Vitest pasa al 100%.

- Bloque P2 (Completado):
  - Descomposición modular de páginas frontend:
    - `Picking.tsx` modularizado en `components/picking/` (`PickingHeader`, `PickingScannerCard`, `PickingItemsGrid`, `PickingOrdersTable`), reduciendo la página principal a 365 líneas.
    - `Collections.tsx` modularizado en `components/collections/` (`CollectionsFiscalSalesCard`, `CollectionsChecksPortfolioCard`, `CollectionsPendingInvoicesCard`, `CollectionsPaymentFormCard`, `types.ts`), reduciendo la página a 295 líneas.
    - `POS.tsx` modularizado extrayendo `components/pos/POSHeader.tsx`.
  - Extracción de casos de uso en el dominio de ventas (`packages/server/domains/sales/`):
    - Creados `DispatchOrderUseCase.js` y `DeliverOrderUseCase.js`.
    - `SalesService` refactorizado para delegar despacho y entrega a casos de uso desacoplados.
  - Validación de Calidad: `npm run validate` (exit 0) y `npm run preflight:integrity` (exit 0).

## Hallazgos y Datos Relevantes
- Las interfaces de usuario de alta densidad (`Picking`, `Collections`, `POS`) ahora tienen responsabilidades separadas y componentes reusables.
- El dominio backend avanza hacia DDD/Clean Architecture preservando 100% de compatibilidad y 379 tests pasando.

- Bloque P3 (Completado):
  - Guía oficial de homologación externa generada en Markdown y compilada a PDF ejecutivo: `docs/execution/GUIA_HOMOLOGACION_ARCA_Y_TIENDANUBE.pdf` (162 KB).
  - Buffer de contingencia offline con IndexedDB (`packages/client/src/lib/offlineIndexedDb.ts`), dual-write y recuperación automática en POS (`restoreOfflineQueueFromIndexedDb`).
  - Suite Vitest ampliada a 52 tests pasando.
  - Validación completa en verde: `npm run validate` (exit 0) y `npm run preflight:integrity` (exit 0).

- Bloque P4 (Completado):
  - Gobernanza y validación de variables de entorno:
    - Creado `.env.example` canónico documentando `development`, `staging` y `production`.
    - Creado `packages/server/scripts/preflight-env.js` y expuesto como `npm run preflight:env` con soporte de flags (`--target`, `--file`).
  - Integración Continua (CI/CD):
    - Workflow de GitHub Actions en `.github/workflows/ci.yml` ejecutando gates deterministas: Node 20 LTS, `preflight:env`, build common, tests backend, lint frontend, typecheck, tests frontend Vitest, build Vite y `npm audit --audit-level=high`.
  - Containerización de Preproducción:
    - Creado `Dockerfile` multi-stage (builder Node 20 + runner liviano Alpine, usuario `node`, healthcheck nativo `/api/live`).
    - Creado `docker-compose.staging.yml` orquestando MySQL 8.0 y aplicación con healthchecks y redes aisladas.
    - Creado `.dockerignore` para optimizar capas y excluir secretos y dependencias locales.
  - Observabilidad y Trazabilidad Avanzada:
    - Middleware de correlation ID: inyección de `X-Request-Id` y `X-Request-ID` (UUID v4), asignación a `req.id`/`req.requestId`, y correlación en logs estructurados JSON.
    - Health Check `/api/health` enriquecido con latencia de DB (`db_latency_ms`), `uptime_seconds`, memoria RSS y Heap (`memory_rss_mb`, `memory_heap_mb`).
    - Fallback SPA compatible con Express 5 para servir el cliente compilado estáticamente desde el backend en contenedores.
    - Suite de pruebas automatizadas `packages/server/test/health-and-correlation.test.js` pasando al 100%.

## Hallazgos y Datos Relevantes
- La contingencia offline del POS ahora está respaldada contra fallas de almacenamiento o pérdida de sesión mediante IndexedDB.
- La guía de homologación contiene los comandos exactos de OpenSSL, WSASS, puntos de venta y credenciales de Tiendanube.
- El preflight de variables previene arranques inválidos en staging/producción (rechaza orígenes locales, exige HTTPS, JWT >= 32 caracteres y DB_SSL).
- El sistema cuenta con trazabilidad por request ID extremo a extremo en todas las peticiones HTTP.

## Siguientes Acciones
1. Ejecutar las pruebas de homologación siguiendo `GUIA_HOMOLOGACION_ARCA_Y_TIENDANUBE.pdf` cuando el usuario disponga de los certificados y claves de prueba en AFIP (WSASS) y Tiendanube Partners.
2. Despliegue en entorno de preproducción / staging utilizando `docker-compose.staging.yml`.

## Bloqueos o Aprobaciones Requeridas
- Carga de certificados de testing por parte del usuario para iniciar las pruebas de red con AFIP / Tiendanube.

## Último Checkpoint
- **Fecha/Hora:** 2026-09-04T18:22 (Hito P4 Completado y Verificado)
- **Archivos Modificados/Creados:** `.env.example`, `.github/workflows/ci.yml`, `Dockerfile`, `docker-compose.staging.yml`, `.dockerignore`, `packages/server/scripts/preflight-env.js`, `packages/server/test/health-and-correlation.test.js`, `packages/server/index.js`, `package.json`, `packages/server/package.json`.
- **Chequeos Ejecutados:** `npm run preflight:env` (exit 0), `npm run validate` (exit 0 - 383 tests backend + 52 tests frontend + lint + typecheck + build Vite), `npm run preflight:integrity` (exit 0 - 40/40 relaciones), `npm run audit` (exit 0 - 0 vulnerabilidades).


