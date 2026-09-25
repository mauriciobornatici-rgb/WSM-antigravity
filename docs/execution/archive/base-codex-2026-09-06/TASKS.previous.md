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

- Bloque P5 (Completado):
  - Autosuficiencia y Auto-Runner de Smoke Tests:
    - Creado `packages/server/scripts/smoke-runner-helper.js`: auto-detección de servidor y auto-spawn de servidor efímero en puerto dinámico con limpieza automática de sockets y pool.
    - Actualizados `rbac-validation-smoke.js` e `integrity-validation-smoke.js` para ejecución autónoma sin requerir terminal secundaria.
  - Resiliencia de Datos & Backup Nativo (Gate 2):
    - Creado `packages/server/scripts/backup-database.js`: herramienta nativa en Node.js puro para dump y restore de 62 tablas relacionales con compresión gzip y checksum SHA-256.
    - Verificado dump exitoso (332.7 KB SQL, comprimido a 61.6 KB, 1024 filas en 6.1s).
    - Excluido directorio `backups/` y `*.sql.gz` de git en `.gitignore`.
    - Registrados scripts `npm run db:backup` y `npm run db:restore`.
  - Operación Controlada E2E (Gate 5):
    - Creado `packages/server/scripts/commercial-lifecycle-smoke.js` (`npm run smoke:commercial`).
    - Validación completa de 8 etapas comerciales y logísticas: verificación de salud \(\to\) login multi-rol \(\to\) clientes \(\to\) selección de producto con stock disponible \(\to\) creación de pedido con reservas atómicas en `order_item_allocations` \(\to\) verificación de summary \(\to\) transición a picking \(\to\) confirmación de pick \(\to\) empaquetado (`packed`) con deducción física de stock \(\to\) despacho con tracking y método de envío \(\to\) entrega confirmada \(\to\) emisión de factura comercial.
  - Gate Determinista Completo:
    - `npm run preflight:staging` superado al 100% en un solo comando: validación determinista + integridad referencial + smoke RBAC + smoke de integridad + smoke de ciclo comercial E2E.
