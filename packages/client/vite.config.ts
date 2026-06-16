import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@wsm/common": path.resolve(__dirname, "../common/src/index.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
