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
