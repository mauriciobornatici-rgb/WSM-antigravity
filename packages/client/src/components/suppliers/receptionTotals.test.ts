import { describe, expect, it } from "vitest";
import { invoiceLines, netByRate, receptionNet, receptionPendingNet, receptionsNetTotal, sharedPurchaseOrderId } from "./receptionTotals";

describe("líneas de factura por remito (ADR-028)", () => {
    const reception = {
        id: "r1",
        remito_number: "0001-1",
        reception_number: "REC-1",
        items: [
            { id: "a", product_name: "Pelota", vat_rate: 21, quantity_to_invoice: 4, unit_cost: "33.33" },
            { id: "b", product_name: "Red", vat_rate: "10.5", quantity_to_invoice: 2, unit_cost: 50 },
            { id: "c", product_name: "Facturado", vat_rate: 21, quantity_to_invoice: 0, unit_cost: 9 },
        ],
    };
    const receptions = [reception];

    it("propone todo lo pendiente al costo del remito y solo muestra lo que falta facturar", () => {
        const lines = invoiceLines(receptions, {});
        expect(lines.map((line) => [line.id, line.units, line.cost, line.netCents, line.receptionLabel])).toEqual([
            ["a", 4, 33.33, 13332, "0001-1"],
            ["b", 2, 50, 10000, "0001-1"],
        ]);
        expect(netByRate(lines)).toEqual([{ rate: 21, netCents: 13332 }, { rate: 10.5, netCents: 10000 }]);
        expect(receptionPendingNet(reception)).toBe(233.32);
    });

    it("usa lo cargado, no cuenta las líneas en 0 y marca lo inválido", () => {
        const lines = invoiceLines(receptions, {
            a: { quantity: "3", unitCost: "40" },
            b: { quantity: "0", unitCost: "50" },
        });
        expect(lines.find((line) => line.id === "a")?.netCents).toBe(12000);
        expect(lines.find((line) => line.id === "a")?.remitoCents).toBe(9999);
        // A price with 3 decimals, as printed: 10 × 12,345 = 123,45 (not 10 × 12,35).
        const printed = invoiceLines([{ ...reception, items: [{ id: "x", quantity_to_invoice: 10, unit_cost: 12 }] }], { x: { quantity: "10", unitCost: "12.345" } });
        expect(printed[0]?.netCents).toBe(12345);
        expect(netByRate(lines)).toEqual([{ rate: 21, netCents: 12000 }]);

        const invalid = invoiceLines(receptions, { a: { quantity: "5", unitCost: "1" }, b: { quantity: "1.5", unitCost: "-1" } });
        expect(invalid.map((line) => [line.quantityValid, line.costValid, line.valid, line.netCents])).toEqual([
            [false, true, false, 0],
            [false, false, false, 0],
        ]);
    });
});

describe("receptionTotals", () => {
    it("suma cantidad recibida por costo unitario", () => {
        expect(receptionNet({ items: [{ quantity_received: 3, unit_cost: 10.5 }, { quantity_received: "2", unit_cost: "4" }] })).toBe(39.5);
        expect(receptionNet({})).toBe(0);
    });

    it("suma el neto de varios remitos", () => {
        const total = receptionsNetTotal([
            { items: [{ quantity_received: 1, unit_cost: 0.1 }] },
            { items: [{ quantity_received: 1, unit_cost: 0.2 }] },
        ]);
        expect(total).toBe(0.3);
    });

    it("devuelve la orden de compra solo si es común a todos", () => {
        expect(sharedPurchaseOrderId([{ purchase_order_id: "po-1" }, { purchase_order_id: "po-1" }])).toBe("po-1");
        expect(sharedPurchaseOrderId([{ purchase_order_id: "po-1" }, { purchase_order_id: "po-2" }])).toBe("");
        expect(sharedPurchaseOrderId([{ purchase_order_id: "po-1" }, {}])).toBe("");
        expect(sharedPurchaseOrderId([])).toBe("");
    });
});
