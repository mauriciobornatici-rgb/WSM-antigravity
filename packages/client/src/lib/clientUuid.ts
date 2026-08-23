type BrowserCrypto = Pick<Crypto, "getRandomValues" | "randomUUID">;

function fillWithFallbackRandom(bytes: Uint8Array): void {
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
    }
}

function formatUuid(bytes: Uint8Array): string {
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Creates operational client-side IDs in secure and insecure browser contexts.
 * These IDs provide uniqueness, not cryptographic authentication.
 */
export function createClientUuid(cryptoApi: Partial<BrowserCrypto> | undefined = globalThis.crypto): string {
    if (typeof cryptoApi?.randomUUID === "function") {
        try {
            return cryptoApi.randomUUID();
        } catch {
            // Some browsers expose the method but reject it outside a secure context.
        }
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === "function") {
        try {
            cryptoApi.getRandomValues(bytes);
        } catch {
            fillWithFallbackRandom(bytes);
        }
    } else {
        fillWithFallbackRandom(bytes);
    }

    // RFC 4122 version 4 and variant bits.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    return formatUuid(bytes);
}
