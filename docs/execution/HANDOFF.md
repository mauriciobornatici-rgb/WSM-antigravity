# Handoff rápido

Última revisión: 2026-08-20

Rama: `codex/hardening-100`

Estado: código local 100/100; listo para preproducción, todavía no autorizado para producción.

## Fuente vigente

1. `docs/execution/STATE.md`
2. `docs/execution/PRODUCTION_READINESS_2026-08-20.md`
3. `docs/TIENDANUBE_OPERATIONS.md`
4. `docs/execution/HARDENING_100_2026-08-19.md`

Los snapshots antiguos dentro de `STATE.md` son históricos; sus pendientes no prevalecen sobre las secciones del 20 de agosto.

## Cerrado en código

- Centro `Tienda online` con catálogo, pedidos, envíos, clientes, sincronización, análisis y configuración Tiendanube. Configuración general ya no contiene funciones Tiendanube.
- Seguridad de sesión, RBAC compartido, secretos redactados, contabilidad/auditoría inmutables, operaciones críticas transaccionales e integridad referencial.
- POS idempotente, picking/despacho, compras, recepciones, devoluciones, caja, cuentas corrientes y trazabilidad.
- Recepción protegida por QC obligatorio en backend; stock aprobado y cuarentena se actualizan una sola vez.
- Acción simulada de email de facturas retirada de la UI hasta disponer de integración real.
- CI con cobertura backend, lint, TypeScript, frontend tests/build, Chromium E2E y auditoría de dependencias.

## Última evidencia

- Backend 118/118 y cobertura 61,64% líneas / 55,61% ramas / 68,17% funciones.
- Frontend 42/42, lint/typecheck/build verdes.
- RBAC 12/12 e integridad HTTP 4/4.
- Preflight DB: 20/20 relaciones, cero huérfanos.
- Recepción QA completa y bajas lógicas QA aprobadas.
- Caja operativa omitida por no existir turno abierto; debe ejecutarse en staging.
- Playwright CLI local bloqueado por falta de `npx`; el gate continúa obligatorio en CI.

## Próximo paso exacto

Preparar staging HTTPS y seguir, en orden, `docs/execution/PRODUCTION_READINESS_2026-08-20.md`. Las credenciales ARCA y Tiendanube se cargan recién después de infraestructura, backup/restore, monitoreo, CI y circuitos internos verdes.

Comando canónico, con backend de staging iniciado:

```bash
npm run preflight:staging
```

No usar el `.env` de desarrollo para producción ni declarar go-live sin restauración de backup verificada.
