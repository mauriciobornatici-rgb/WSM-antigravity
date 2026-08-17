import { describe, it, expect } from "vitest";
import { formatMoney } from "./formatters";

describe("formatMoney", () => {
    it("should format positive integers with 2 decimals and dot thousands separator", () => {
        expect(formatMoney(15000)).toBe("$ 15.000,00");
        expect(formatMoney(1234567.89)).toBe("$ 1.234.567,89");
    });

    it("should format negative numbers correctly", () => {
        expect(formatMoney(-5000.5)).toBe("-$ 5.000,50");
    });

    it("should handle strings, null and undefined gracefully", () => {
        expect(formatMoney("2500")).toBe("$ 2.500,00");
        expect(formatMoney(null)).toBe("$ 0,00");
        expect(formatMoney(undefined)).toBe("$ 0,00");
        expect(formatMoney("invalid")).toBe("$ 0,00");
    });
});
