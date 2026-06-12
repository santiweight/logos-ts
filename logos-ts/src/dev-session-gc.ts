import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface DevSessionGcOptions {
  now?: number
  maxAgeMs?: number
  currentSessionId?: string
}

export interface DevSessionGcResult {
  removed: string[]
  skippedLive: string[]
  failed: { sessionId: string; error: string }[]
}

export const DEFAULT_DEV_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

const SESSION_DIR_PATTERN = /^session-\d+$/
const STUDIO_PID_FILE = join(".logos", "studio.pid")

export function gcDevSessions(sessionsDir: string, opts: DevSessionGcOptions = {}): DevSessionGcResult {
  const now = opts.now ?? Date.now()
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_DEV_SESSION_MAX_AGE_MS
  const removed: string[] = []
  const skippedLive: string[] = []
  const failed: { sessionId: string; error: string }[] = []

  if (!existsSync(sessionsDir)) return { removed, skippedLive, failed }

  for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!SESSION_DIR_PATTERN.test(entry.name)) continue
    if (entry.name === opts.currentSessionId) continue

    const sessionDir = join(sessionsDir, entry.name)
    let ageMs: number
    try {
      ageMs = now - statSync(sessionDir).mtimeMs
    } catch (e) {
      failed.push({ sessionId: entry.name, error: String(e) })
      continue
    }
    if (ageMs < maxAgeMs) continue

    if (hasLiveStudioPid(sessionDir)) {
      skippedLive.push(entry.name)
      continue
    }

    try {
      rmSync(sessionDir, { recursive: true, force: true })
      removed.push(entry.name)
    } catch (e) {
      failed.push({ sessionId: entry.name, error: String(e) })
    }
  }

  return { removed, skippedLive, failed }
}

export function writeDevSessionPid(sessionDir: string, pid = process.pid): void {
  const logosDir = join(sessionDir, ".logos")
  mkdirSync(logosDir, { recursive: true })
  writeFileSync(join(sessionDir, STUDIO_PID_FILE), String(pid))
}

function hasLiveStudioPid(sessionDir: string): boolean {
  let raw: string
  try {
    raw = readFileSync(join(sessionDir, STUDIO_PID_FILE), "utf8").trim()
  } catch {
    return false
  }

  const pid = Number.parseInt(raw, 10)
  if (!(pid > 0)) return false

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
