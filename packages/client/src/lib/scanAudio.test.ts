import { describe, expect, it } from "vitest";
import { playScanErrorBeep, playScanSuccessBeep } from "./scanAudio";

describe("scanAudio", () => {
    it("runs playScanSuccessBeep without throwing", () => {
        expect(() => playScanSuccessBeep()).not.toThrow();
    });

    it("runs playScanErrorBeep without throwing", () => {
        expect(() => playScanErrorBeep()).not.toThrow();
    });
});
