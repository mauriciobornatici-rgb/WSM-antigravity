# Tiendanube Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare WSM SportsERP to connect safely to a real Tiendanube store.

**Architecture:** Keep Tiendanube-specific behavior inside `tiendanube.service.js`, with controllers delegating OAuth/webhook orchestration. Persist external order references and webhook events so import and webhook processing are idempotent.

**Tech Stack:** Node.js, Express, MySQL migrations, node:test, axios, React/Vite only if UI copy needs small adjustments.

---

### Task 1: Credential Settings Contract

**Files:**
- Modify: `packages/server/middleware/validationMiddleware.js`
- Test: `packages/server/test/settings.validation.test.js`

- [x] Write a failing test proving `companySettingsUpdate` keeps `body.integrations.tiendanube_client_id`, `tiendanube_client_secret`, `tiendanube_access_token`, and `tiendanube_store_id`.
- [x] Run `node --test test/settings.validation.test.js`; expected failure because `integrations` is stripped today.
- [x] Add the `integrations` Joi object to `companySettingsUpdate`.
- [x] Re-run focused test; expected pass.

### Task 2: Tiendanube Service API Contract

**Files:**
- Modify: `packages/server/services/tiendanube.service.js`
- Test: `packages/server/test/tiendanube.service.test.js`

- [x] Write failing tests for API base URL `https://api.tiendanube.com/2025-03/{store_id}`, `Authorization: Bearer`, `User-Agent`, and stock endpoint `POST /products/{product_id}/variants/stock`.
- [x] Run focused test; expected failure because current code uses `v1`, `Authentication`, and variant PUT.
- [x] Implement constructor dependency injection for DB/http/env and update request builder.
- [x] Re-run focused test; expected pass.

### Task 3: OAuth State And HMAC

**Files:**
- Modify: `packages/server/services/tiendanube.service.js`
- Modify: `packages/server/controllers/integrationController.js`
- Test: `packages/server/test/tiendanube.service.test.js`

- [x] Write failing tests for signed OAuth state round-trip and rejected tampered state.
- [x] Write failing tests for webhook HMAC valid/invalid verification.
- [x] Implement `createOAuthState`, `verifyOAuthState`, and `verifyWebhookSignature`.
- [x] Update authorize/callback controller to include and validate `state`.
- [x] Re-run focused test; expected pass.

### Task 4: Persistence For Idempotency

**Files:**
- Create: `packages/server/migrations/019_add_tiendanube_integration_state.sql`
- Modify: `packages/server/services/sales.service.js`
- Test: `packages/server/test/sales.service.test.js`

- [x] Write a failing test proving `createOrder` can persist `external_source` and `external_id`.
- [x] Run focused test; expected failure because insert has no external columns.
- [x] Add migration for `orders.external_source`, `orders.external_id`, and `tiendanube_webhook_events`.
- [x] Update `createOrder` insert to include external fields.
- [x] Re-run focused test; expected pass.

### Task 5: Webhook Processing By Order ID

**Files:**
- Modify: `packages/server/services/tiendanube.service.js`
- Modify: `packages/server/controllers/integrationController.js`
- Modify: `packages/server/routes/integrationRoutes.js`
- Modify: `packages/server/index.js`
- Test: `packages/server/test/tiendanube.service.test.js`

- [x] Write failing test proving webhook payload `{ store_id, event: "order/created", id }` fetches the full order and calls `salesService.createOrder` with external refs.
- [x] Write failing test proving duplicate webhook is skipped.
- [x] Capture raw request body in Express JSON parser for Tiendanube webhook routes.
- [x] Implement webhook controller signature verification and service processing.
- [x] Re-run focused test; expected pass.

### Task 6: Documentation And Validation

**Files:**
- Modify: `.env.example`
- Modify: `docs/execution/BITACORA_INTEGRAL.md`
- Modify: `docs/execution/STATE.md`
- Modify: `docs/execution/HANDOFF.md`
- Modify: `docs/execution/CHANGELOG_EXECUTION.md`

- [x] Document required Tiendanube app URLs, scopes, public HTTPS webhook base URL, and env values.
- [x] Run backend focused tests.
- [x] Run full backend tests.
- [x] If UI files changed, run frontend lint/tests/build.
