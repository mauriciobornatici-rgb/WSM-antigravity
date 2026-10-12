# Mapa de arquitectura — WSM SportsERP

Revisado: 2026-09-06. Adaptado de Base Codex `template/.ai/ARCHITECTURE.md`.
Mapa observado en código, no certificación de todos los flujos.

## Componentes

| Componente | Responsabilidad | Entradas/salidas y dependencias |
|---|---|---|
| packages/client | React 19 + Vite 7 + TypeScript; interfaz SPA | React Router, React Query, HTTP con cookies |
| packages/common | TypeScript; contratos Zod y matriz RBAC | Compilación a dist; consumido por cliente y servidor |
| packages/server | Express 5, JavaScript ESM, mysql2 | Rutas → validación/RBAC → controladores → servicios/casos de uso |
| packages/server/domains | Casos de uso de ventas y compras | Dependencias inyectables, conexiones transaccionales |
| packages/server/migrations | 42 archivos SQL presentes | Gestor de migraciones e inicialización de DB |
| Integraciones | ARCA/AFIP y Tiendanube | Servicios, OAuth/HMAC, colas/reintentos y persistencia |
| .github/workflows/ci.yml | CI automatizado | Tests, frontend lint/tipos/build y audit de dependencias |

## Flujos críticos observados

- POS/pedido → schemas de common + permisos → CreateOrderUseCase →
  locks de inventario, reservas/asignaciones y transacción.
- Picking → asignaciones y movimientos → despacho/entrega.
- Retiro mostrador → PickupOrderCheckoutUseCase → extras, entrega, factura y caja.
  Ver H-01 en [AUDIT](AUDIT.md): falta restringir a pedidos pickup.
- Asiento/anulación → accounting.service → libro y contra-asientos.
  Migraciones 027/029 incorporan protecciones de inmutabilidad.
- Conteo → stockAudit.service → stockAuditController.redactBlindCount →
  respuesta sin cantidad esperada/desvío mientras está abierto.
- Tiendanube → webhook/validación → evento persistido → worker/reintentos.
- Venta offline → cola local/IndexedDB → sincronización con clave de idempotencia.
- Impresión → PrintPortal → nodo fuera de la SPA con reglas CSS de impresión.

## Fronteras de confianza

Navegador/API, roles/capacidades, API/MySQL, webhooks/red externa,
credenciales cifradas y variables de entorno. Los schemas no sustituyen
autorización ni invariantes comprobadas dentro de la transacción.
El backend tiene soporte para cookie HttpOnly y autenticación Bearer;
la interfaz debe mantener la política de cookies vigente.

## Áreas de mantenimiento

SalesService (1440 líneas), TiendanubeService (1821), FinanceService (1002),
api.ts (953), ProductCatalogCard (920) y POS (825) concentran responsabilidades.
Son señales para revisar cohesión; el número de líneas solo no justifica una
reescritura. Conservar el monorepo y extraer por dominio cuando un cambio lo requiera.

## Límites

El backend tiene ESLint (sin tipado estático; JSDoc/checkJs por dominio queda como opción).
Los tests con mockPool no prueban locks, triggers o aislamiento real de MySQL.
Arrancar index.js directamente inicializa DB y habilita workers;
importar app para pruebas no llama startServer.
Las invariantes y permisos canónicos permanecen en AGENTS/GEMINI.
