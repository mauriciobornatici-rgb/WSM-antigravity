# Execution State Snapshot

Last updated: 2026-02-18
Status: IN_PROGRESS
Current block: P2
Current task: P2.1 - Contrast/accessibility pass + UX consistency on remaining sales/procurement tables

## Resume From Here
1. Run full mojibake/wording pass in core screens (`Orders`, `POS`, `Invoices`, `Settings`, `Receptions`) and normalize labels to Spanish AR.
2. Standardize loading/error/empty states in procurement and sales screens.
3. Continue contrast/accessibility pass on remaining high-density tables (`Suppliers`, `Invoices`, `Clients`).
4. Keep P2 changes incremental and verify lint/typecheck/build on each batch.

## Completed
- Consolidated gap list and priority order.
- Created persistent execution docs:
  - `docs/execution/MASTER_PLAN.md`
  - `docs/execution/STATE.md`
  - `docs/execution/CHANGELOG_EXECUTION.md`
- P0.1 completed:
  - Removed vulnerable `window.open + document.write` print flow in:
    - `packages/client/src/pages/ReturnsAndWarranties.tsx`
  - Replaced with safe JSX-rendered printable area + `window.print`.
  - Verified no `document.write`/`window.open` usage remains in frontend.
- P0.2 completed:
  - Implemented atomic stock check and deduction during order creation in:
    - `packages/server/services/sales.service.js`
  - Added row-level lock (`FOR UPDATE`) and transactional inventory decrement.
  - Added inventory movement logging for sales deductions.
  - Aligned frontend messages with backend stock behavior in:
    - `packages/client/src/pages/Orders.tsx`
- P0.3 partial progress:
  - `GET /api/products` now returns `stock_current` derived from `inventory` (canonical read path):
    - `packages/server/services/inventory.service.js`
    - `packages/server/controllers/inventoryController.js`
- P0.3 completed:
  - Frontend stock reads aligned with canonical `stock_current` from `/api/products`:
    - `packages/client/src/pages/POS.tsx`
    - `packages/client/src/pages/Inventory.tsx`
  - Product type updated to reflect backend contract:
    - `packages/client/src/types/index.ts`
  - Inventory service response normalized to avoid leaking helper fields:
    - `packages/server/services/inventory.service.js`
- P0.5 completed:
  - Server startup now waits for DB initialization before listening:
    - `packages/server/index.js`
- P0.7 completed:
  - MySQL TLS toggle added (`DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`):
    - `packages/server/config/db.js`
    - `.env.example`
- P0.4 completed:
  - Added deterministic base migration covering runtime-required tables:
    - `packages/server/migrations/000_create_core_schema.sql`
  - Refactored DB init to migration-first bootstrap + deterministic seeding only:
    - `packages/server/config/initDb.js`
  - Converted schema reference to migrations-first policy:
    - `packages/server/db/schema/schema.sql`
  - Staging runtime validation:
    - backend startup completed with migration `000_create_core_schema.sql` applied successfully.
- P0.6 completed:
  - Added centralized environment policy + validation:
    - `packages/server/config/env.js`
  - Enforced startup config in runtime:
    - `packages/server/index.js`
    - `packages/server/config/db.js`
  - Hardened production/staging error responses:
    - `packages/server/middleware/errorMiddleware.js`
  - Documented explicit non-dev override and env profiles:
    - `.env.example`
- P0.8 completed:
  - Enforced invoice payment invariants in sales service:
    - `payment_status` now derived from effective payments (`pending|partial|paid`).
    - rejects overpayment (`PAYMENTS_EXCEED_TOTAL`).
    - prevents invalid payment lines.
  - Added accounting trace for invoice collections:
    - each payment line writes to `transactions` (`type='sale'`).
  - Synced order payment state with invoice state:
    - `orders.payment_status` no longer hardcoded to `paid`.
    - `orders.status` only escalates to `completed` when payment is fully paid.
  - Files:
    - `packages/server/services/sales.service.js`
- P1.1 completed:
  - `approveClientReturn` moved from placeholder to transactional, idempotent flow.
  - Approval now performs:
    - stock impact (`inventory` + `inventory_movements`) according to item condition.
    - automatic credit note issuance linked to return.
    - accounting trace in `transactions`.
    - client balance update for issued credit.
  - Added domain error mapping + audit logging for approval action.
  - Files:
    - `packages/server/services/warranties.service.js`
    - `packages/server/controllers/warrantiesController.js`
