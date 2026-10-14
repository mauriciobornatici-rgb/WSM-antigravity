# Estado de ejecución — WSM SportsERP

Última revisión: 2026-10-12.
Continuidad actual: [.agents/context/TASKS.md](../../.agents/context/TASKS.md).

## Hito: gates completos y refactor del servidor (2026-10-12)

PR #1 (`codex/hardening-100`) con CI verde: npm audit 0, devolución a proveedor que espeja
la compra (ADR-011), cobertura backend 99 / 91 / 99 % (gate 90 % en CI), ESLint del
servidor, E2E de checkout POS. PR #2 (`codex/sql-out-of-controllers`): SQL fuera de los
controladores (125 → 0), errores de negocio unificados, OC solo avanza y NC manual
idempotente (ADR-012, migración 045). Evidencia: validate (810 + 69), 52 tests contra MySQL real.

## Hito: endurecimiento con capa Claude (2026-09-25/26)

Capa `.claude/` adaptada de Base Claude (8 agentes con modelo por riesgo, hooks, skills).
Auditorías independientes encontraron y se corrigieron, entre otros: ventas POS que nunca
descontaban stock (C1), integración Tiendanube entrante rota (401), comprobantes ARCA
declarando ~17 % menos de lo cobrado, compras asentadas dos veces, precio e IVA tomados
del cliente, checkout POS no atómico. Decisiones del usuario: ADR-008 y ADR-010.
Evidencia: `validate` verde, 476 unitarios, 40 tests contra MySQL real (`qa:integration`).
Pendiente del usuario en producción: runbooks de reparación de stock y de asientos
duplicados, rotar la contraseña admin si se usó `Password123!`, luego migración 062 (CHECK de inventario).
Detalle: [AUDIT](../../.agents/context/AUDIT.md), [plan Ola B](PLAN_OLA_B_INTEGRIDAD_2026-09-25.md).

## Hito: adaptación de Base Codex y correcciones de QA

Se analizó la estructura del ERP, se adaptó la plantilla al contexto canónico
existente y se preservó el historial. Ver [informe](ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md).

La continuación autorizada corrigió retiro mostrador, aislamiento de pruebas,
compatibilidad del ejecutor MySQL y pruebas de caja/autenticación.
Implementadores: Luna max; planificación y revisión personal del coordinador.
Ver [cambios y evidencia](MEJORAS_QA_2026-09-06.md).

Validación: exit 0 (7 guards + 431 backend + 62 cliente); lint sin warnings.
MySQL QA: 42 migraciones desde cero y bootstrap repetido correctos.
Integridad SELECT: exit 0 (40 relaciones); RBAC 12/12; E2E 2/2 con API simulada.
Cobertura: falla el gate de 90 %; 81,23 / 88,82 / 73,98 %.
Los circuitos opcionales de recepción/caja y la operación real siguen pendientes.

No hay una puntuación global de calidad ni aprobación de producción.
Los resultados y límites vigentes están en [AUDIT](../../.agents/context/AUDIT.md).
La próxima prioridad es cerrar cobertura por dominio y ampliar la evidencia operativa.

## Historial conservado

- [Estado íntegro anterior, hasta 2026-09-05](archive/base-codex-2026-09-06/STATE.previous.md).
- [Tareas previas y pendientes operativos](archive/base-codex-2026-09-06/TASKS.previous.md).
- [Bitácora integral](BITACORA_INTEGRAL.md).
- [Plan funcional](MASTER_PLAN.md).
- [Gates de preproducción/producción](PRODUCTION_READINESS_2026-08-20.md).

Las cifras de documentos históricos corresponden a sus fechas; no sustituyen
las verificaciones actuales.
