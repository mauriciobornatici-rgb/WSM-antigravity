import { describe, expect, it, vi } from "vitest";
import { bankChargesTotal, hasIncompleteBankCharges, toBankChargesPayload } from "@/components/accounting/BankChargesEditor";

vi.mock("@/services/api", () => ({
    api: { getVatRates: vi.fn().mockResolvedValue([]) },
}));

describe("bank charges helpers", () => {
    it("adds up the debits to the cent and ignores empty lines", () => {
        expect(bankChargesTotal([])).toBe(0);
        expect(bankChargesTotal([
            { concept: "commission", amount: 0.1 },
            { concept: "maintenance", amount: 0.2 },
            { concept: "other", amount: 0 },
        ])).toBe(0.3);
    });

    it("flags lines without a positive amount", () => {
        expect(hasIncompleteBankCharges([{ concept: "commission", amount: 10 }])).toBe(false);
        expect(hasIncompleteBankCharges([{ concept: "commission", amount: 10 }, { concept: "other", amount: 0 }])).toBe(true);
    });

    it("omits blank notes from the payload", () => {
        expect(toBankChargesPayload([{ concept: "other", amount: 5, notes: "  " }])).toEqual([{ concept: "other", amount: 5 }]);
        expect(toBankChargesPayload([{ concept: "other", amount: 5, notes: " Mantenimiento " }])).toEqual([
            { concept: "other", amount: 5, notes: "Mantenimiento" },
        ]);
    });
});
