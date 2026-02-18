# Execution Changelog

## 2026-02-18

### Changed
- `packages/client/src/pages/POS.tsx`
  - Expanded POS checkout workflow for reconstruction parity:
    - category filtering in product catalog
    - quick client creation dialog
    - broader payment methods and invoice type selection
    - sale success dialog with order/invoice traceability
  - Kept API contract aligned with current backend (`createOrder`, optional `createInvoice`, `addShiftPayment`).
- `packages/client/src/pages/PurchaseOrders.tsx`
  - Improved accessibility and readability in dense table view:
    - higher-contrast status badges with ring outlines
    - unified table header/body text classes for legibility
    - focus-visible rings for primary/filter/action controls
    - aria-label on details action button
  - Stabilized data loading hook with `useCallback` to clear lint warning.
- `docs/execution/STATE.md`
  - Updated active state snapshot and resume steps for next session.
- `packages/client/src/pages/Dashboard.tsx`
  - Replaced simulated metrics/activity with real API-driven dashboard data.
  - Added role-aware fallback:
    - uses `/api/transactions` for sales when role allows it
    - falls back to `/api/orders`-derived sales if finance endpoint is forbidden
  - Added real panels:
    - sales trend for last 7 days
    - recent activity from transactions/orders
- `docs/execution/STATE.md`
  - Moved active task to `P2.2` after dashboard de-mocking.
- `packages/client/src/pages/Invoices.tsx`
  - Hardened email action UX to avoid fake operational confirmation:
    - explicit simulation message when integration is not available
    - feature-flag gate (`VITE_ENABLE_INVOICE_EMAIL`) for future backend hookup
  - Replaced remaining English action label (`Add` -> `Agregar`) in manual invoice flow.

### Verified
- Frontend checks passed:
  - `npx tsc -p packages/client/tsconfig.app.json --noEmit`
  - `npm -w @wsm/client exec eslint src/pages/PurchaseOrders.tsx`
  - `npm -w @wsm/client run build`
  - `npm -w @wsm/client exec eslint src/pages/Dashboard.tsx`
  - `npm -w @wsm/client exec eslint src/pages/Invoices.tsx`

## 2026-02-17

### Added
- Created persistent execution framework to avoid re-analysis on resume:
  - `docs/execution/MASTER_PLAN.md`
  - `docs/execution/STATE.md`
  - `docs/execution/CHANGELOG_EXECUTION.md`

### Notes
- Current active task set to `P0.1 - Stored XSS removal in credit note print flow`.

### Changed
- `packages/client/src/pages/ReturnsAndWarranties.tsx`
  - Replaced vulnerable credit note print implementation (`window.open` + `document.write`) with safe in-app printable JSX section + `window.print`.
  - Added `noteToPrint` state and `handlePrintNote` helper.
  - Added hidden print container `#printable-credit-note` rendering escaped values.
- `packages/server/services/sales.service.js`
  - Added atomic inventory validation/deduction during `createOrder` with row locks (`FOR UPDATE`).
  - Added explicit stock/domain errors for insufficient stock and invalid quantity.
  - Registered `inventory_movements` entries for sales deductions within the same transaction.
- `packages/client/src/pages/Orders.tsx`
  - Updated UX copy to match backend behavior (stock validated/deducted on order creation; dispatch updates shipping/status only).
- `packages/server/services/inventory.service.js`
  - Added `getProductsWithInventoryStock(filters)` to expose product catalog with `stock_current` derived from `inventory`.
- `packages/server/controllers/inventoryController.js`
  - Switched `GET /api/products` to use inventory-derived stock read path.

### Verified
- Searched frontend for vulnerable pattern:
  - `document.write`: none remaining
  - `window.open(...)`: none remaining

### Validation Notes
- Lint run over `ReturnsAndWarranties.tsx` reports pre-existing file-level hook lint issues unrelated to this fix (`react-hooks/immutability`, `react-hooks/set-state-in-effect`).
- Syntax check passed for:
  - `packages/server/services/sales.service.js` (`node --check`)
- Lint run over `Orders.tsx` reports pre-existing issues unrelated to this patch (hook ordering rule and existing unused catch params).

### Changed (Follow-up execution)
- `packages/client/src/types/index.ts`
  - Added `stock_current` and `stock_min` to `Product` type to match backend contract.
- `packages/client/src/pages/POS.tsx`
  - Removed secondary stock aggregation from `/api/inventory`.
  - Switched POS stock source to canonical `product.stock_current` (served by `/api/products` from `inventory`).
  - Fixed one unused `catch` variable to keep lint clean.
