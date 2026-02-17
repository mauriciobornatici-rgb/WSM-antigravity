import { describe, it, expect, vi, beforeEach } from "vitest"
import { ApiError } from "./httpClient"

// --- ApiError class tests ---

describe("ApiError", () => {
    it("stores status, body, and message", () => {
        const err = new ApiError("Not Found", 404, { error: "not_found" })

        expect(err).toBeInstanceOf(Error)
        expect(err.status).toBe(404)
        expect(err.body).toEqual({ error: "not_found" })
        expect(err.message).toBe("Not Found")
    })
})

// --- httpClient.get tests (mocked fetch) ---

describe("httpClient.get", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        // Clear any stored token
        localStorage.clear()
        // Set VITE_API_URL for tests
        vi.stubEnv("VITE_API_URL", "http://localhost:3001")
    })

    it("makes a GET request and returns parsed JSON", async () => {
        const mockData = [{ id: 1, name: "Product A" }]
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockData),
            })
        )

        // Dynamic import to pick up the stubbed env
        const { httpClient } = await import("./httpClient")
        const result = await httpClient.get("/products")

        expect(fetch).toHaveBeenCalledOnce()
        expect(result).toEqual(mockData)
    })

    it("throws ApiError on non-ok response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 422,
                json: () => Promise.resolve({ message: "Validation failed" }),
            })
        )

        const { httpClient } = await import("./httpClient")

        await expect(httpClient.get("/bad")).rejects.toThrow(ApiError)
        await expect(httpClient.get("/bad")).rejects.toMatchObject({
            status: 422,
        })
    })

    it("does not auto-logout on 401 from /login", async () => {
        // Mock window.location using Object.defineProperty to avoid TS errors
        const originalLocation = window.location

        // Create a mock location object
        const mockLocation = { href: "" }

        Object.defineProperty(window, "location", {
            configurable: true,
            value: mockLocation,
        })

        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                statusText: "Unauthorized",
                json: () => Promise.resolve({ error: "invalid_credentials" }),
            })
        )

        const { httpClient } = await import("./httpClient")

        // Should throw ApiError (401) but NOT redirect
        await expect(httpClient.post("/login", {})).rejects.toThrow("invalid_credentials")
        expect(window.location.href).toBe("") // No redirect

        // Cleanup
        Object.defineProperty(window, "location", {
            configurable: true,
            value: originalLocation,
        })
    })
})
