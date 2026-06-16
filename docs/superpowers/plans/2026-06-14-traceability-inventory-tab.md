# Traceability Inventory Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product traceability visible in the frontend from the inventory workflow.

**Architecture:** Add a focused traceability panel component under inventory/product components. Keep API access through the existing `api.traceability.getTimeline` method and add small pure helpers for filter building and event labels so the behavior is testable without browser coupling.

**Tech Stack:** React, TypeScript, Vite, Vitest, existing shadcn-like UI components, existing HTTP API service.

---

### Task 1: Traceability Helpers

**Files:**
- Create: `packages/client/src/components/products/traceabilityUtils.ts`
- Test: `packages/client/src/components/products/traceabilityUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { TraceabilityEvent } from "@/services/api";
import { buildTraceabilityFilters, formatTraceabilityEventTitle, resolveTraceabilityLocation } from "./traceabilityUtils";

describe("traceabilityUtils", () => {
    it("builds filters for sku, barcode and product id searches", () => {
        expect(buildTraceabilityFilters("SKU-001", "sku")).toEqual({ sku: "SKU-001", limit: 100 });
        expect(buildTraceabilityFilters("779123", "barcode")).toEqual({ barcode: "779123", limit: 100 });
        expect(buildTraceabilityFilters("product-1", "product_id")).toEqual({ product_id: "product-1", limit: 100 });
        expect(buildTraceabilityFilters("   ", "sku")).toEqual(null);
    });

    it("formats titles and locations for inventory movement events", () => {
        const event: TraceabilityEvent = {
            id: "evt-1",
            occurred_at: "2026-06-14T12:00:00.000Z",
            event_type: "inventory_movement",
            title: "",
            description: "Ingreso por recepción",
            product_id: "product-1",
            product_name: "Botines",
            sku: "BOT-1",
            quantity: 3,
            from_location: "Recepción",
            to_location: "A1",
            reference_type: "reception",
            reference_id: "rec-1",
            actor_name: "Admin",
            source_table: "inventory_movements",
        };

        expect(formatTraceabilityEventTitle(event)).toBe("Movimiento de inventario");
        expect(resolveTraceabilityLocation(event)).toBe("Recepción -> A1");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `..\..\node_modules\.bin\vitest.cmd run src\components\products\traceabilityUtils.test.ts` from `packages/client`.

Expected: FAIL because `traceabilityUtils.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create helpers that trim input, map the selected search mode to the existing API filters, format known event types, and render origin/destination locations.

- [ ] **Step 4: Run test to verify it passes**

Run the same Vitest command.

Expected: PASS.

### Task 2: Traceability Panel Component

**Files:**
- Create: `packages/client/src/components/products/TraceabilityPanel.tsx`
- Modify: `packages/client/src/pages/Inventory.tsx`

- [ ] **Step 1: Implement component**

Create a panel with:
- search mode select: SKU, codigo de barras, ID producto
- search input
- submit button
- result timeline
- empty, loading, no-results and error states

- [ ] **Step 2: Integrate with inventory**

Add a `Trazabilidad` tab in `Inventory.tsx` and render `TraceabilityPanel`.

- [ ] **Step 3: Validate**

Run client lint, tests, TypeScript build and Vite build.

### Task 3: Continuity Docs

**Files:**
- Modify: `docs/execution/BITACORA_INTEGRAL.md`
- Modify: `docs/execution/STATE.md`
- Modify: `docs/execution/HANDOFF.md`
- Modify: `docs/execution/CHANGELOG_EXECUTION.md`

- [ ] **Step 1: Document change**

Record that frontend traceability is now visible from inventory and update the next priority to extending timeline sources.

- [ ] **Step 2: Validate docs do not claim unverified behavior**

Only mention validations actually run in this session.