- P1.2 completed:
  - Added backend order state machine and invalid transition blocking.
  - `updateOrderStatus` now uses transition validation instead of blind updates.
  - `dispatchOrder` and `deliverOrder` now validate allowed transition path.
  - Compatibility aliases preserved for legacy statuses (`confirmed` -> `picking`, `paid` -> `packed`).
  - Files:
    - `packages/server/services/sales.service.js`
    - `packages/server/controllers/salesController.js`
- P1.3 completed:
  - Added transactional sequence allocator:
    - `packages/server/utils/documentSequence.js`
  - Added migration:
    - `packages/server/migrations/002_create_document_sequences.sql`
  - Migrated numbering to concurrency-safe sequences:
    - invoices (`sales.service`)
    - purchase orders, receptions, supplier returns (`procurementController`)
    - credit notes (`warranties.service` and manual credit note controller flow)
  - Manual credit note creation now runs in explicit transaction with audit trace.
  - Staging validation:
    - migration `002_create_document_sequences.sql` executed successfully at boot.
- P1.4 completed:
  - Removed remaining dynamic `ORDER BY` surface in sales listing.
  - Added strict allowlist sanitization for `getOrders(..., options.orderBy)` in backend service.
  - File:
    - `packages/server/services/sales.service.js`
- P1.5 completed:
  - Fiscal/company config now centralized and consumable for all authenticated roles.
  - Backend:
    - Added authenticated public profile endpoint for company settings:
      - `GET /api/settings/company/public`
    - Extended `company_settings` payload/updates with operational fields:
      - `operation.tax_rate`
      - `operation.default_currency`
    - Preserved existing values when `operation` is omitted in updates.
    - Files:
      - `packages/server/controllers/settingsController.js`
      - `packages/server/routes/settingsRoutes.js`
      - `packages/server/middleware/validationMiddleware.js`
  - Frontend:
    - Added centralized settings helper with defaults/fallback/formatters:
      - `packages/client/src/lib/companySettings.ts`
    - Replaced hardcoded legal/fiscal constants in print flows:
      - `packages/client/src/pages/Invoices.tsx`
      - `packages/client/src/pages/POS.tsx`
      - `packages/client/src/pages/Orders.tsx`
    - Added API method for public company profile:
      - `packages/client/src/services/api.ts`
    - Extended company settings type with operation fields:
      - `packages/client/src/types/index.ts`
    - Settings page now syncs tax/currency with backend company settings:
      - `packages/client/src/pages/Settings.tsx`
  - Validation:
    - Backend syntax checks passed (`node --check`).
    - Frontend lint passed on touched files.
    - Frontend typecheck passed (`tsc --noEmit`).
- P2.1 partial progress:
  - Improved contrast and interaction accessibility in receptions tables/tabs:
    - stronger table header/body contrast classes
    - higher-contrast status badges with ring outlines
    - focus-visible rings on action and filter controls
  - File:
    - `packages/client/src/pages/Receptions.tsx`
  - Validation:
    - Frontend lint/typecheck passed for touched files (one non-blocking hooks warning in `Receptions.tsx`).
- P2.1 partial progress (continued):
  - Reinforced POS checkout flow and operator UX:
    - quick client creation in-place
    - expanded payment/invoice variants (`credit_card`, `transfer`, invoice type selector)
    - success confirmation dialog with order/invoice trace
    - category filter in products grid
  - File:
    - `packages/client/src/pages/POS.tsx`
  - Validation:
    - Frontend typecheck and build passed.
- P2.1 partial progress (continued):
  - Improved contrast/accessibility in purchase orders table and controls:
    - stronger status badge contrast with ring outlines
    - unified table typography classes for dense data
    - focus-visible rings and aria-label on row actions
    - fixed hooks warning by stabilizing `loadOrders` with `useCallback`
  - File:
    - `packages/client/src/pages/PurchaseOrders.tsx`
  - Validation:
    - Frontend lint/typecheck/build passed.

## Next After Current Task
P2.2 - Replace fake data/simulations with real data or explicit feature flags.

## Open Decisions (Need confirmation for upcoming blocks)
1. Stock policy (implemented assumption):
   - Applied Option A: deduct at order creation.
   - If business prefers reservation model, refactor in a dedicated pass.
2. Stock source of truth (resolved):
   - Canonical source: `inventory` table.
   - Compatibility contract: `/api/products` exposes derived `stock_current`.
3. Non-dev exception policy:
   - `ALLOW_INSECURE_NON_DEV=true` remains available as explicit break-glass override.
   - Default policy is strict fail-fast in staging/production.
