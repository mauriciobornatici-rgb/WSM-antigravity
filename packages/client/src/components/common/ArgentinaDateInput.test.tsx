import { describe, expect, it } from "vitest";

import { formatArgentinaDate, parseArgentinaDate } from "@/lib/argentinaDate";

describe("ArgentinaDateInput helpers", () => {
    it("formats ISO dates without timezone conversion", () => {
        expect(formatArgentinaDate("2026-08-21")).toBe("21/08/2026");
        expect(formatArgentinaDate("2026-08-21T23:30:00.000Z")).toBe("21/08/2026");
    });

    it("parses four and two digit Argentine years", () => {
        expect(parseArgentinaDate("21/08/2026")).toBe("2026-08-21");
        expect(parseArgentinaDate("21/08/26")).toBe("2026-08-21");
    });

    it("rejects impossible or foreign-order dates", () => {
        expect(parseArgentinaDate("31/02/2026")).toBeNull();
        expect(parseArgentinaDate("2026-08-21")).toBeNull();
    });
});
