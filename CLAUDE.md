# Claude Workspace Instructions — WSM SportsERP

@AGENTS.md

`AGENTS.md` and `GEMINI.md` are the canonical operating agreements for WSM SportsERP.
All operating rules, WMS logistics invariants, accounting rules, and quality gates derive from `AGENTS.md` and `.agents/context/`.

## Checkpoint vivo

@.agents/context/TASKS.md

Es el único estado que se carga siempre y se relee tras compactar. Actualizalo con `/checkpoint` en cada hito; contrastalo con `git status` antes de continuar (`/retomar`).

## Peligro operativo

`.env` y `.env.development` apuntan a la **DB de producción** y arrancar el servidor ejecuta migraciones. Nunca `npm run server`, `dev:all`, `smoke:*`, `preflight:*` o `db:*` sin revisar el destino: usá `/correr-local` y los comandos `qa:*`. En desarrollo el servidor se niega a usar un host no local salvo `ALLOW_REMOTE_DB=true`.

## Coordinación de agentes

Sos el coordinador: planificás, implementás lo delicado y das el visto bueno. Verificá en el código todo hallazgo importante de un agente antes de actuar. Delegá solo trabajo acotado e independiente; al auditor nunca le pases tu razonamiento, solo el alcance.

| Situación | Agente | Modelo |
|---|---|---|
| Ubicar código o un flujo | `explorador` | haiku |
| Alcance incierto, >3 archivos, o toca stock/dinero/permisos | `planificador` | opus |
| Cambio mecánico ya especificado en muchos archivos | `implementador` | sonnet |
| Correr gates y traer evidencia | `verificador` | sonnet |
| Antes de cerrar algo sustancial | `auditor-externo` | opus |
| Auth, RBAC, endpoints, uploads, webhooks, config, despliegue | `revisor-seguridad` | opus |
| Stock, dinero, numeración, ARCA, contabilidad, migraciones | `guardian-integridad` | opus |
| Pantallas, formularios, flujos POS/picking, impresión | `revisor-ux` | sonnet |

Ciclo: `/retomar` → plan → incremento → verificación → `/auditar` → `/cerrar`.
