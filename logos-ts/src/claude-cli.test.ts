import { afterEach, describe, expect, it, vi } from "vitest"
import { buildClaudePrintArgs } from "./claude-cli.js"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("buildClaudePrintArgs", () => {
  it("defaults to lean print-mode agent settings", () => {
    expect(buildClaudePrintArgs({ promptArg: "-", noSessionPersistence: true })).toEqual([
      "-p",
      "-",
      "--model",
      "sonnet",
      "--effort",
      "low",
      "--bare",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
    ])
  })

  it("uses explicit MCP config only for workspace agents", () => {
    expect(buildClaudePrintArgs({
      promptArg: "fix it",
      model: "haiku",
      resumeSessionId: "session-1",
      outputFormat: "stream-json",
      verbose: true,
      mcpConfigPath: "/tmp/logos.mcp.json",
    })).toEqual([
      "-p",
      "fix it",
      "-r",
      "session-1",
      "--model",
      "haiku",
      "--effort",
      "low",
      "--bare",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--mcp-config",
      "/tmp/logos.mcp.json",
      "--strict-mcp-config",
    ])
  })

  it("allows heavier runs through environment overrides", () => {
    vi.stubEnv("LOGOS_CLAUDE_MODEL", "opus")
    vi.stubEnv("LOGOS_CLAUDE_EFFORT", "default")
    vi.stubEnv("LOGOS_CLAUDE_BARE", "0")
    vi.stubEnv("LOGOS_CLAUDE_STRICT_MCP", "false")

    expect(buildClaudePrintArgs({ promptArg: "task", mcpConfigPath: "/tmp/logos.mcp.json" })).toEqual([
      "-p",
      "task",
      "--model",
      "opus",
      "--dangerously-skip-permissions",
      "--mcp-config",
      "/tmp/logos.mcp.json",
    ])
  })
})
