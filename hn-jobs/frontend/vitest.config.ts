import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
})
