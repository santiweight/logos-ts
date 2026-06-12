import { defineConfig } from "vitest/config"
import type { Plugin } from "vite"

function nodeSqlitePlugin(): Plugin {
  return {
    name: "node-sqlite-external",
    enforce: "pre",
    resolveId(source) {
      if (source === "node:sqlite" || source === "sqlite") return "node:sqlite"
    },
    load(id) {
      if (id === "node:sqlite") return "module.exports = require('node:sqlite')"
    },
  }
}

export default defineConfig({
  plugins: [nodeSqlitePlugin()],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "studio/**",
      "evals/**",
      ".dev-sessions/**",
      ".agent-runs/**",
    ],
    server: { deps: { external: [/^node:/] } },
  },
})
