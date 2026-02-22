# Handoff Fast Resume

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
npm -w @wsm/server run test
npm -w @wsm/client run lint
npm -w @wsm/client run build
```

## Detailed Context
- `docs/execution/STATE.md`
- `docs/execution/MASTER_PLAN.md`
- `docs/execution/CHANGELOG_EXECUTION.md`