- `packages/client/src/pages/Inventory.tsx`
  - Removed non-canonical `inventory.find(...)` stock read that could misreport multi-location stock.
  - Switched `stock_available` to canonical `product.stock_current`.
  - Replaced irregular unicode warning glyph with ASCII text to satisfy lint rule.
- `packages/server/services/inventory.service.js`
  - Normalized `getProductsWithInventoryStock` response:
    - preserve `stock_current` derived from inventory
    - omit internal alias field `inventory_stock_current`.
- `packages/server/index.js`
  - Hardened startup sequence:
    - await `initDatabase()` before calling `app.listen(...)`
    - fail fast on initialization errors.
- `packages/server/config/db.js`
  - Added MySQL TLS support via env flags:
    - `DB_SSL`
    - `DB_SSL_REJECT_UNAUTHORIZED`
  - Added explicit `DB_PORT` handling.
- `.env.example`
  - Documented `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED`.

### Verified (Follow-up execution)
- Syntax checks passed:
  - `node --check packages/server/index.js`
  - `node --check packages/server/config/db.js`
  - `node --check packages/server/services/inventory.service.js`
- Frontend lint passed for touched files:
  - `npm -w @wsm/client exec eslint src/pages/POS.tsx src/pages/Inventory.tsx src/types/index.ts`
- Frontend type-check passed:
  - `npm -w @wsm/client exec tsc -- --noEmit`

### Changed (Deterministic DB Bootstrap Pass)
- `packages/server/migrations/000_create_core_schema.sql`
  - Added deterministic base schema migration for runtime tables used by backend modules.
  - Added default seeds:
    - tax conditions
    - default cash register (`00000000-0000-0000-0000-000000000001`)
- `packages/server/config/initDb.js`
  - Replaced ad-hoc table creation/alter flow with migration-first bootstrap.
  - Added required-table assertion after migration run for all runtime modules.
  - Kept deterministic seeding for:
    - default admin
    - baseline company settings row (`id=1`)
- `packages/server/db/schema/schema.sql`
  - Converted to schema reference doc and declared migrations as source of truth.

### Verified (Deterministic DB Bootstrap Pass)
- Syntax checks passed:
  - `node --check packages/server/config/initDb.js`
  - `node --check packages/server/config/migrations_manager.js`
  - `node --check packages/server/index.js`
- Migration file order verified:
  - `000_create_core_schema.sql`
  - `001_create_supplier_returns.sql`

### Validation Constraints
- Full API smoke suite was not run in this session.
- Integration verification on live MySQL should continue with the next smoke step:
  - boot server with empty/fresh schema
  - run core APIs (`/api/health`, auth, products, orders, receptions, invoices, cash-management)

### Runtime Validation (Staging)
- Server start command executed successfully with current env:
  - `npm -w @wsm/server run start`
- Observed at startup:
  - migration `000_create_core_schema.sql` executed successfully
  - migration `001_create_supplier_returns.sql` detected as already executed
  - backend reached listening state on port `3001`

### Changed (Environment Hardening Pass)
- `packages/server/config/env.js`
  - Added centralized env parsing/validation for:
    - `NODE_ENV` profile enforcement (`development|staging|production`)
    - strong non-dev constraints (`JWT_SECRET`, `CORS_ORIGINS`, `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`)
    - strict fail-fast behavior with explicit break-glass override (`ALLOW_INSECURE_NON_DEV`)
  - Added non-dev operational warnings (`TRUST_PROXY`, localhost origins in CORS).
- `packages/server/index.js`
  - Wired server runtime to validated config (`getEnvConfig()`).
  - Replaced direct `process.env` usage for CORS/env-sensitive branches.
- `packages/server/config/db.js`
  - Wired DB connection to validated env (`dbPort`, TLS policy).
- `packages/server/middleware/errorMiddleware.js`
  - Suppresses internal 500 error detail outside development.
- `.env.example`
  - Documented allowed `NODE_ENV` values and `ALLOW_INSECURE_NON_DEV`.

### Verified (Environment Hardening Pass)
- Syntax checks passed:
  - `node --check packages/server/config/env.js`
  - `node --check packages/server/index.js`
  - `node --check packages/server/config/db.js`
  - `node --check packages/server/middleware/errorMiddleware.js`
- Runtime boot check:
  - `npm -w @wsm/server run start` reached listening state (command timeout expected due long-running server process).

