# Tarea actual — WSM SportsERP

## Objetivo

Endurecer la app (seguridad, confiabilidad, mantenibilidad, UX) con la capa
Claude adaptada de `C:\Dev\Base claude` (ADR-007). Coordinador: Claude; agentes
con modelo por riesgo. Decisiones de negocio del usuario en ADR-008.

## Hecho — 2026-09-25 (rama codex/hardening-100)

- [x] `4221d26` línea base: commit del trabajo QA del 2026-09-06.
- [x] Auditorías independientes: seguridad y datos (opus), UX y mantenibilidad (sonnet). Hallazgos clave verificados en código por el coordinador.
- [x] `b201f2e` Ola A: guarda DB remota en dev, secretos de ejemplo rechazados, webhooks/callback Tiendanube alcanzables (antes 401), JWT HS256, login sin fuga por tiempo, IP de auditoría confiable, actores de caja/recepción = usuario autenticado, X-Request-Id validado, health con timeout, jsx-a11y + etiquetas, Node 24, capa `.claude/`.
- [x] `f51fe90` ErrorBoundary por ruta (reintento, aviso de versión nueva).
- [x] Evidencia: `npm run validate` exit 0 (7 guards, 436 backend, 62 cliente, lint, tipos, build).

## Ola B — integridad de stock y dinero (en planificación)

Defectos confirmados: C1 ventas POS nunca descuentan stock físico ni escriben
movimiento (solo reservan; factura pasa a `completed`); H1 sin guarda DB y
`GREATEST(...,0)` oculta faltantes; H3 NC sin lock; H4 precio del cliente;
H5 compras asentadas dos veces; M3 pagos divididos perdidos en caja;
M8 transferencia borra filas referenciadas. H2 (numeración ARCA) aparte.

## Próximos pasos

1. Revisar plan del planificador y ejecutar primer incremento (checkout POS atómico) con tests MySQL en `wsm_qa` (127.0.0.1:33308, `docker-compose.test.yml`).
2. Scripts de diagnóstico/reparación de stock histórico (dry-run) — el usuario los corre en prod.
3. Luego: ESLint del servidor, extracción de SQL de controladores, E2E de checkout.

## Límites

Sin mutaciones en la DB remota (el `.env` apunta a producción). Migraciones
nuevas solo en QA. Sin push ni despliegue. Test flaky conocido:
`health-and-correlation.test.js` bajo carga (pasa aislado; health ahora acotado a 2 s).
