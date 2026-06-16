import { beforeEach, describe, expect, it, vi } from "vitest";

describe("api.inventory.bulkUpdateTiendaNube", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.stubEnv("VITE_API_URL", "http://localhost:3001");
        localStorage.clear();
    });

    it("posts product sync settings to the backend inventory route", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ success: true }),
            })
        );

        const { api } = await import("./api");

        await api.inventory.bulkUpdateTiendaNube([
            {
                id: "product-1",
                tiendanube_sync_enabled: true,
                tiendanube_product_id: "tn-product-1",
                tiendanube_variant_id: "tn-variant-1",
            },
        ]);

        expect(fetch).toHaveBeenCalledWith(
            "http://localhost:3001/api/products/tiendanube/bulk-update",
            expect.objectContaining({ method: "POST" })
        );
    });
});

describe("api.traceability.getTimeline", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.stubEnv("VITE_API_URL", "http://localhost:3001");
        localStorage.clear();
    });

    it("requests the product traceability timeline with query filters", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve([]),
            })
        );

        const { api } = await import("./api");

        await api.traceability.getTimeline({ product_id: "product-1", limit: 25 });

        expect(fetch).toHaveBeenCalledWith(
            "http://localhost:3001/api/traceability/timeline?product_id=product-1&limit=25",
            expect.objectContaining({ headers: {} })
        );
    });
});
