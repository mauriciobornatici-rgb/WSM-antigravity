# Tarea actual — WSM SportsERP

## Objetivo y estado

Continuación autorizada del análisis y adaptación de Base Codex: corregir retiro
mostrador y preparar QA reproducible. El coordinador leyó, planificó y revisó
personalmente; dos implementadores Luna con esfuerzo max ejecutaron los cambios.

- [x] Plantilla adaptada y diagnóstico conservados.
- [x] Retiro pickup validado bajo bloqueo, turno abierto, respuesta antes de commit.
- [x] Tests de retiro, caja, autenticación y cliente HTTP; warning del POS corregido.
- [x] Comandos backend aislados por defecto y CI con cobertura, E2E y MySQL.
- [x] MySQL QA desde cero y bootstrap repetido; 42 SQL históricos preservados.
- [x] Revisión personal, feedback y verificaciones finales documentados.
- [ ] Alcanzar 90 % de cobertura en líneas, ramas y funciones.
- [ ] Demostrar circuitos operativos completos y CI remoto.

## Evidencia actual — 2026-09-06

validate exit 0: 7 guards + 431 backend + 62 frontend; lint sin warnings, tipos y build.
Cobertura exit 1: 81,23 % líneas / 88,82 % ramas / 73,98 % funciones.
Preflight QA: 40 relaciones sin huérfanos; RBAC HTTP 12/12; E2E login 2/2 (API simulada).
Smoke integridad: 4/4; tres circuitos opcionales omitidos. MySQL 8.0.46: bootstrap
limpio y repetido correctos, numeración y catálogo probados con rollback.

Detalle: [AUDIT](AUDIT.md), [mejoras](../../docs/execution/MEJORAS_QA_2026-09-06.md)
y [comandos QA](../../docs/development/QA.md).

## Límites preservados

Sin mutaciones sobre la DB remota, SQL históricos editados, cambios de reglas
constitucionales, despliegue ni llamadas productivas ARCA/Tiendanube.
El usuario autorizó expresamente migraciones solo en wsm_qa, 127.0.0.1:33308.
Los cambios funcionales anteriores se conservaron fuera del alcance de esta tarea.
El job de cobertura incorporado a CI sigue bloqueando; no hay aprobación de producción.

## Tres próximos pasos

1. Cerrar cobertura por dominio (controladores de inventario/integraciones/usuarios,
   compras y dashboard), con escenarios de negocio y sin excluir módulos.
2. Añadir fixtures/circuitos MySQL para caja, recepción y retiro concurrente;
   completar validación de impresión, picking y hardware.
3. Ejecutar el workflow remoto y gates de staging/readiness antes de publicar.

Pendientes operativos previos: [historial](../../docs/execution/archive/base-codex-2026-09-06/TASKS.previous.md).
