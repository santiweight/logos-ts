import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildClaudePrintArgs, cleanEnvForClaude } from "./claude-cli.js"

const SRC = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(SRC, "../studio")

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cleanEnvForClaude", () => {
  it("strips Claude Code session vars and inherited ANTHROPIC_API_KEY", () => {
    vi.stubEnv("CLAUDE_CODE_CHILD_SESSION", "1")
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "abc-123")
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "sdk-ts")
    vi.stubEnv("CLAUDE_CODE_EXECPATH", "/some/path/claude")
    vi.stubEnv("CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS", "1")
    vi.stubEnv("CLAUDE_AGENT_SDK_VERSION", "0.3.183")
    vi.stubEnv("ANTHROPIC_API_KEY", "inherited-should-be-stripped")
    vi.stubEnv("CLAUDECODE", "1")
    vi.stubEnv("AI_AGENT", "claude-code_2-1-183_agent")
    vi.stubEnv("HOME", "/Users/test")

    const env = cleanEnvForClaude()

    expect(env).not.toHaveProperty("CLAUDE_CODE_CHILD_SESSION")
    expect(env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID")
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT")
    expect(env).not.toHaveProperty("CLAUDE_CODE_EXECPATH")
    expect(env).not.toHaveProperty("CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS")
    expect(env).not.toHaveProperty("CLAUDE_AGENT_SDK_VERSION")
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY")
    expect(env).not.toHaveProperty("CLAUDECODE")
    expect(env).not.toHaveProperty("AI_AGENT")
    expect(env).toHaveProperty("HOME", "/Users/test")
  })

  it("sets ANTHROPIC_API_KEY from explicit argument", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "inherited-junk")
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "parent-session")

    const env = cleanEnvForClaude("sk-ant-from-secrets-file")

    expect(env).toHaveProperty("ANTHROPIC_API_KEY", "sk-ant-from-secrets-file")
    expect(env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID")
  })

  it("preserves LOGOS_ env vars", () => {
    vi.stubEnv("LOGOS_CLAUDE_MODEL", "opus")
    vi.stubEnv("LOGOS_CLAUDE_EFFORT", "high")

    const env = cleanEnvForClaude()

    expect(env).toHaveProperty("LOGOS_CLAUDE_MODEL", "opus")
    expect(env).toHaveProperty("LOGOS_CLAUDE_EFFORT", "high")
  })
})

describe("structural: every file that spawns claude uses cleanEnvForClaude", () => {
  const filesToCheck = [
    resolve(SRC, "workspace-manager.ts"),
    resolve(STUDIO, "vite.config.ts"),
    resolve(SRC, "../evals/run.ts"),
  ]

  for (const filePath of filesToCheck) {
    it(`${filePath.split("/logos-ts/").pop()} imports and uses cleanEnvForClaude`, () => {
      const src = readFileSync(filePath, "utf8")
      expect(src).toContain("cleanEnvForClaude")
    })
  }
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

  it("enables web tools by leaving bare mode and constraining built-in tools", () => {
    expect(buildClaudePrintArgs({
      promptArg: "research online",
      mcpConfigPath: "/tmp/logos.mcp.json",
      enableWebTools: true,
    })).toEqual([
      "-p",
      "research online",
      "--model",
      "sonnet",
      "--effort",
      "low",
      "--tools",
      "Bash,Edit,Read,WebSearch,WebFetch",
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
