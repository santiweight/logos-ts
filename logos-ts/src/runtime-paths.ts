import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, resolve } from "node:path"

export interface LogosRuntimePaths {
  root: string
  agentRuns: string
  devSessions: string
}

export interface ResolveLogosRuntimePathOptions {
  sourceProject: string
  runtimeRoot?: string
}

export function defaultLogosRuntimeDir(sourceProject: string): string {
  const projectRoot = resolve(sourceProject)
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12)
  const name = basename(projectRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "project"
  return resolve(homedir(), ".logos", "projects", `${name}-${hash}`)
}

export function resolveLogosRuntimePaths(opts: ResolveLogosRuntimePathOptions): LogosRuntimePaths {
  const root = resolve(opts.runtimeRoot ?? defaultLogosRuntimeDir(opts.sourceProject))
  return {
    root,
    agentRuns: resolve(root, "agent-runs"),
    devSessions: resolve(root, "dev-sessions"),
  }
}
