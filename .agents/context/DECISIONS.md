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

---

### ADR-006 — Adaptación selectiva de Base Codex a la memoria existente
- **Fecha:** 2026-09-06
- **Estado:** accepted (documentación dentro del alcance solicitado)
- **Contexto:** Dos memorias divergentes y snapshots extensos dificultaban retomar el trabajo.
- **Decisión:** Conservar AGENTS/GEMINI y .agents/context como fuentes vigentes; usar .ai como referencias de compatibilidad; archivar el historial antes de resumirlo. Incorporar mapas de arquitectura/riesgos/evidencia y perfiles de lectura adaptados de Base Codex.
- **Evidencia:** [Informe](../../docs/execution/ANALISIS_APP_Y_BASE_CODEX_2026-09-06.md), scripts reales y gates ejecutados.
- **Consecuencias:** Menos duplicación del estado activo; el modelo/esfuerzo de agentes se hereda. No se modifica la autoridad de las reglas existentes ni se exige delegación automática.
- **Reversión:** [Copias previas](../../docs/execution/archive/base-codex-2026-09-06/README.md); restaurar solo documentos de esta adaptación, preservando cambios funcionales previos.
- **Sustituye a:** Ninguna decisión de dominio; complementa ADR-005 para compatibilidad con Codex.

---

### ADR-007 — Capa de control Claude Code adaptada de Base Claude
- **Fecha:** 2026-09-25
- **Estado:** accepted (pedido explícito del usuario)
- **Decisión:** Instalar `.claude/` (settings, hooks, 8 agentes, 5 skills) apuntando a `.agents/context/` como único estado; no crear un `.ai/ESTADO.md` paralelo. `CLAUDE.md` importa `TASKS.md`. Modelo por agente según riesgo: haiku (explorador), sonnet (implementador, verificador, revisor-ux), opus (planificador, auditor-externo, revisor-seguridad, guardian-integridad).
- **Consecuencias:** Bitácora local (`.agents/context/BITACORA.md`, gitignored) escrita por hook; la puerta Stop exige checkpoint; los scripts que tocan la DB configurada quedan en `ask`.

### ADR-008 — Decisiones de negocio del usuario
- **Fecha:** 2026-09-25
- **Precio POS:** el servidor usa el precio de catálogo; solo un permiso nuevo `ORDERS_PRICE_OVERRIDE` permite cambiarlo, con auditoría de cada cambio.
- **IVA (corregido tras verificar el POS):** `sale_price` es **neto**; el POS cobra neto + IVA y eso es correcto. Se unifica el mismo cálculo en cliente, servidor y ARCA (`afip.service` hoy lo trata como final). La primera respuesta ("incluye IVA") quedó sin efecto.
- **Venta offline:** al sincronizar se respeta el precio capturado y, si el turno se cerró, se asigna al turno abierto actual; todo con auditoría.
- **Reparación, pedidos POS sin factura ni pago:** solo se listan; `--cancel-unpaid` libera su reserva a pedido.
- **Tiendanube entregado/cerrado sin picking local:** se consume la reserva y queda movimiento `sale`.
- **Permiso `ORDERS_PRICE_OVERRIDE`:** admin y manager; no cajero ni depósito.
- **Stock histórico:** las ventas POS nunca descontaron stock físico. Se corrige el código y se entregan scripts de diagnóstico y reparación (dry-run, probados en QA); el usuario decide si y cuándo correrlos en producción.
- **Asiento de compras:** solo la factura del proveedor genera el asiento (Mercadería + IVA CF / Proveedores); la aprobación de la recepción mueve stock sin asentar.
- **DB remota:** en desarrollo el servidor rechaza un `DB_HOST` no local salvo `ALLOW_REMOTE_DB=true`.
- **Migraciones nuevas:** permitidas, probadas únicamente en `wsm_qa` (127.0.0.1:33308); las históricas no se editan.

### ADR-011 — Cierre de decisiones abiertas (usuario, 2026-10-12)
- **Excepción offline declarada por el cliente:** riesgo aceptado. No hay forma técnica de probar que una terminal estuvo sin red; el control es la revisión obligatoria en "Excepciones POS", con aviso visible al gerente cuando hay pendientes.
- **Devolución a proveedor:** espeja la factura de compra: Proveedores (bruto) / Mercadería (neto) + IVA crédito fiscal; el saldo del proveedor puede quedar a favor (sin recorte a 0).
- **Remoto:** push de `codex/hardening-100` y Pull Request a `main`; no se mergea sin aprobación del usuario.

### ADR-010 — Decisiones tras la auditoría AUD-001 (usuario, 2026-09-25)
- **Precio de venta offline distinto al catálogo:** la venta se registra (ya ocurrió) pero queda como excepción pendiente de revisión de un gerente (permiso `ORDERS_PRICE_OVERRIDE`), visible en un listado.
- **Venta offline sin stock al sincronizar:** se registra; se descuenta lo disponible sin quedar negativo y el faltante queda como anomalía auditada para conteo, en vez de trabar la cola.
- **Asientos de compra duplicados históricos:** script de solo lectura que lista duplicados y propone contra-asientos; se aplican solo con comando explícito tras revisión del contador.
- **403 vs 409 en precio no autorizado:** se mantiene 409 (`PRICE_OVERRIDE_NOT_ALLOWED`): el caso típico es catálogo desactualizado en pantalla.

### ADR-009 — Riesgos aceptados en la ola de endurecimiento
- **Fecha:** 2026-09-25
- `Bearer` sigue aceptado porque lo usan los smokes RBAC/integridad/comercial; la UI usa solo cookie.
- El logout no incrementa `token_version`: revocaría la sesión del usuario en todas sus terminales. La cookie es HttpOnly + SameSite=Strict.
