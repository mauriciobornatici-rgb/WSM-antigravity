import { describe, expect, it } from "vitest";
import type { TraceabilityEvent } from "@/services/api";
import {
    buildTraceabilityFilters,
    formatTraceabilityEventTitle,
    resolveTraceabilityLocation,
} from "./traceabilityUtils";

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
