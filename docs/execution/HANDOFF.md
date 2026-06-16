# Handoff Fast Resume

Last reviewed: 2026-06-15  
Primary continuity source: `docs/execution/BITACORA_INTEGRAL.md`  
Current score estimate: 88/100

## Resume First

Before implementing anything, read:
1. `docs/execution/BITACORA_INTEGRAL.md`
2. `docs/execution/STATE.md`
3. `docs/execution/CHANGELOG_EXECUTION.md`
4. `docs/execution/LOGICA_UX_REVIEW_2026-06-14.md`

Immediate next work should stay in P1/P2 stabilization:
- keep backend tests, frontend unit tests, frontend lint and frontend build green
- frontend timeline view is now available from `Inventario -> Trazabilidad`
- backend timeline now includes inventory, lots, series, audit, orders, invoices, client returns, warranties and supplier returns
- Tiendanube integration is now fully prepared for production/staging connection: OAuth state signed, HMAC webhook verify, API 2025-03, and failed syncs retry queue (A2) with automatic 5-min interval sweeps and settings retry console.
- latest logic/UX review says not to add broad new modules before validating traceability with real data and adding exception queues.

---

Last updated: 2026-02-22  
Branch: `main`  
Checkpoint commit: `7f92656`

## What Is Already Defined (Do Not Reopen)
1. Picking never closes automatically; operator must close explicitly.
2. Entering Picking from Orders does not auto-update status.
3. Picking close must use backend real status and valid transitions.
4. `packed` is shown operationally as:
   - `Listo para retiro` (pickup)
   - `Listo para envio` (delivery)
5. Order invoice issuance is decoupled from payment registration.
6. Issuing invoice from Orders does not auto-create payment transactions.
7. Invoice from order defaults to pending payment unless explicit payments are sent.
8. Later collections must support partial and mixed methods.

## Resume Priority
1. Validate in staging end-to-end:
   - pending -> picking -> packed (manual close)
   - packed visual status in Orders
   - invoice issuance without payment
2. Implement dedicated collection flow (current account):
   - select pending invoices
   - register one or many payment lines
   - allow partial payments
   - write transactions + update payment statuses
3. Add focused tests for the new collection flow.

## Quick Validation Commands
```bash
npm run validate
```

In this Codex environment, `npm` is not available in PATH. Use embedded Node and local binaries as documented in `BITACORA_INTEGRAL.md` if needed.

Traceability API:
```bash
GET /api/traceability/timeline?product_id=<id>&limit=100
GET /api/traceability/timeline?sku=<sku>&limit=100
GET /api/traceability/timeline?barcode=<barcode>&limit=100
```

Latest logic/UX priorities:
1. Validate Tiendanube against a real HTTPS staging backend.
2. Validate `Inventario -> Trazabilidad` with real product/SKU/barcode data.
3. Add direct "Ver trazabilidad" access from product rows.
4. Extend timeline with shipping/reception logistics events.

Tiendanube connection checklist:
- Backend public HTTPS URL required; webhooks cannot use localhost.
- Tiendanube callback URL: `https://<backend-publico>/api/integrations/tiendanube/callback`.
- Tiendanube webhook URL: `https://<backend-publico>/api/integrations/tiendanube/webhooks`.
- Minimum scopes: `read_orders`, `write_products`; recommended add `read_customers`.
- ERP settings must contain Client ID and Client Secret before pressing connect.
4. Make quality control visible before stock becomes available.
5. Add recovery queue for POS sales with invoice pending/error.
6. Build current-account workbench for collections and supplier payments.

## Detailed Context
- `docs/execution/STATE.md`
- `docs/execution/MASTER_PLAN.md`
- `docs/execution/CHANGELOG_EXECUTION.md`
