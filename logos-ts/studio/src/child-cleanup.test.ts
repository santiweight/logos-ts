/* eslint-disable functional/no-loop-statements, functional/no-throw-statements, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from "vitest"
import { spawn, execFileSync } from "node:child_process"
import { unlinkSync, existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const DIR = resolve(fileURLToPath(import.meta.url), "../..")

function spawnParentWithChild(pidFile: string) {
  const script = `
    const { spawn } = require("child_process");
    const fs = require("fs");
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
    process.on("exit", () => child.kill());
    process.on("SIGINT", () => { child.kill(); process.exit(); });
    process.on("SIGTERM", () => { child.kill(); process.exit(); });
    setTimeout(() => {}, 300_000);
  `
  return spawn("node", ["-e", script], { stdio: "ignore" })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForPidFile(path: string, timeoutMs = 3000): number {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const pid = parseInt(readFileSync(path, "utf8").trim(), 10)
      if (pid > 0 && isAlive(pid)) return pid
    }
    execFileSync("sleep", ["0.1"])
  }
  throw new Error(`PID file ${path} not populated in time`)
}

describe("child process cleanup on parent death", () => {
  const pidFile = resolve(DIR, ".storybook.pid.test")

  it("orphans the child when parent is killed with SIGKILL (demonstrates the bug)", async () => {
    try { unlinkSync(pidFile) } catch {}

    const parent = spawnParentWithChild(pidFile)
    const childPid = waitForPidFile(pidFile)
    const parentPid = parent.pid!

    expect(isAlive(parentPid)).toBe(true)
    expect(isAlive(childPid)).toBe(true)

    process.kill(parentPid, "SIGKILL")
    await new Promise((r) => setTimeout(r, 500))

    expect(isAlive(parentPid)).toBe(false)
    const childSurvived = isAlive(childPid)

    try { process.kill(childPid, "SIGKILL") } catch {}
    try { unlinkSync(pidFile) } catch {}

    // Child survives — proving the zombie bug exists
    expect(childSurvived).toBe(true)
  })

  it("cleans up stale child via PID file on next startup", async () => {
    try { unlinkSync(pidFile) } catch {}

    const parent = spawnParentWithChild(pidFile)
    const childPid = waitForPidFile(pidFile)

    process.kill(parent.pid!, "SIGKILL")
    await new Promise((r) => setTimeout(r, 300))
    expect(isAlive(parent.pid!)).toBe(false)
    expect(isAlive(childPid)).toBe(true)

    const { cleanupStalePid } = await import("../../src/child-cleanup.js")
    cleanupStalePid(pidFile)

    await new Promise((r) => setTimeout(r, 300))
    expect(isAlive(childPid)).toBe(false)

    try { unlinkSync(pidFile) } catch {}
  })
})
