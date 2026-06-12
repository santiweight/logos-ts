import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { gcDevSessions, writeDevSessionPid } from "./dev-session-gc.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dev-session-gc-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function touchDir(path: string, ageMs: number): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, "file.txt"), "copied project")
  const time = new Date(Date.now() - ageMs)
  utimesSync(path, time, time)
}

describe("gcDevSessions", () => {
  it("removes stale copied sessions and leaves fresh sessions plus non-session dirs", () => {
    const sessionsDir = join(tmpDir, ".dev-sessions")
    const staleSession = join(sessionsDir, "session-1000")
    const freshSession = join(sessionsDir, "session-2000")
    const currentSession = join(sessionsDir, "session-3000")
    const unrelatedDir = join(sessionsDir, "manual-backup")

    touchDir(staleSession, 8 * 24 * 60 * 60 * 1000)
    touchDir(freshSession, 60 * 1000)
    touchDir(currentSession, 8 * 24 * 60 * 60 * 1000)
    touchDir(unrelatedDir, 8 * 24 * 60 * 60 * 1000)

    const result = gcDevSessions(sessionsDir, {
      now: Date.now(),
      maxAgeMs: 24 * 60 * 60 * 1000,
      currentSessionId: "session-3000",
    })

    expect(result.removed).toEqual(["session-1000"])
    expect(existsSync(staleSession)).toBe(false)
    expect(existsSync(freshSession)).toBe(true)
    expect(existsSync(currentSession)).toBe(true)
    expect(existsSync(unrelatedDir)).toBe(true)
  })

  it("keeps stale sessions with a live Studio pid marker", () => {
    const sessionsDir = join(tmpDir, ".dev-sessions")
    const liveSession = join(sessionsDir, "session-4000")

    touchDir(liveSession, 8 * 24 * 60 * 60 * 1000)
    writeDevSessionPid(liveSession, process.pid)
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(liveSession, oldTime, oldTime)

    const result = gcDevSessions(sessionsDir, {
      now: Date.now(),
      maxAgeMs: 24 * 60 * 60 * 1000,
    })

    expect(result.removed).toEqual([])
    expect(result.skippedLive).toEqual(["session-4000"])
    expect(existsSync(liveSession)).toBe(true)
  })
})
