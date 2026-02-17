/**
 * Centralized HTTP client with:
 * - Auth token injection
 * - 401 auto-logout
 * - Consistent error handling
 * - No silent failures (always throws)
 */

import { clearSessionStorage, getStoredToken, isTokenExpired } from "@/lib/authSession";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const getAuthToken = (): string | null => {
    const token = getStoredToken();
    if (!token) return null;
    if (isTokenExpired(token, 30_000)) {
        clearSessionStorage();
        return null;
    }
    return token;
};

/** Custom error class with HTTP status and parsed body */
export class ApiError extends Error {
    status: number;
    body: unknown;

    constructor(message: string, status: number, body?: unknown) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.body = body;
    }
}

export const isApiError = (error: unknown): error is ApiError =>
    error instanceof ApiError;

function getBodyMessage(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const payload = body as Record<string, unknown>;
    const message = payload.message;
    const error = payload.error;
    if (typeof message === "string" && message.trim().length > 0) return message;
    if (typeof error === "string" && error.trim().length > 0) return error;
    return null;
}

/**
 * Centralized fetch wrapper. All API calls go through here.
 * - Injects Authorization header automatically
 * - Handles 401 by clearing session and redirecting to login
 * - Parses JSON responses and throws typed ApiError on failure
 */
async function request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = getAuthToken();

    if (!token && !endpoint.endsWith("/login") && getStoredToken()) {
        clearSessionStorage();
        window.location.href = "/login";
        throw new ApiError("Sesion expirada", 401);
    }

    const headers: Record<string, string> = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    // Auto-logout on 401 Unauthorized (except login)
    if (res.status === 401 && !endpoint.endsWith("/login")) {
        clearSessionStorage();
        window.location.href = "/login";
        throw new ApiError("Sesion expirada", 401);
    }

    if (!res.ok) {
        let body: unknown;
        try {
            body = await res.json();
        } catch {
            body = { error: res.statusText };
        }
        const message = getBodyMessage(body) || `HTTP Error ${res.status}`;
        throw new ApiError(message, res.status, body);
    }

    // Handle 204 No Content
    if (res.status === 204) return undefined as T;

    return res.json() as Promise<T>;
}

// Convenience methods
export const httpClient = {
    get: <T = unknown>(endpoint: string) => request<T>(endpoint),

    post: <T = unknown>(endpoint: string, data?: unknown) =>
        request<T>(endpoint, {
            method: "POST",
            ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
        }),

    put: <T = unknown>(endpoint: string, data?: unknown) =>
        request<T>(endpoint, {
            method: "PUT",
            ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
        }),

    del: <T = unknown>(endpoint: string) =>
        request<T>(endpoint, { method: "DELETE" }),
};
