import { describe, it, expect } from "vitest";
import { formatPosExceptionDetail, formatPosExceptionTypeLabel } from "./posExceptions";

describe("formatPosExceptionTypeLabel", () => {
    it("labels price exceptions", () => {
        expect(formatPosExceptionTypeLabel("price")).toBe("Precio distinto");
    });

    it("labels stock shortage exceptions", () => {
        expect(formatPosExceptionTypeLabel("stock_shortage")).toBe("Faltante de stock");
    });
});

describe("formatPosExceptionDetail", () => {
    it("formats price exception lines with catalog vs charged price", () => {
        const result = formatPosExceptionDetail({
            type: "price",
            details: {
                source: "offline_pos",
                role: "cashier",
                lines: [{ product_id: "prod-1", catalog_price: 1000, unit_price: 800 }],
            },
        });
        expect(result).toBe("Producto prod-1: catálogo $ 1.000,00 vs. cobrado $ 800,00");
    });

    it("resolves product name when a lookup map is provided", () => {
        const result = formatPosExceptionDetail(
            {
                type: "price",
                details: {
                    source: "offline_pos",
                    lines: [{ product_id: "prod-1", catalog_price: 1000, unit_price: 800 }],
                },
            },
            { "prod-1": "Zapatillas Running" }
        );
        expect(result).toBe("Zapatillas Running: catálogo $ 1.000,00 vs. cobrado $ 800,00");
    });

    it("formats stock shortage exception lines", () => {
        const result = formatPosExceptionDetail({
            type: "stock_shortage",
            details: {
                offline_captured_at: "2026-01-01T00:00:00Z",
                lines: [{ product_id: "prod-2", requested: 5, shortage: 2 }],
            },
        });
        expect(result).toBe("Producto prod-2: faltaron 2 de 5 unidades");
    });

    it("truncates long product ids when no name is resolvable", () => {
        const result = formatPosExceptionDetail({
            type: "stock_shortage",
            details: { lines: [{ product_id: "abcdefghijklmnop", requested: 3, shortage: 1 }] },
        });
        expect(result).toBe("Producto abcdefgh…: faltaron 1 de 3 unidades");
    });

    it("handles missing or empty detail lines gracefully", () => {
        expect(formatPosExceptionDetail({ type: "price", details: { source: "offline_pos", lines: [] } })).toBe(
            "Sin detalle de precios"
        );
        expect(
            formatPosExceptionDetail({ type: "stock_shortage", details: { lines: [] } })
        ).toBe("Sin detalle de faltantes");
    });
});
