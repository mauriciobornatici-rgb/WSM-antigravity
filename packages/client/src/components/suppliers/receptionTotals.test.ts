import { describe, expect, it } from "vitest";
import { receptionNet, receptionsNetTotal, sharedPurchaseOrderId } from "./receptionTotals";

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