### Changed (Payment/Accounting Invariants Pass)
- `packages/server/services/sales.service.js`
  - Added payment normalization and validation helpers for invoice flows:
    - invalid payment amount/method => explicit 400 error
    - overpayment rejected (`PAYMENTS_EXCEED_TOTAL`)
  - `createInvoice(orderId, ...)`:
    - derives `payment_status` from effective payments (`pending|partial|paid`)
    - no longer hardcodes invoice/order as `paid`
    - writes payment trace to `transactions` (`type='sale'`)
    - marks order `completed` only when payment is fully paid
  - `createManualInvoice(...)`:
    - same payment invariants as order-driven invoice
    - writes payment trace to `transactions`
    - conditionally escalates linked order status to `completed` only when fully paid

### Verified (Payment/Accounting Invariants Pass)
- Syntax checks passed:
  - `node --check packages/server/services/sales.service.js`
  - `node --check packages/server/controllers/salesController.js`
- Runtime boot check:
  - `npm -w @wsm/server run start` reached listening state (command timeout expected due long-running server process).

### Changed (P1.1 Client Return Approval Flow)
- `packages/server/services/warranties.service.js`
  - Added transactional `approveReturn(returnId, actorUserId)` with idempotency guards.
  - Added domain error model for predictable controller mapping.
  - Approval flow now executes atomically:
    - lock return + items (`FOR UPDATE`)
    - stock impact by item condition (`inventory` upsert + `inventory_movements`)
    - auto-generate linked credit note (`credit_notes`)
    - accounting trace in `transactions`
    - client current account balance adjustment
    - final status update to `approved`
- `packages/server/controllers/warrantiesController.js`
  - Replaced placeholder approve logic with service orchestration.
  - Added precise HTTP mapping by domain error (`not_found`, `already_approved`, `invalid_state`, etc.).
  - Added audit trace for `APPROVE_CLIENT_RETURN`.

### Verified (P1.1 Client Return Approval Flow)
- Syntax checks passed:
  - `node --check packages/server/services/warranties.service.js`
  - `node --check packages/server/controllers/warrantiesController.js`
- Runtime boot check:
  - `npm -w @wsm/server run start` reached listening state (command timeout expected due long-running server process).

### Changed (P1.2 Order State Machine)
- `packages/server/services/sales.service.js`
  - Added explicit order transition matrix with backend enforcement.
  - Added compatibility aliases for legacy statuses:
    - `confirmed` -> `picking`
    - `paid` -> `packed`
  - Added guarded transition API (`transitionOrderStatus`).
  - Added transition guards in:
    - `dispatchOrder`
    - `deliverOrder`
- `packages/server/controllers/salesController.js`
  - Switched `updateOrderStatus` to transition-aware backend flow.
  - Added explicit HTTP mapping for invalid transitions (`409`) and not found (`404`).

### Verified (P1.2 Order State Machine)
- Syntax checks passed:
  - `node --check packages/server/services/sales.service.js`
  - `node --check packages/server/controllers/salesController.js`
- Runtime boot check:
  - `npm -w @wsm/server run start` reached listening state (command timeout expected due long-running server process).

### Changed (P1.3 Concurrency-Safe Numbering)
- `packages/server/utils/documentSequence.js`
  - Added transactional sequence allocator (`nextDocumentSequence`) using row-level lock (`FOR UPDATE`).
- `packages/server/migrations/002_create_document_sequences.sql`
  - Added durable sequence store table (`document_sequences`).
- `packages/server/services/sales.service.js`
  - Invoice numbering migrated from `MAX+1` to transactional sequence scope (`invoice:{type}:{pos}`).
- `packages/server/controllers/procurementController.js`
  - PO/reception/supplier-return numbering migrated to transactional sequence scopes.
- `packages/server/services/warranties.service.js`
  - Credit note numbering in return approval migrated to transactional sequence scope.
- `packages/server/controllers/warrantiesController.js`
  - Manual credit note creation moved to explicit transaction + sequence allocator.
  - Added audit trace (`CREATE_CREDIT_NOTE`) for manual note creation.
- `packages/server/config/initDb.js`
  - Added `document_sequences` to required runtime table assertions.

### Verified (P1.3 Concurrency-Safe Numbering)
- Syntax checks passed:
  - `node --check packages/server/utils/documentSequence.js`
  - `node --check packages/server/services/sales.service.js`
  - `node --check packages/server/controllers/procurementController.js`
  - `node --check packages/server/services/warranties.service.js`
  - `node --check packages/server/controllers/warrantiesController.js`
  - `node --check packages/server/config/initDb.js`
