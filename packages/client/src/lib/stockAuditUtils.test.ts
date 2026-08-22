import { describe, expect, it } from "vitest"
import { stockAccuracyLevel, stockAuditScopeLabel, stockAuditStatusLabel } from "./stockAuditUtils"

describe("stockAuditUtils", () => {
    it("labels scopes and operational statuses", () => {
        expect(stockAuditScopeLabel("ALL")).toBe("Todas las clases")
        expect(stockAuditScopeLabel("A")).toBe("Clase A")
        expect(stockAuditStatusLabel("in_progress")).toBe("En conteo")
        expect(stockAuditStatusLabel("adjusted")).toBe("Ajustada")
    })

    it("grades inventory accuracy using operational thresholds", () => {
        expect(stockAccuracyLevel(99)).toBe("excellent")
        expect(stockAccuracyLevel(96)).toBe("warning")
        expect(stockAccuracyLevel(94.99)).toBe("critical")
        expect(stockAccuracyLevel(0)).toBe("empty")
        expect(stockAccuracyLevel(Number.NaN)).toBe("empty")
    })
})
