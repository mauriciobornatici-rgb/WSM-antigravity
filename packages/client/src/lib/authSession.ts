const AUTH_STORAGE_KEY = "sports_erp_auth";
const USER_STORAGE_KEY = "sports_erp_user";

interface TokenPayload {
    exp?: number;
}

function decodeBase64Url(value: string): string {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return atob(padded);
}

function parseTokenPayload(token: string): TokenPayload | null {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    if (!payloadPart) return null;

    try {
        const rawPayload = decodeBase64Url(payloadPart);
        const parsed = JSON.parse(rawPayload) as TokenPayload;
        if (!parsed || typeof parsed !== "object") return null;
        return parsed;
    } catch {
        return null;
    }
}

export function getStoredToken(): string | null {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;

    try {
        const parsed = JSON.parse(stored) as { token?: string };
        return typeof parsed.token === "string" && parsed.token.length > 0
            ? parsed.token
            : null;
    } catch {
        return null;
    }
}

export function isTokenExpired(token: string, leewayMs = 0): boolean {
    const payload = parseTokenPayload(token);
    if (!payload || typeof payload.exp !== "number") return false;
    return Date.now() + leewayMs >= payload.exp * 1000;
}

export function clearSessionStorage(): void {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
}

export { AUTH_STORAGE_KEY, USER_STORAGE_KEY };
