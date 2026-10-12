import { describe, expect, it } from "vitest";
import {
    analyzeInventoryABC,
    calculateGrossMargin,
    type ProductAnalyticsInput,
} from "./inventoryAnalytics";

describe("inventoryAnalytics", () => {
    describe("calculateGrossMargin", () => {
        it("should calculate correct gross margin and markup", () => {
            const res = calculateGrossMargin(100, 150);
            expect(res.amount).toBe(50);
            expect(res.marginPercent).toBe(33.33);
            expect(res.markupPercent).toBe(50);
        });

        it("should handle zero cost without division by zero", () => {
            const res = calculateGrossMargin(0, 100);
            expect(res.amount).toBe(100);
            expect(res.marginPercent).toBe(100);
            expect(res.markupPercent).toBe(0);
        });

        it("should handle zero price without division by zero", () => {
            const res = calculateGrossMargin(100, 0);
            expect(res.amount).toBe(-100);
            expect(res.marginPercent).toBe(0);
            expect(res.markupPercent).toBe(-100);
        });
    });

    describe("analyzeInventoryABC", () => {
        it("should handle empty products list", () => {
            const res = analyzeInventoryABC([]);
            expect(res.items).toHaveLength(0);
            expect(res.summary.totalProductsCount).toBe(0);
            expect(res.summary.totalValuationCost).toBe(0);
        });

        it("should classify products into A, B and C tiers by cumulative stock value", () => {
            const mockProducts: ProductAnalyticsInput[] = [
                { id: "1", name: "Zapatillas Top", cost_price: 1000, sale_price: 1800, stock_current: 80 }, // 80,000 (80%)
                { id: "2", name: "Remera Running", cost_price: 100, sale_price: 200, stock_current: 150 },   // 15,000 (15%)
                { id: "3", name: "Medias Deportivas", cost_price: 20, sale_price: 50, stock_current: 250 },  // 5,000  (5%)
            ];

            const res = analyzeInventoryABC(mockProducts);

            expect(res.summary.totalValuationCost).toBe(100000);
            expect(res.summary.totalValuationSale).toBe(80 * 1800 + 150 * 200 + 250 * 50);
            expect(res.items).toHaveLength(3);

            // Item 1 represents 80% of value -> Class A
            expect(res.items[0]!.id).toBe("1");
            expect(res.items[0]!.abcClass).toBe("A");

            // Item 2 brings cumulative to 95% -> Class B
            expect(res.items[1]!.id).toBe("2");
            expect(res.items[1]!.abcClass).toBe("B");

            // Item 3 brings cumulative to 100% -> Class C
            expect(res.items[2]!.id).toBe("3");
            expect(res.items[2]!.abcClass).toBe("C");
        });

        it("keeps products without inventory value in class C", () => {
            const res = analyzeInventoryABC([
                { id: "1", name: "Sin costo", cost_price: 0, sale_price: 100, stock_current: 5 },
                { id: "2", name: "Sin stock", cost_price: 50, sale_price: 100, stock_current: 0 },
            ]);

            expect(res.items.every((item) => item.abcClass === "C")).toBe(true);
            expect(res.items.every((item) => item.cumulativeSharePercent === 0)).toBe(true);
            expect(res.summary.classACount).toBe(0);
            expect(res.summary.classCCount).toBe(2);
        });
    });
});
