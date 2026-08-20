# WSM Antigravity (SportsERP)

Monorepo con frontend React/Vite y backend Node/Express para gestión comercial, inventario, compras, finanzas y facturación.

## Requisitos

- Node.js 20+
- MySQL 8+
- Variables de entorno en `.env.development`, `.env.staging` o `.env.production` (usar `.env.example` como base)

## Comandos principales

- `npm install`
- `npm run dev` inicia frontend (`@wsm/client`)
- `npm run server` inicia backend (`@wsm/server`)
- `npm run dev:all` inicia frontend + backend
- `npm run build` build de frontend
- `npm run validate` ejecuta contratos compartidos, tests, lint, tipado y build
- `npm run preflight:integrity` valida huérfanos antes de aplicar claves foráneas (solo lectura)
- `npm run preflight:staging` ejecuta el gate local completo contra un backend de staging ya iniciado

## Continuidad de trabajo (importante)

Para retomar tareas sin reanalizar todo el proyecto:

- Estado vivo: `docs/execution/STATE.md`
- Plan maestro: `docs/execution/MASTER_PLAN.md`
- Historial de ejecucion: `docs/execution/CHANGELOG_EXECUTION.md`
- Punto rapido de reanudacion: `docs/execution/HANDOFF.md`

## Variables de entorno

Separadas por paquete para evitar mezclar frontend y backend:

- `packages/client/.env` o `packages/client/.env.development`
  - `VITE_API_URL`
- `.env.<NODE_ENV>` en la raíz (backend `@wsm/server`)
  - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - `PORT`, `JWT_SECRET`, `NODE_ENV`, `CORS_ORIGINS`, `TRUST_PROXY`
  - `ENV_FILE` permite seleccionar explícitamente otro archivo relativo a la raíz

Referencia:

- `packages/client/.env.example` (frontend)
- `.env.example` (backend)

## Smokes de validación

### RBAC y validación de input

- `npm run smoke:rbac`

### Integridad (modo seguro por defecto)

- `npm run smoke:integrity`

Este modo no realiza mutaciones de negocio.

### Integridad con mutaciones controladas

- PowerShell:
  - `$env:SMOKE_MUTATION='1'; npm run smoke:integrity`

Crea cliente/proveedor temporales y valida soft-delete.

### Flujo de recepción (opcional)

- PowerShell:
  - `$env:SMOKE_RECEPTION_FLOW='1'`
  - `$env:SMOKE_SUPPLIER_ID='<uuid_supplier>'`
  - `$env:SMOKE_PRODUCT_ID='<uuid_product>'`
  - `npm run smoke:integrity`

Valida creación de OC/recepción, bloqueo sin control de calidad, alta del control, aprobación y bloqueo del segundo intento.

### Flujo de caja (opcional)

- PowerShell:
  - `$env:SMOKE_CASH_FLOW='1'; npm run smoke:integrity`

Valida ajustes de caja y actualización de `expected_balance`.

Opcionalmente:

- `$env:SMOKE_CASH_REGISTER_ID='<uuid_register>'`

Si no se define, el script intenta usar una caja abierta automáticamente.
