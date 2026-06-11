import { defineConfig } from "vitest/config"

// Single suite for the whole app — backend logic tests + frontend component
// tests — rooted at the project root so Vite can serve both trees.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "backend/**/*.test.ts",
      "shared/**/*.test.ts",
      "frontend/**/*.test.{ts,tsx}",
    ],
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
})
