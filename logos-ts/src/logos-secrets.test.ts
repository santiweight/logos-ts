import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LogosSecrets } from "./logos-secrets.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("LogosSecrets", () => {
  it("reads the Anthropic key from config first", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-from-env")
    const dir = mkdtempSync(join(tmpdir(), "logos-secrets-"))
    const config = join(dir, "config.json")
    writeFileSync(config, JSON.stringify({ anthropic_api_key: " sk-ant-from-config " }))

    expect(new LogosSecrets(config).anthropicApiKey).toBe("sk-ant-from-config")
  })

  it("falls back to ANTHROPIC_API_KEY when config has no key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", " sk-ant-from-env ")
    const dir = mkdtempSync(join(tmpdir(), "logos-secrets-"))
    const config = join(dir, "config.json")
    writeFileSync(config, JSON.stringify({}))

    expect(new LogosSecrets(config).anthropicApiKey).toBe("sk-ant-from-env")
  })

  it("falls back to ANTHROPIC_API_KEY when config is missing", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-from-env")

    expect(new LogosSecrets("/missing/config.json").anthropicApiKey).toBe("sk-ant-from-env")
  })
})
