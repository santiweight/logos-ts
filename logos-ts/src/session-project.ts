import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { gcDevSessions, writeDevSessionPid } from "./dev-session-gc.js"

export interface SessionProject {
  root: string
  id: string
}

function isSubpath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"))
}

export function devSessionsDirFor(sourceRoot: string, preferredDir: string): string {
  return isSubpath(sourceRoot, preferredDir) ? resolve(preferredDir, "..", "..", ".dev-sessions") : preferredDir
}

function dependencyDirs(sourceRoot: string): string[] {
  const dirs: string[] = []
  const rootNodeModules = join(sourceRoot, "node_modules")
  if (existsSync(rootNodeModules)) dirs.push(rootNodeModules)

  for (const entry of readdirSync(sourceRoot)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const nestedNodeModules = join(sourceRoot, entry, "node_modules")
    if (existsSync(nestedNodeModules)) dirs.push(nestedNodeModules)
  }

  return dirs
}

export function createSessionProject(sourceRoot: string, preferredSessionsDir: string): SessionProject {
  const resolvedSourceRoot = resolve(sourceRoot)
  const sessionsDir = devSessionsDirFor(sourceRoot, preferredSessionsDir)
  mkdirSync(sessionsDir, { recursive: true })
  const root = mkdtempSync(resolve(sessionsDir, "session-"))
  const id = basename(root)

  const gcResult = gcDevSessions(sessionsDir, { currentSessionId: id })
  if (gcResult.removed.length > 0) {
    console.log(`[logos] removed stale sessions: ${gcResult.removed.join(", ")}`)
  }
  if (gcResult.failed.length > 0) {
    console.warn(`[logos] failed to remove stale sessions: ${gcResult.failed.map((f) => f.sessionId).join(", ")}`)
  }

  const shouldCopy = (sourcePath: string): boolean => {
    const rel = relative(resolvedSourceRoot, sourcePath)
    if (!rel) return true
    const parts = rel.split(/[/\\]/)
    return !parts.some((part) => (
      part === "node_modules" ||
      part === ".git" ||
      part === ".dev-sessions" ||
      part === ".agent-runs" ||
      part === ".logos_cache" ||
      part === ".logos" ||
      part === ".vite-logos" ||
      part === "dist"
    ))
  }

  cpSync(sourceRoot, root, {
    recursive: true,
    filter: shouldCopy,
  })

  writeDevSessionPid(root)

  for (const depDir of dependencyDirs(sourceRoot)) {
    const target = join(root, relative(sourceRoot, depDir))
    mkdirSync(dirname(target), { recursive: true })
    try { symlinkSync(depDir, target) } catch { /* dependency link already exists */ }
  }

  console.log(`[logos] session: ${id}`)
  console.log(`[logos] copied ${sourceRoot} → ${root}`)
  return { root, id }
}
