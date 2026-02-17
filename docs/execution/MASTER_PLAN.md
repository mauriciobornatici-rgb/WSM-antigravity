# WSM SportsERP - Master Execution Plan (Living Document)

Last updated: 2026-02-17
Owner: Codex + Mauri
Environment: Staging

## Objective
Stabilize and modernize the app to production-grade quality ("10/10") with strict security, integrity, architecture, UX, and DevEx standards.

## Working Rules
- Do not advance to next block until acceptance criteria of current block is met.
- Every change must update:
  - `docs/execution/CHANGELOG_EXECUTION.md`
  - `docs/execution/STATE.md`
- No destructive migrations without rollback plan.
- Prefer transactional, typed, testable, and observable implementations.

## Priority Blocks

### Block P0 - Safety and Integrity First
- [x] Stored XSS removal in credit note print flow.
- [x] Sales stock integrity (atomic check + reservation/deduction policy).
- [x] Unify inventory source of truth (`inventory` vs `products.stock_current`).
- [x] Deterministic DB bootstrap/migrations for all required tables.
- [x] Startup hardening: await DB init before `listen`.
- [x] Environment hardening (staging/prod mode discipline).
- [x] MySQL TLS support for remote DB.
- [x] Payment/accounting invariants in invoice/order flows.

### Block P1 - Business Consistency
- [x] Complete client return approval flow (stock + credit note + accounting trace).
- [x] Enforce order status transition state machine.
- [x] Robust numbering strategy under concurrency (invoice/PO/reception/credit note).
- [x] Remove remaining dynamic SQL surfaces in sales ordering helpers.
- [x] Fiscal/company config decoupling from hardcoded frontend constants.

### Block P2 - Frontend Reliability and UX
1. Contrast/accessibility pass and visual consistency.
2. Replace fake data/simulations with real data or explicit feature flags.
3. Uniform async error handling and loading states.
4. Incremental React Query adoption in data-heavy screens.
5. Decompose oversized pages into maintainable feature modules.
6. Fix mojibake/encoding issues in UI text.

### Block P3 - Delivery Quality
1. CI pipeline.
2. Test strategy:
  - Backend unit/integration for critical flows.
  - Frontend component/integration for key screens.
  - E2E smoke for login/order/invoice/reception.
3. Release checklist and runbook.

## Acceptance Criteria by Block

### P0 done when
- No `document.write` with unsanitized data in app prints.
- Oversell attempts are blocked atomically at backend.
- Inventory and product stock semantics are explicit and consistent.
- Fresh environment boots without manual SQL hand-editing.
- Server does not accept traffic before DB init success.
- Staging/production does not expose dev-only internals.
- Remote DB connection can enforce TLS.
- Invoice/payment persistence follows accounting invariants.

### P1 done when
- Return approval is fully transactional and traceable.
- Invalid status transitions are rejected with clear errors.
- Number sequences are unique and monotonic per document scope.
- Fiscal identity/tax source is centralized in settings.

### P2 done when
- WCAG-level contrast in core workflows.
- No critical fake operational data.
- Standardized error/loading UX in all key pages.

### P3 done when
- CI gates regression.
- Critical paths have automated coverage.
