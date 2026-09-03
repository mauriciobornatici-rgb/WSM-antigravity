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

## Siguientes Acciones (Bloque P2)
1. Descomposición de páginas monolíticas frontend (`POS.tsx`, `Inventory.tsx`, `Picking.tsx`, `Collections.tsx`) en componentes y hooks modulares más testeables.
2. Modularización de servicios backend densos (`sales.service.js`, `tiendanube.service.js`) siguiendo el patrón UseCase ya iniciado con `CreateOrderUseCase`.
3. Preparación de ensayos en entornos externos de homologación (ARCA y sandbox Tiendanube).

## Bloqueos o Aprobaciones Requeridas
- Ninguno.

## Último Checkpoint
- **Fecha/Hora:** 2026-09-03T00:19 (Hito P1 Completado y Verificado)
- **Archivos Modificados:** `sales.service.js`, `CreateOrderUseCase.js`, `initDb.js`, `preflight-referential-integrity.js`, `api.ts`, `types/index.ts`, `STATE.md`.
- **Chequeos Ejecutados:** `npm run validate` (exit 0), `npm run preflight:integrity` (exit 0).


