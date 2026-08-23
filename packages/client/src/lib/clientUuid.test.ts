import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientUuid } from "./clientUuid";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createClientUuid", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses the native implementation when it is available", () => {
        const nativeUuid = "123e4567-e89b-42d3-a456-426614174000" as `${string}-${string}-${string}-${string}-${string}`;
        const randomUUID = vi.fn(() => nativeUuid);

        expect(createClientUuid({ randomUUID })).toBe(nativeUuid);
        expect(randomUUID).toHaveBeenCalledOnce();
    });

    it("creates a valid UUID with getRandomValues when randomUUID is unavailable", () => {
        const getRandomValues = vi.fn((bytes: Uint8Array) => {
            bytes.fill(0xab);
            return bytes;
        });

        const uuid = createClientUuid({ getRandomValues: getRandomValues as Crypto["getRandomValues"] });

        expect(uuid).toMatch(UUID_V4_PATTERN);
        expect(getRandomValues).toHaveBeenCalledOnce();
    });

    it("still creates a valid UUID when the Crypto API is unavailable", () => {
        vi.spyOn(Math, "random").mockReturnValue(0.25);

        expect(createClientUuid({})).toMatch(UUID_V4_PATTERN);
    });
});
