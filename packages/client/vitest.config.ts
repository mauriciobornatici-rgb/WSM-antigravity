/// <reference types="vitest" />
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@wsm/common": path.resolve(__dirname, "../common/src/index.ts"),
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: "./src/test/setup.ts",
        css: false,
        exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    },
})
