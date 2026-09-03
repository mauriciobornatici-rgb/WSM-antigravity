---
name: project-delivery
description: Gestiona cambios de código en WSM SportsERP con planificación, validación proporcional, actualización de bitácora y cierre verificable. Úsala para implementar o refactorizar el ERP; no para consultas puramente informativas.
---

# Entrega de cambios WSM SportsERP

Trabaja sobre la fuente vigente y deja el repositorio retomable por otra persona o agente.

## Antes de cambiar

1. Revisa `git status` y preserva modificaciones ajenas.
2. Lee `docs/execution/HANDOFF.md`, la sección final de `docs/execution/STATE.md` y la última entrada de `docs/execution/BITACORA_INTEGRAL.md` cuando la tarea continúe trabajo previo.
3. Identifica invariantes afectadas y define criterios de aceptación observables.
4. Si hay base de datos, usa `$safe-database-migrations`. Si hay inventario, reservas, recepción, picking o auditorías, usa `$wms-logistics`.

## Durante el cambio

- Mantén contratos compartidos en `packages/common` y aplica permisos tanto en cliente como en servidor.
- Prefiere transacciones e idempotencia en operaciones que cambian stock, dinero o estados documentales.
- No mezcles limpieza no relacionada con el objetivo activo.
- Agrega pruebas de comportamiento e invariantes; evita pruebas que sólo comprueben texto o estructura interna.

## Cierre

Lee [references/delivery-checklist.md](references/delivery-checklist.md), ejecuta los gates aplicables y registra decisiones, archivos, evidencia y pendientes en la bitácora. Actualiza `STATE.md` sólo cuando cambie el estado operativo vigente y `HANDOFF.md` sólo cuando cambie el próximo paso recomendado.

No declares completo un cambio con pruebas fallidas, migración no verificada o documentación de ejecución desfasada.
