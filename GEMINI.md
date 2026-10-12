# WSM SportsERP — Antigravity Operating Agreement

Este documento es el contrato operativo canónico para agentes de IA que operan en el monorepo de **WSM SportsERP** (comercial, inventario WMS, compras, finanzas, facturación electrónica y tienda online).

---

## 1. Al Iniciar Cada Tarea

1. **Lectura de Estado y Contexto**:
   - Revisa `.agents/context/PROJECT.md` y `docs/execution/STATE.md` para conocer el estado actual y prioridades de preproducción.
   - Revisa `.agents/context/TASKS.md` para ubicar el objetivo activo y las siguientes 1–3 acciones.
   - Revisa `.agents/context/QUALITY.md` para seleccionar los comandos de verificación aplicables.
   - Revisa `.agents/context/BUDGET.yaml` para respetar los límites de contexto y autonomía.
2. **Inspección de Solo Lectura**:
   - Inspecciona únicamente los paquetes o módulos afectados (`packages/client`, `packages/server`, `packages/common`).
   - Preserva siempre los cambios locales no confirmados (*dirty worktree*).
3. **Criterios de Aceptación Observables**:
   - Define las condiciones de éxito antes de codificar (pruebas que deben pasar, respuestas HTTP, interfaces de usuario a 320 px para móvil).
4. **Planificación (Planning Mode)**:
   - Si la tarea implica cambios de esquema de base de datos, mutaciones contables, flujos de picking/stock o integraciones externas (ARCA, Tiendanube), genera primero `implementation_plan.md` y solicita aprobación.

---

## 2. Invariantes Críticas del Proyecto (No Negociables)

- **Invariante WMS y Logística**:
  - Prohibido permitir stock negativo en operaciones comerciales normales.
  - El conteo cíclico móvil (`Control de stock`) debe operar en modalidad **conteo ciego**: el backend nunca expone cantidades teóricas ni desvíos mientras la sesión está abierta.
  - La aprobación de ajustes de inventario exige separación de funciones (administración/gerencia) y validación de reservas previas.
- **Invariante Contable y Financiera**:
  - Libro contable inmutable: **nunca ejecutar `DELETE` ni `UPDATE`** sobre asientos confirmados; cualquier rectificación se realiza mediante contra-asiento trazado.
  - Toda venta, cobranza, anulación o ajuste de stock con impacto valorizado debe registrar su correspondiente movimiento de balance.
- **Arquitectura Monorepo y RBAC**:
  - Las capacidades de permisos (RBAC) son únicas y se definen en `@wsm/common`, compartidas entre cliente y servidor.
  - Autenticación mediante JWT en cookies `HttpOnly`, `SameSite=Strict`, `Secure`.

---

## 3. Calidad y Verificación Determinista

- **Durante el Desarrollo (Fast Checks)**:
  - Cambios en frontend: `npm -w @wsm/client run lint` y `npm -w @wsm/client run typecheck`.
  - Cambios en backend: `npm -w @wsm/server run test`.
  - Cambios en tipos compartidos: `npm -w @wsm/common run build`.
- **Antes del Cierre de Tarea (Full Checks)**:
  - `npm run validate` (construcción compartida + tests + lint + typecheck + build de cliente).
  - `npm run preflight:integrity` (verificación de huérfanos relacionales en BD).
  - `npm run smoke:rbac` (verificación de matriz de autorización y seguridad).
- **Prohibición de Cierre Ficticio**:
  - Nunca declares una tarea completada si alguno de estos comandos falló o no fue ejecutado.

---

## 4. Autonomía y Límites

### Permitido sin consulta previa:
- Lectura e inspección del código y documentación.
- Modificaciones en archivos dentro del alcance explícito de la tarea acordada.
- Ejecución de scripts de prueba, linting, typecheck y preflight locales.
- Actualización de `.agents/context/TASKS.md` y `docs/execution/STATE.md`.

### Requiere aprobación previa del usuario:
- Creación o aplicación de nuevas migraciones SQL en la base de datos.
- Modificación de esquemas de tablas o triggers contables.
- Invocación de endpoints con credenciales reales de producción (ARCA / Tiendanube).
- Modificación de este archivo (`GEMINI.md`) o de `AGENTS.md`.

---

## 5. Cierre y Continuidad

Al terminar una tarea:
1. Asegura que `npm run validate` y `npm run preflight:integrity` pasen limpiamente.
2. Actualiza `.agents/context/TASKS.md` y registra el hito en `docs/execution/STATE.md`.
3. Informa: cambios realizados, comandos ejecutados y evidencia de cumplimiento.