- Hotfix POS Checkout (Completado):
  - Solucionada discrepancia de asignación de pagos en checkout de Punto de Venta (`/pos`):
    - Soporte de `unit_price` y `vat_rate` en `createOrderSchema` (`@wsm/common`).
    - Cálculo de total neto y total con IVA en `CreateOrderUseCase.js` con conciliación exacta para pagos divididos.
    - Envío de `total_amount`, precios unitarios e IVA en `POS.tsx` y `offlineSalesQueue.ts`.
    - Cobertura de tests ampliada a 385 tests en backend y 52 tests en cliente.
    - Verificación E2E en servidor en vivo: venta y facturación autorizada con pago total ejecutada con éxito (HTTP 200).
  - Mejora de UX y Conciliación en Crear Pedido (`/orders` - `CreateOrderDialog.tsx`):
    - Visualizador de suma total de productos en cabecera y pie de lista con detalle de unidades y cantidad de ítems.
    - Monitor dinámico en tiempo real de medios de pago ("Falta asignar: $X") con botones de asignación rápida.
    - Bloqueo preventivo del botón "Crear" hasta que el balance de pagos pendientes alcance exactamente $0.
    - Cobertura de tests ampliada a 57 tests en cliente (`createOrderBalance.test.ts`).

  - Retiro y Cobro de Pedidos en Mostrador desde el POS (BOPIS / Pickup):
    - Integración unificada del flujo de entrega y cobranza de pedidos preparados en `/pos`.
    - Caso de uso transaccional `PickupOrderCheckoutUseCase.js` con control de stock físico para ítems extra, entrega formal (`delivered`), facturación fiscal y registro de pagos en el turno de caja activo (`shift_payments`).
    - Exposición de endpoint `POST /api/orders/:id/pickup-checkout` protegido con `canSell`.
    - Diálogo modal `POSPickupOrdersDialog.tsx` con listado reactivo y buscador de pedidos preparados.
    - Botón `[📦 Retiro Mostrador (X)]` con contador dinámico en `POSHeader.tsx`.
    - Banner de retiro de pedido y badges visuales `Preparado` vs `Mostrador (+)` en `CartPanelCard.tsx`.
    - Soporte completo para cobro, cross-selling de mostrador e impresión de ticket/factura con CAE en `POS.tsx`.
    - Cobertura de tests ampliada a 390 tests en backend y 60 tests en cliente.

  - Detalle de Venta en Facturas/Tickets y Márgenes Laterales del Ticket Térmico:
    - Retorno íntegro de comprobantes con datos de cliente e `items` persistidos en `createInvoice` y `createManualInvoice`.
    - Nuevo método `salesService.getInvoiceById` y endpoint `GET /api/invoices/:id` protegido con `canInvoice`.
    - Preservación de ítems en `PickupOrderCheckoutUseCase.js` e `InvoiceAuthorizationUseCase.js`.
    - En `@media print`, `#printable-ticket` separado de `#printable-invoice` con dimensiones térmicas estándar (`width: 80mm !important; max-width: 80mm !important; margin: 0 auto !important; padding: 4mm 6mm !important; box-sizing: border-box !important;`).
    - Tabla de productos en `PrintableThermalTicket.tsx` y `InvoiceDocument.tsx` formateada mostrando descripción, SKU, cantidad (`X un.`), precio unitario y total de línea.
    - `handlePrint` en `POS.tsx` convertido a asincrónico con consulta preventiva a `api.getInvoiceItems(invoice.id)` si los ítems vinieran ausentes antes de invocar `window.print()`.
    - Cobertura ampliada a 392 tests en backend y 60 tests en cliente.

  - Rediseño de Tarjetas de Picking y Optimización de Recorrido WMS (Completado):
    - Tarjetas de selección en `PickingOrdersTable.tsx`: nombre de cliente como título principal, código secundario `#ID` en tamaño reducido, fecha requerida/preparación (`estimated_delivery` o `created_at`) con orden ascendente cronológico (más urgentes primero) y badge de urgencia si es hoy o está vencido.
    - Badges de método de entrega ("Retiro en mostrador" / "Envío a domicilio"), métricas de ítems/unidades, barra de progreso y buscador reactivo.
    - Cabecera en `PickingHeader.tsx`: nombre de cliente como título principal, metadatos secundarios y selector de ruta predeterminado en "Zona A → Z (Ruta estándar)".
    - Optimización de recorrido WMS en `pickingUtils.ts`: ordenamiento natural alfanumérico numérico (`localeCompare` con `numeric: true`) y ubicación de ítems genéricos ("General", "Sin ubicación", vacíos) al final de la ruta.
    - Grilla de ítems en `PickingItemsGrid.tsx`: badge de secuencia de parada (`Parada #1`, `Parada #2`), ubicación física destacada con ícono `MapPin` y botón de recolección interactivo `[Recolectar ítem]`.
    - Cobertura ampliada a 61 tests en Vitest (`pickingUtils.test.ts` con 6 tests específicos de ruta WMS).

  - Selección Ágil de Variantes en POS (Opción A + Opción B) (Completado):
    - Opción A (Modal Persistente): El diálogo de variantes no se cierra al agregar un ítem; exhibe columna/badge reactivo en tiempo real `En Carrito: X`, botón adaptativo `Agregar` / `Sumar (+1)`, contador acumulado en el título y botón explícito `[✓ Listo / Volver al catálogo]` para cerrar únicamente a demanda.
    - Opción B (Expansión Inline en Lista): En la vista de tabla/lista, los productos con múltiples variantes pueden desplegarse inline tipo acordeón directamente debajo del producto, mostrando sub-tarjetas compactas con stock, SKU, badge de carrito y botón rápido `[+ Agregar]` / `[Sumar]` sin abrir modales.
    - Vista de tarjetas (Grid): Se añadió indicador de unidades acumuladas en el carrito para productos con variantes.
    - Paso reactivo de `cart` desde `POS.tsx` a `ProductCatalogCard.tsx`.
    - Validación completa: 61 tests en Vitest pasando, 0 linter warnings, typecheck limpio, `validate` e `integrity` en verde.

  - Aislamiento Estricto de Impresión en Comprobantes de Venta (Completado):
    - Corrección del defecto donde el diálogo "Venta Registrada con Éxito" y su fondo oscurecido (`DialogOverlay` con `bg-black/80`) se superponían en la vista previa del ticket térmico y factura A4 al imprimir desde el POS.
    - Inclusión de regla radical en `@media print` de `index.css`: `body > *:not(#print-portal) { display: none !important; }`, suprimiendo cualquier portal de Radix UI inyectado fuera de `#root`.
    - Eliminación de teñido de papel: `[data-state="open"]` con `background: transparent !important`.
    - Aplicación de `print:hidden` a las primitivas base `DialogOverlay` y `DialogContent` en `dialog.tsx` y en `CheckoutSuccessDialog.tsx`.
    - Desacople de impresión en `CurrentAccountsPrintStatement.tsx`, `ZReportDialog.tsx` y `PrintableBarcodeLabelsDialog.tsx` mediante `PrintPortal`.
    - Validación determinista completa: 61 tests Vitest pasando, 0 errores ESLint, `tsc -b` limpio, `npm run validate` (exit 0) y `npm run preflight:integrity` (exit 0).

