import { defineConfig } from "vitest/config"

declare const process: { env: Record<string, string | undefined> }

const cacheDir = process.env["LOGOS_VITEST_CACHE_DIR"]

export default defineConfig({
  ...(cacheDir ? { cacheDir } : {}),
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "storybook-static", "test-results", "**/*.e2e.test.ts"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
})