- Runtime boot check:
  - `npm -w @wsm/server run start`
  - migration `002_create_document_sequences.sql` executed successfully.

### Changed (P1.4 Dynamic SQL Surface Hardening)
- `packages/server/services/sales.service.js`
  - Added strict allowlist sanitizer for orders sorting column.
  - `getOrders` no longer trusts raw `options.orderBy` interpolation.

### Verified (P1.4 Dynamic SQL Surface Hardening)
- Syntax check passed:
  - `node --check packages/server/services/sales.service.js`
- Runtime boot check:
  - `npm -w @wsm/server run start` reached listening state (command timeout expected due long-running server process).

### Changed (P1.5 Fiscal/Company Config Decoupling)
- `packages/server/controllers/settingsController.js`
  - Added shared mapper for company settings payloads.
  - Added `operation` fields in response and update flow:
    - `tax_rate`
    - `default_currency`
  - Added authenticated read-only profile handler for non-admin roles.
  - Update flow now preserves previous tax/currency when `operation` is omitted.
- `packages/server/routes/settingsRoutes.js`
  - Added `GET /api/settings/company/public` (authenticated, no admin role required).
- `packages/server/middleware/validationMiddleware.js`
  - Extended `companySettingsUpdate` schema with:
    - `operation.tax_rate`
    - `operation.default_currency`
- `packages/client/src/types/index.ts`
  - Extended `CompanySettings` with `operation` block.
- `packages/client/src/services/api.ts`
  - Added `api.getCompanyPublicProfile()`.
- `packages/client/src/lib/companySettings.ts`
  - Added centralized helper for:
    - default/fallback company settings
    - safe fetch with fallback to admin endpoint/defaults
    - tax/address/company-name formatting helpers
- `packages/client/src/pages/Invoices.tsx`
  - Replaced hardcoded CUIT/razon social/address/tax label in previews and print templates.
  - Manual invoice VAT default now derives from company settings tax rate.
- `packages/client/src/pages/POS.tsx`
  - Replaced hardcoded tax rate (`0.21`) with settings-backed `operation.tax_rate`.
  - Invoice creation lines now use dynamic VAT rate.
  - Replaced hardcoded legal/company print header fields with settings-backed values.
- `packages/client/src/pages/Orders.tsx`
  - Replaced hardcoded emitter identity in print template with settings-backed values.
  - Extended data load path to include company settings safe-fetch.
- `packages/client/src/pages/Settings.tsx`
  - System tab now derives default tax/currency from company settings.
  - Save System now persists tax/currency via `updateCompanySettings`.

### Verified (P1.5 Fiscal/Company Config Decoupling)
- Backend syntax checks passed:
  - `node --check packages/server/controllers/settingsController.js`
  - `node --check packages/server/routes/settingsRoutes.js`
  - `node --check packages/server/middleware/validationMiddleware.js`
- Frontend lint passed on touched files:
  - `npm -w @wsm/client exec eslint src/pages/Invoices.tsx src/pages/POS.tsx src/pages/Orders.tsx src/pages/Settings.tsx src/lib/companySettings.ts src/services/api.ts src/types/index.ts`
- Frontend typecheck passed:
  - `npm -w @wsm/client exec -- tsc --noEmit`

### Changed (P2.1 Contrast/Accessibility Pass - Receptions)
- `packages/client/src/pages/Receptions.tsx`
  - Increased table readability and contrast:
    - standardized high-contrast table header/body classes.
    - strengthened status badges (foreground/background/ring contrast).
  - Improved interaction accessibility:
    - added `focus-visible` ring styles on tabs, filters, and row action buttons.
  - Improved dense data legibility:
    - stronger font weight on key cells and progress labels.

### Verified (P2.1 Contrast/Accessibility Pass - Receptions)
- Frontend lint run over touched files:
  - `npm -w @wsm/client exec eslint src/pages/Receptions.tsx src/pages/Invoices.tsx src/pages/POS.tsx src/pages/Orders.tsx src/pages/Settings.tsx src/lib/companySettings.ts src/services/api.ts src/types/index.ts`
  - Result: no errors, 1 non-blocking warning (`react-hooks/exhaustive-deps` in `Receptions.tsx`).
- Frontend typecheck passed:
  - `npm -w @wsm/client exec -- tsc --noEmit`
