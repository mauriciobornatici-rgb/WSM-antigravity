# Project Charter — WSM SportsERP

## Objetivo
Sistema ERP integral y omnicanal para tiendas de deportes (WSM SportsERP), que centraliza la administración comercial, facturación electrónica (ARCA), gestión de compras, punto de venta (TPV/POS), logística y almacenamiento WMS (con soporte móvil para picking y conteos cíclicos ciegos), contabilidad inmutable por partida doble y sincronización bidireccional con Tiendanube.

## Usuario Principal o Audiencia
- Operadores de sucursal y cajeros (POS/Ventas).
- Personal de depósito y logística (Picking, recepción de mercadería, conteo cíclico móvil).
- Personal administrativo, contable y gerencia (Finanzas, tesorería, compras, reportes de balance).
- Administrador de comercio electrónico (Tiendanube).

## Entregables Principales
1. Frontend SPA React/Vite con TypeScript (`packages/client`).
2. Backend API RESTful Node/Express con JavaScript ESM y MySQL (`packages/server`).
3. Biblioteca de contratos, DTOs y matriz RBAC compartida (`packages/common`).
4. Scripts de migración de base de datos (`packages/server/migrations/`).
5. Suites de pruebas y verificación continua (Unitarias, integración, RBAC smoke, preflight referencial de base de datos).

## Dentro del Alcance (In Scope)
- Monorepo modularizado con npm workspaces.
- Invariantes de inventario WMS: sin stock negativo, reservas transaccionales, auditorías ciegas de stock ABC.
- Contabilidad de partida doble con libro diario inmutable (contra-asientos).
- Matriz RBAC centralizada y autenticación robusta mediante cookies HttpOnly seguras.
- Módulo Tiendanube con webhooks HMAC e idempotencia.
- Control de stock móvil responsive hasta 320 px de ancho.

## Fuera del Alcance Inmediato (Out of Scope)
- Emisión con credenciales de producción de ARCA/AFIP antes de completar ensayos controlados de staging.
- Sincronización masiva con tiendas online externas que no sean Tiendanube en esta etapa.

## Restricciones Técnicas
- Node.js 20+, MySQL 8+.
- Mantener cobertura de pruebas en backend superior al 90% en líneas, ramas y funciones.
- Cobertura de tipos TypeScript al 100% (sin `@ts-ignore` sin justificación explícita).
- Preservar compatibilidad en dispositivos móviles de bodega (ancho mínimo 320 px).

## Definition of Done (DoD)
- [ ] Código tipado sin errores (`npm run typecheck`).
- [ ] Linter limpio sin violaciones (`npm run lint`).
- [ ] Pruebas unitarias e integrales en verde (`npm run validate`).
- [ ] Chequeo de integridad referencial sin huérfanos (`npm run preflight:integrity`).
- [ ] Chequeo de RBAC en verde (`npm run smoke:rbac`).
- [ ] Bitácora de ejecución actualizada en `docs/execution/STATE.md` y `.agents/context/TASKS.md`.

## Fuentes de Autoridad
- `descripcion-sistema-WSM-SportsERP.md`
- `docs/execution/STATE.md`
- `docs/execution/MASTER_PLAN.md`
- `docs/execution/PRODUCTION_READINESS_2026-08-20.md`

## Evidencia actual

Los objetivos de cobertura/tipado anteriores son criterios, no resultados medidos.
El backend actual es JavaScript y no tiene lint/typecheck configurados.
Consultar [QUALITY](QUALITY.md) y [AUDIT](AUDIT.md) para el alcance real y los gates pendientes.
