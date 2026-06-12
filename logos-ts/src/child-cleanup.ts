import { readFileSync, writeFileSync, unlinkSync } from "node:fs"

export function cleanupStalePid(pidFile: string): void {
  let raw: string
  try {
    raw = readFileSync(pidFile, "utf8").trim()
  } catch {
    return
  }
  const pid = parseInt(raw, 10)
  if (!(pid > 0)) return
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // already dead
  }
  try {
    unlinkSync(pidFile)
  } catch {}
}

export function writePid(pidFile: string, pid: number): void {
  writeFileSync(pidFile, String(pid))
}
