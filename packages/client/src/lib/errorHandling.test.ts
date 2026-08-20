import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/httpClient";
import { getErrorMessage } from "./errorHandling";

describe("getErrorMessage", () => {
    it("prioritizes the first Zod field detail over a generic validation message", () => {
        const error = new ApiError("Datos de entrada invalidos (Zod)", 400, {
            error: "validation_error",
            message: "Datos de entrada invalidos (Zod)",
            details: [{
                path: ["body", "variants", 0, "image_url"],
                message: "URL inválida",
            }],
        });

        expect(getErrorMessage(error)).toBe("variants.0.image_url: URL inválida");
    });
});
