export interface ClaudePrintArgsOptions {
  promptArg: string
  model?: string
  resumeSessionId?: string
  outputFormat?: "text" | "json" | "stream-json"
  verbose?: boolean
  mcpConfigPath?: string
  extraArgs?: string[]
  noSessionPersistence?: boolean
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]
  if (value == null || value === "") return defaultValue
  return !/^(0|false|no|off)$/i.test(value)
}

function envValue(name: string, defaultValue: string): string {
  const value = process.env[name]?.trim()
  return value ? value : defaultValue
}

const POISONED_ENV_PREFIXES = ["CLAUDE_CODE_", "CLAUDE_AGENT_SDK"]
const POISONED_ENV_KEYS = ["CLAUDECODE", "AI_AGENT", "ANTHROPIC_API_KEY"]

export function cleanEnvForClaude(anthropicApiKey?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (POISONED_ENV_KEYS.includes(key) || POISONED_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      delete env[key]
    }
  }
  if (anthropicApiKey) env["ANTHROPIC_API_KEY"] = anthropicApiKey
  return env
}

export function buildClaudePrintArgs(opts: ClaudePrintArgsOptions): string[] {
  const args = ["-p", opts.promptArg]
  if (opts.resumeSessionId) args.push("-r", opts.resumeSessionId)

  args.push("--model", envValue("LOGOS_CLAUDE_MODEL", opts.model ?? "sonnet"))

  const effort = envValue("LOGOS_CLAUDE_EFFORT", "low")
  if (effort !== "default") args.push("--effort", effort)

  if (envFlag("LOGOS_CLAUDE_BARE", true)) args.push("--bare")
  if (opts.noSessionPersistence) args.push("--no-session-persistence")
  if (opts.outputFormat) args.push("--output-format", opts.outputFormat)
  if (opts.verbose) args.push("--verbose")

  args.push("--dangerously-skip-permissions")

  if (opts.mcpConfigPath) {
    args.push("--mcp-config", opts.mcpConfigPath)
    if (envFlag("LOGOS_CLAUDE_STRICT_MCP", true)) args.push("--strict-mcp-config")
  }

  if (opts.extraArgs) args.push(...opts.extraArgs)
  return args
}
