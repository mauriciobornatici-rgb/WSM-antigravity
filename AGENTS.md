# Project Agent Rules — WSM SportsERP

This file is the canonical operating agreement for AI agents in the WSM SportsERP monorepo. It aligns with `GEMINI.md` and provides shared governance across AI toolchains.

---

## 1. Context & Startup

Before modifying any file, verify:
1. `.agents/context/PROJECT.md` and `docs/execution/STATE.md`.
2. `.agents/context/TASKS.md` for active goals and next steps.
3. `.agents/context/QUALITY.md` for deterministic test and gate commands.
4. `.agents/context/BUDGET.yaml` for context economy and execution limits.

---

## 2. Monorepo Working Rules

- **Shared Types**: Always build `@wsm/common` (`npm run build:common`) when updating shared contracts, DTOs, or RBAC capabilities.
- **WMS Integrity**: Do not allow negative stock. Keep cyclic count blind until audit completion. Maintain full inventory transaction traceability.
- **Accounting Immutability**: No `DELETE` on posted ledger rows. All balance adjustments require traced counter-entries (*contra-asientos*).
- **Security & RBAC**: Auth tokens reside in HttpOnly cookies; verify capabilities using the shared RBAC matrix.
- **Deterministic Gates**: Run `npm run validate` and `npm run preflight:integrity` prior to task completion.

---

## 3. Autonomy Boundaries

- Free to inspect, edit scoped files, run local tests/lints, and update `.agents/context/TASKS.md`.
- Requires user approval for database schema migrations, external API production calls (ARCA, Tiendanube), destructive git actions, or changes to constitutional rules.

---

## 4. Completion Evidence

A task is done only when:
- Acceptance criteria are verifiably demonstrated.
- `npm run validate` and applicable smoke tests pass.
- `.agents/context/TASKS.md` is updated for immediate resumption.
