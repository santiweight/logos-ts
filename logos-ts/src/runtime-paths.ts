import { createHash, randomBytes } from "node:crypto"
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

export function createLogosDevInstanceId(): string {
  return `dev-${Date.now().toString(36)}-${process.pid}-${randomBytes(4).toString("hex")}`
}

export function sanitizeLogosPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "instance"
}

export function defaultLogosDevInstanceRuntimeDir(sourceProject: string, instanceId: string): string {
  return resolve(defaultLogosRuntimeDir(sourceProject), "dev-instances", sanitizeLogosPathSegment(instanceId))
}

export function resolveLogosRuntimePaths(opts: ResolveLogosRuntimePathOptions): LogosRuntimePaths {
  const root = resolve(opts.runtimeRoot ?? defaultLogosRuntimeDir(opts.sourceProject))
  return {
    root,
    agentRuns: resolve(root, "agent-runs"),
    devSessions: resolve(root, "dev-sessions"),
  }
}
