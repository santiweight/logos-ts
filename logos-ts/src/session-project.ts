import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"
import { gcDevSessions, writeDevSessionPid } from "./dev-session-gc.js"
import { NodeModulesCache, findPackageDirs } from "./node-modules-cache.js"

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

  const nmCache = new NodeModulesCache()
  for (const pkgDir of findPackageDirs(root)) {
    const result = nmCache.ensureFor(pkgDir)
    const rel = relative(root, pkgDir)
    const target = join(root, rel, "node_modules")
    if (resolve(result.nodeModulesPath) !== resolve(target)) nmCache.linkTo(result.nodeModulesPath, target)
  }

  console.log(`[logos] session: ${id}`)
  console.log(`[logos] copied ${sourceRoot} → ${root}`)
  return { root, id }
}
