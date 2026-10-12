---
name: safe-database-migrations
description: Crea o revisa migraciones MySQL de WSM SportsERP con compatibilidad, backfill verificable, integridad y recuperación. Úsala ante cualquier cambio de esquema o datos persistentes.
---

# Migraciones seguras WSM

Lee [references/migration-policy.md](references/migration-policy.md) antes de editar.

Determina primero el esquema vigente, la última migración y las consultas que dependen del contrato. Prefiere expansión compatible → backfill → validación → restricciones; no combines una eliminación irreversible con el primer despliegue del nuevo modelo.

Toda migración debe:

- Tener número nuevo y nombre descriptivo; nunca editar una ya ejecutada.
- Ser determinista ante una base actual válida.
- Preservar datos históricos o documentar explícitamente su transformación.
- Incluir índices y claves que representen invariantes reales.
- Tener pruebas o preflight que detecten duplicados y huérfanos.
- Registrar impacto, recuperación y evidencia en la bitácora.

No ejecutes DDL destructivo ni migres datos de producción sin autorización, backup verificado y ventana operativa.
