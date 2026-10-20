import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("api.createOnlineProduct", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.stubEnv("VITE_API_URL", "http://localhost:3001");
        localStorage.clear();
    });

    it("normalizes empty optional catalog fields before sending the contract", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ id: "family-1" }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const { api } = await import("./api");
        await api.createOnlineProduct({
            name: "Camiseta",
            description: " ",
            brand: " WSM ",
            category: "",
            visibility: "hidden",
            publish: false,
            variants: [{
                sku: " CAM-M-AZ ",
                barcode: "",
                size: " M ",
                color: " Azul ",
                sale_price: 45_000,
                purchase_price: 25_000,
                stock_initial: 3,
                image_url: "",
            }],
        });

        const call = fetchMock.mock.calls[0];
        expect(call).toBeDefined();
        const options = call?.[1] as RequestInit;
        const payload = JSON.parse(String(options.body));
        expect(payload).toMatchObject({
            description: null,
            brand: "WSM",
            category: null,
            variants: [{
                sku: "CAM-M-AZ",
                barcode: null,
                size: "M",
                color: "Azul",
                image_url: null,
            }],
        });
    });
});

describe("api Tiendanube technical configuration", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.stubEnv("VITE_API_URL", "http://localhost:3001");
        localStorage.clear();
    });

    it("reads and updates credentials through the dedicated integration contract", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ clientId: "app-1", clientSecretConfigured: true, locationId: "loc-1" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ clientId: "app-2", clientSecretConfigured: true, locationId: "loc-2" }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const { api } = await import("./api");
        await api.getTiendanubeConfig();
        await api.updateTiendanubeConfig({ clientId: "app-2", clientSecret: "new-secret", locationId: "loc-2" });

        expect(fetchMock).toHaveBeenNthCalledWith(1,
            "http://localhost:3001/api/integrations/tiendanube/config",
            expect.objectContaining({ headers: {} })
        );
        expect(fetchMock).toHaveBeenNthCalledWith(2,
            "http://localhost:3001/api/integrations/tiendanube/config",
            expect.objectContaining({ method: "PATCH" })
        );
        const updatePayload = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
        expect(updatePayload).toEqual({ clientId: "app-2", clientSecret: "new-secret", locationId: "loc-2" });
    });
});
