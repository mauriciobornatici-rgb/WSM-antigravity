import { describe, expect, it } from "vitest";
import { daysAgoInArgentina, formatArgentinaDate, parseArgentinaDate, todayInArgentina } from "./argentinaDate";

describe("fechas en hora argentina", () => {
    it("a las 22 h de Argentina (01 h UTC del día siguiente) hoy sigue siendo el mismo día", () => {
        const now = new Date("2026-10-22T01:00:00Z");
        expect(todayInArgentina(now)).toBe("2026-10-21");
        expect(daysAgoInArgentina(30, now)).toBe("2026-09-21");
        expect(daysAgoInArgentina(21, now)).toBe("2026-09-30");
    });

    it("formatea y lee fechas dd/mm/aaaa", () => {
        expect(formatArgentinaDate("2026-10-21")).toBe("21/10/2026");
        expect(parseArgentinaDate("21/10/26")).toBe("2026-10-21");
        expect(parseArgentinaDate("31/02/2026")).toBeNull();
    });
});
