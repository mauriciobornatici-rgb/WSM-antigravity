import { describe, expect, it } from "vitest";
import type { Order } from "@/types";
import {
    itemIsComplete,
    itemIsPartial,
    itemRemainingQuantity,
    orderHasShortage,
    orderMissingQuantity,
    orderPickedQuantity,
    orderTotalQuantity,
    sortItemsByLocation,
} from "./pickingUtils";

describe("pickingUtils", () => {
    const sampleOrder: Order = {
        id: "ord-1",
        customer_name: "Cliente Test",
        total_amount: 1000,
        status: "picking",
        payment_status: "pending",
        payment_method: "cash",
        created_at: "2026-06-15",
        items: [
            {
                id: "item-1",
                product_id: "prod-1",
                product_name: "Camiseta",
                sku: "CAM-01",
                quantity: 5,
                picked_quantity: 3,
                location: "A-01",
                unit_price: 100,
            },
            {
                id: "item-2",
                product_id: "prod-2",
                product_name: "Shorts",
                sku: "SHO-02",
                quantity: 2,
                picked_quantity: 2,
                location: "B-05",
                unit_price: 250,
            },
        ],
    };

    it("calculates orderTotalQuantity correctly", () => {
        expect(orderTotalQuantity(sampleOrder)).toBe(7);
    });

    it("calculates orderPickedQuantity correctly", () => {
        expect(orderPickedQuantity(sampleOrder)).toBe(5);
    });

    it("calculates orderMissingQuantity correctly", () => {
        expect(orderMissingQuantity(sampleOrder)).toBe(2);
        expect(orderHasShortage(sampleOrder)).toBe(true);
    });

    it("evaluates item completion and partial flags", () => {
        const item1 = sampleOrder.items[0];
        const item2 = sampleOrder.items[1];
        expect(item1).toBeDefined();
        expect(item2).toBeDefined();

        if (item1 && item2) {
            expect(itemRemainingQuantity(item1)).toBe(2);
            expect(itemIsPartial(item1)).toBe(true);
            expect(itemIsComplete(item1)).toBe(false);

            expect(itemRemainingQuantity(item2)).toBe(0);
            expect(itemIsPartial(item2)).toBe(false);
            expect(itemIsComplete(item2)).toBe(true);
        }
    });

    it("sorts items by location", () => {
        const sortedDesc = sortItemsByLocation(sampleOrder, true);
        expect(sortedDesc.items[0]?.location).toBe("B-05");
        expect(sortedDesc.items[1]?.location).toBe("A-01");

        const sortedAsc = sortItemsByLocation(sampleOrder, false);
        expect(sortedAsc.items[0]?.location).toBe("A-01");
        expect(sortedAsc.items[1]?.location).toBe("B-05");
    });
});
