import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

let originalLocationDescriptor: PropertyDescriptor | undefined

// --- ApiError class tests ---

describe("ApiError", () => {
    it("stores status, body, and message", async () => {
        const { ApiError } = await import("./httpClient")
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
        vi.resetModules()
        // Clear any stored token
        localStorage.clear()
        // Set VITE_API_URL for tests
        vi.stubEnv("VITE_API_URL", "http://localhost:3001")
        originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location")
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
        localStorage.clear()
        if (originalLocationDescriptor) {
            Object.defineProperty(window, "location", originalLocationDescriptor)
        }
        originalLocationDescriptor = undefined
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
        expect(fetch).toHaveBeenCalledWith(
            "http://localhost:3001/products",
            expect.objectContaining({ credentials: "include" })
        )
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

        const { ApiError, httpClient } = await import("./httpClient")

        await expect(httpClient.get("/bad")).rejects.toThrow(ApiError)
        await expect(httpClient.get("/bad")).rejects.toMatchObject({
            status: 422,
        })
    })

    it("uses a configured non-default API URL", async () => {
        vi.stubEnv("VITE_API_URL", "http://127.0.0.1:3001")
        const mockData = [{ id: 2, name: "Configured host" }]
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(mockData),
            })
        )

        const { httpClient } = await import("./httpClient")
        const result = await httpClient.get("/products")

        expect(fetch).toHaveBeenCalledWith(
            "http://127.0.0.1:3001/products",
            expect.objectContaining({ credentials: "include" })
        )
        expect(result).toEqual(mockData)
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

        try {
            const { httpClient } = await import("./httpClient")

            // Should throw ApiError (401) but NOT redirect
            await expect(httpClient.post("/login", {})).rejects.toThrow("invalid_credentials")
            expect(window.location.href).toBe("") // No redirect
        } finally {
            Object.defineProperty(window, "location", {
                configurable: true,
                value: originalLocation,
            })
        }
    })
})
