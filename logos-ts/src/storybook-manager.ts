import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { resolve, dirname } from "node:path"

export interface SbEntry {
  id: string
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

export type SbStatus = "starting" | "ready" | "failed"

export interface SbState {
  status: SbStatus
  startedAt: number
  logs: string[]
  error?: string
}

type Registry = Record<string, SbEntry>

const MAX_LOG_LINES = 50
const MAX_RESTARTS = 3

export class StorybookManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private states = new Map<string, SbState>()
  private expectedExits = new Set<string>()
  private restartAttempts = new Map<string, number>()
  private mapFile: string
  private logosSrc: string
  private projectRoot: string

  constructor(mapFile: string, logosSrc: string, projectRoot: string) {
    this.mapFile = mapFile
    this.logosSrc = logosSrc
    this.projectRoot = projectRoot
    mkdirSync(dirname(mapFile), { recursive: true })
    try {
      this.registry = JSON.parse(readFileSync(mapFile, "utf8"))
    } catch {
      this.registry = {}
    }
  }

  private save(): void {
    writeFileSync(this.mapFile, JSON.stringify(this.registry, null, 2))
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** On startup, reconnect to still-alive processes and purge dead ones. */
  cleanupAll(): void {
    for (const [id, entry] of Object.entries(this.registry)) {
      if (this.isAlive(entry.pid)) {
        console.log(`[storybook-mgr] reconnected ${id} on port ${entry.port} (pid ${entry.pid})`)
      } else {
        console.log(`[storybook-mgr] purging stale ${id} (pid ${entry.pid} dead)`)
        delete this.registry[id]
      }
    }
    this.save()
  }

  /** Get the URL for a workspace, or null if not running. */
  get(id: string): string | null {
    const entry = this.registry[id]
    if (!entry) return null
    if (!this.isAlive(entry.pid)) {
      delete this.registry[id]
      this.live.delete(id)
      this.save()
      return null
    }
    return entry.url
  }

  /** Get all entries (for the API). */
  all(): Record<string, SbEntry> {
    return { ...this.registry }
  }

  /** Get startup state for a workspace (status, logs, error). */
  state(id: string): SbState | null {
    return this.states.get(id) ?? null
  }

  /** Get all startup states. */
  allStates(): Record<string, SbState> {
    const out: Record<string, SbState> = {}
    for (const [id, s] of this.states) out[id] = s
    return out
  }

  private pushLog(id: string, line: string): void {
    const s = this.states.get(id)
    if (!s) return
    s.logs.push(line)
    if (s.logs.length > MAX_LOG_LINES) s.logs.shift()
  }

  /**
   * Ensure a Storybook is running for the given workspace.
   * Returns a promise that resolves with the URL once the port is detected.
   * If already running, resolves immediately.
   */
  ensure(id: string, frontendDir: string): Promise<string> {
    const existing = this.get(id)
    if (existing) return Promise.resolve(existing)

    const state: SbState = { status: "starting", startedAt: Date.now(), logs: [] }
    this.states.set(id, state)
    this.expectedExits.delete(id)

    return new Promise((resolve_, reject) => {
      const npx = resolve(frontendDir, "node_modules/.bin/storybook")
      const child = spawn(npx, ["dev", "--ci", "--no-open"], {
        cwd: frontendDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LOGOS_TS_SRC: this.logosSrc, LOGOS_PROJECT_ROOT: this.projectRoot },
      })

      let resolved = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const fail = (error: string) => {
        state.status = "failed"
        state.error = error
        if (!resolved) {
          resolved = true
          if (timeout) clearTimeout(timeout)
          reject(new Error(error))
        }
      }

      child.on("error", (e) => {
        console.error(`[storybook-mgr] ${id} error:`, e.message)
        fail(e.message)
      })

      if (!child.pid) {
        fail(`failed to spawn storybook for ${id}`)
        return
      }

      this.live.set(id, child)
      timeout = setTimeout(() => {
        // Give up and reap the child so an unregistered Storybook isn't leaked.
        try { child.kill() } catch {}
        this.live.delete(id)
        fail(`storybook for ${id} did not print a port within 120s`)
      }, 120_000)

      const bufferLines = (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          const trimmed = line.trim()
          if (trimmed) this.pushLog(id, trimmed)
        }
      }

      // Accumulate stdout across chunks — the URL can be split mid-line.
      let stdoutBuf = ""
      child.stdout?.on("data", (d: Buffer) => {
        bufferLines(d)
        stdoutBuf += d.toString()
        const m = stdoutBuf.match(/https?:\/\/localhost:(\d+)/)
        if (m && !resolved) {
          resolved = true
          clearTimeout(timeout)
          const port = parseInt(m[1], 10)
          const url = `http://localhost:${port}`
          const entry: SbEntry = {
            id,
            pid: child.pid!,
            port,
            url,
            cwd: frontendDir,
            startedAt: Date.now(),
          }
          this.registry[id] = entry
          state.status = "ready"
          this.save()
          console.log(`[storybook-mgr] ${id} ready on ${url} (pid ${child.pid})`)
          resolve_(url)
        }
      })
      child.stderr?.on("data", bufferLines)
      child.on("close", (code, signal) => {
        console.log(`[storybook-mgr] ${id} exited (code ${code}, signal ${signal})`)
        delete this.registry[id]
        this.live.delete(id)
        this.save()

        if (!resolved || state.status !== "ready") {
          fail(`storybook for ${id} exited with code ${code}`)
          return
        }

        // It was up and serving, then died without us shutting it down —
        // something external killed it. Restart so the workspace stays usable.
        if (this.expectedExits.delete(id)) {
          this.states.delete(id)
          return
        }
        // A healthy stretch of uptime resets the budget — only rapid
        // ready→die cycles count toward giving up.
        if (Date.now() - state.startedAt > 60_000) this.restartAttempts.delete(id)
        const attempts = (this.restartAttempts.get(id) ?? 0) + 1
        this.restartAttempts.set(id, attempts)
        if (attempts > MAX_RESTARTS) {
          state.status = "failed"
          state.error = `exited unexpectedly (code ${code}, signal ${signal}); gave up after ${MAX_RESTARTS} restarts`
          return
        }
        console.log(`[storybook-mgr] ${id} died unexpectedly — restarting (attempt ${attempts}/${MAX_RESTARTS})`)
        this.ensure(id, frontendDir).catch(() => {})
      })
    })
  }

  /** Kill a specific workspace's Storybook. */
  shutdown(id: string): void {
    this.expectedExits.add(id)
    const entry = this.registry[id]
    if (entry) {
      try { process.kill(entry.pid, "SIGTERM") } catch {}
      delete this.registry[id]
      this.save()
    }
    const child = this.live.get(id)
    if (child) {
      try { child.kill() } catch {}
      this.live.delete(id)
    }
  }

  /** Kill all tracked Storybook processes. */
  shutdownAll(): void {
    for (const id of Object.keys(this.registry)) {
      this.shutdown(id)
    }
  }
}
