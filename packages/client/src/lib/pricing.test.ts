import { describe, expect, it } from "vitest"
import { grossLineTotal, grossPrice, lineAmounts, netForTypedFinalPrice, netFromGross, vatRateOf } from "./pricing"

describe("pricing (ADR-015: shown VAT-included, stored net)", () => {
    it("a final price round-trips exactly through the stored net price", () => {
        for (const finalPrice of [59999, 10000, 15000, 1, 0.99, 123456.78, 4999.5]) {
            expect(grossPrice(netFromGross(finalPrice))).toBe(finalPrice)
        }
    })

    it("the line total is quantity × final price, and VAT is gross − net", () => {
        const net = netFromGross(59999)
        const line = lineAmounts(3, net)
        expect(line.gross).toBe(179997)
        expect(line.vat).toBe(Math.round((line.gross - line.net) * 100) / 100)
        expect(grossLineTotal(2, 50000)).toBe(121000)
    })

    it("an untouched final price keeps the stored net; an edited one is converted to net", () => {
        expect(netForTypedFinalPrice(1000, 826.4463)).toBe(826.4463)
        expect(netForTypedFinalPrice(2420, 826.4463)).toBe(2000)
        expect(netForTypedFinalPrice(1210, null)).toBe(1000)
    })

    it("uses the product rate and defaults to 21%", () => {
        expect(vatRateOf(null)).toBe(21)
        expect(vatRateOf("10.5")).toBe(10.5)
        expect(grossPrice(1000, 10.5)).toBe(1105)
        expect(grossPrice(1000)).toBe(1210)
    })
})
