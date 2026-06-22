// @vitest-environment node

import { describe, expect, it } from "vitest"
import { loadConfigFromFile, type PluginOption } from "vite"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function pluginNames(plugins: PluginOption[] | undefined): string[] {
  const names: string[] = []
  for (const plugin of plugins ?? []) {
    if (!plugin) continue
    if (Array.isArray(plugin)) {
      names.push(...pluginNames(plugin))
      continue
    }
    if ("name" in plugin) names.push(plugin.name)
  }
  return names
}

describe("Storybook Vite config", () => {
  it("loads direct Storybook config without creating the studio runtime", async () => {
    const originalArgv = process.argv
    process.argv = ["node", "storybook", "dev", "-p", "5181", "--host", "127.0.0.1"]

    try {
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "development" },
        resolve(STUDIO, "vite.config.ts"),
        undefined,
        "silent",
      )

      expect(loaded).toBeTruthy()
      expect(pluginNames(loaded?.config.plugins)).toContain("vite:react-babel")
      expect(pluginNames(loaded?.config.plugins)).not.toContain("logos-ts-studio-api")
      expect(pluginNames(loaded?.config.plugins)).not.toContain("portable-stories")
      expect(pluginNames(loaded?.config.plugins)).not.toContain("storybook-proxy")
    } finally {
      process.argv = originalArgv
    }
  })
})