## Hallazgos y Datos Relevantes
- La contingencia offline del POS ahora está respaldada contra fallas de almacenamiento o pérdida de sesión mediante IndexedDB.
- La guía de homologación contiene los comandos exactos de OpenSSL, WSASS, puntos de venta y credenciales de Tiendanube.
- El preflight de variables previene arranques inválidos en staging/producción (rechaza orígenes locales, exige HTTPS, JWT >= 32 caracteres y DB_SSL).
- El sistema cuenta con trazabilidad por request ID extremo a extremo en todas las peticiones HTTP.
- Los smoke tests ahora son autosuficientes y pueden ejecutarse directamente en CI/CD sin procesos manuales en segundo plano.
- El ciclo de ventas y logística WMS opera de forma completamente auditada y predecible de extremo a extremo.
- El Punto de Venta concilia tanto importes brutos con IVA como netos gravados sin desajustes de centavos.
- El modal de Crear Pedido garantiza integridad financiera impidiendo la creación de pedidos con diferencias o faltantes de pago.
- El flujo de Retiro de Pedidos en Mostrador (BOPIS) unifica almacén y caja, permitiendo cross-selling en el mostrador sin discrepancias de stock.
- Los comprobantes comerciales y fiscales emitidos o reimpresos desde el POS siempre presentan el detalle exhaustivo de productos, cantidades, precios unitarios y totales, con márgenes simétricos para impresión térmica de 80mm.
- El aislamiento de impresión mediante `#print-portal` previene la aparición de pantallas de fondo del POS, elimina la duplicación de modales en múltiples páginas e impide impresiones en blanco en el módulo de Facturación.
- La interfaz de picking ahora está optimizada para la ergonomía del operario de depósito, ordenando las órdenes por fecha requerida y guiando el recorrido por estanterías en orden físico ascendente (Zona A a Z) con paradas secuenciales.
- La selección de variantes en el Punto de Venta es ahora multimodal: el cajero puede expandir variantes directamente en la lista para cargas ultra-rápidas o usar el modal persistente sin perder el contexto ni sufrir cierres intempestivos al elegir múltiples talles.
- El sistema de impresión aísla de forma determinista el comprobante a imprimir: ni los modales de éxito, ni los backdrops translúcidos de Radix, ni la interfaz de la SPA interfieren en la salida del ticket o la factura.

## Siguientes Acciones
1. Invitar al usuario a probar la impresión de ticket y factura tras una venta para confirmar la limpieza visual total (solo se ve el ticket o factura en papel/vista previa).
2. Invitar al usuario a probar la selección ágil de variantes en `/pos`.
3. Probar el nuevo módulo de Picking (`/picking`) y su recorrido ordenado por estanterías.
4. Ejecutar las pruebas de homologación siguiendo `GUIA_HOMOLOGACION_ARCA_Y_TIENDANUBE.pdf` cuando el usuario disponga de los certificados y claves de prueba en AFIP (WSASS) y Tiendanube Partners.
5. Despliegue en entorno de preproducción / staging utilizando `docker-compose.staging.yml`.

## Bloqueos o Aprobaciones Requeridas
- Carga de certificados de testing por parte del usuario para iniciar las pruebas de red con AFIP / Tiendanube.

## Último Checkpoint
- **Fecha/Hora:** 2026-09-05T01:23 (Aislamiento Estricto de Impresión en Comprobantes de Venta)
- **Archivos Modificados/Creados:** `index.css`, `dialog.tsx`, `CheckoutSuccessDialog.tsx`, `CurrentAccountsPrintStatement.tsx`, `ZReportDialog.tsx`, `PrintableBarcodeLabelsDialog.tsx`, `STATE.md`, `TASKS.md`, `walkthrough.md`.
- **Chequeos Ejecutados:** `npm -w @wsm/client run test` (61 tests exit 0), `npm -w @wsm/client run lint` (exit 0), `npm -w @wsm/client run typecheck` (exit 0), `npm run validate` (exit 0 - 392 backend + 61 frontend Vitest + lint + typecheck + build Vite), `npm run preflight:integrity` (exit 0 - 40 relaciones sin huérfanos).
