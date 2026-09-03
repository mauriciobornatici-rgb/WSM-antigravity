# Decision Log — WSM SportsERP (ADR)

Este registro documenta las decisiones estructurales y de arquitectura que condicionan el desarrollo del proyecto.

---

### ADR-001 — Monorepo con npm workspaces y contratos compartidos en @wsm/common
- **Fecha:** 2026-06-01
- **Estado:** accepted
- **Contexto:** Necesidad de sincronizar tipos TypeScript, DTOs y matriz de capacidades RBAC entre backend y frontend sin duplicación de código.
- **Decisión:** Utilizar monorepo estructurado con `@wsm/client` (React/Vite), `@wsm/server` (Express/Node) y `@wsm/common` (tipos e interfaces).
- **Consecuencias:** Todo cambio en tipos compartidos exige reconstruir `@wsm/common` (`npm run build:common`).

---

### ADR-002 — Autenticación robusta con JWT en cookies HttpOnly
- **Fecha:** 2026-08-19
- **Estado:** accepted
- **Contexto:** Mitigar riesgos de XSS derivados del almacenamiento de tokens en `localStorage`.
- **Decisión:** Migrar el almacenamiento de JWT a cookies `HttpOnly`, `SameSite=Strict`, `Secure` gestionadas exclusivamente por el backend con control de `token_version` para revocación instantánea.
- **Consecuencias:** El cliente web no lee el token directamente; las peticiones utilizan `credentials: 'include'`.

---

### ADR-003 — Libro mayor contable inmutable y contra-asientos
- **Fecha:** 2026-08-19
- **Estado:** accepted
- **Contexto:** Garantizar trazabilidad y cumplimiento contable/auditoría sin riesgo de borrado accidental de transacciones financieras.
- **Decisión:** Bloquear operaciones `DELETE` o `UPDATE` sobre asientos confirmados; cualquier anulación o ajuste se ejecuta mediante contra-asiento formal.
- **Consecuencias:** Integridad transaccional 100% auditable y reproducible.

---

### ADR-004 — Conteo cíclico móvil en modalidad ciega y segregación de funciones
- **Fecha:** 2026-08-22
- **Estado:** accepted
- **Contexto:** Evitar sesgos en la toma de inventario físico en bodega y garantizar control interno.
- **Decisión:** El backend no entrega stock teórico ni desvíos durante la sesión de conteo. Los operarios solo registran lo observado físicamente. La aprobación de diferencias queda reservada a roles administrativos o gerencia.
- **Consecuencias:** Auditorías de stock fiables y trazables por SKU y ubicación física.

---

### ADR-005 — Marco de Gobernanza y Mejores Prácticas con Google Antigravity
- **Fecha:** 2026-09-02
- **Estado:** accepted
- **Contexto:** Estandarizar la interacción de agentes de IA con el monorepo para evitar pérdidas de contexto, regresiones y consumo desmedido de tokens.
- **Decisión:** Adoptar la arquitectura oficial de Antigravity con `GEMINI.md` en la raíz, capa `.agents/context/`, contrato de calidad determinista en `QUALITY.md` y normalización de plugins/skills de ingeniería.
- **Consecuencias:** Trabajo continuo, verificable y compatible con las herramientas avanzadas de Antigravity.
