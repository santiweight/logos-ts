/* eslint-disable functional/no-loop-statements, functional/no-let, functional/no-throw-statements, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/restrict-template-expressions, @typescript-eslint/prefer-readonly, @typescript-eslint/no-dynamic-delete, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-confusing-void-expression */
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs"
import { createServer } from "node:net"
import { resolve, dirname, join } from "node:path"

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

const MAX_LOG_LINES = 200
const STARTUP_TIMEOUT_MS = 120_000
const READY_POLL_MS = 500
const MAX_RESTARTS = 3
const RESTART_RESET_MS = 60_000

/** Bind to port 0 to let the OS pick a free port, then release it for Storybook. */
function allocatePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.unref()
    srv.on("error", rej)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (!addr || typeof addr !== "object") {
        srv.close()
        rej(new Error("could not allocate a port"))
        return
      }
      const port = addr.port
      srv.close(() => res(port))
    })
  })
}

export class StorybookManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private states = new Map<string, SbState>()
  private pending = new Map<string, Promise<string>>()
  private expectedExits = new Set<string>()
  private restartAttempts = new Map<string, number>()
  private mapFile: string
  private logDir: string
  private logosSrc: string
  private projectRoot: string

  constructor(mapFile: string, logosSrc: string, projectRoot: string) {
    this.mapFile = mapFile
    this.logosSrc = logosSrc
    this.projectRoot = projectRoot
    this.logDir = join(dirname(mapFile), "storybook-logs")
    mkdirSync(this.logDir, { recursive: true })
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

  logFile(id: string): string {
    return join(this.logDir, `${id}.log`)
  }

  /** On startup, reconnect to still-alive processes and purge dead ones. */
  cleanupAll(): void {
    for (const [id, entry] of Object.entries(this.registry)) {
      if (this.isAlive(entry.pid)) {
        console.log(`[storybook-mgr] reconnected ${id} on port ${entry.port} (pid ${entry.pid})`)
        this.states.set(id, { status: "ready", startedAt: entry.startedAt, logs: [] })
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
      // Without this, the UI would show a spinner forever for a dead server.
      const s = this.states.get(id)
      if (s && s.status === "ready") {
        s.status = "failed"
        s.error = `storybook process (pid ${entry.pid}) died unexpectedly — see ${this.logFile(id)}`
      }
      this.save()
      return null
    }
    return entry.url
  }

  /** Get all entries, pruning dead ones (for the API). */
  all(): Record<string, SbEntry> {
    for (const id of Object.keys(this.registry)) this.get(id)
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

  private pushLog(id: string, chunk: string): void {
    try { appendFileSync(this.logFile(id), chunk) } catch {}
    const s = this.states.get(id)
    if (!s) return
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      s.logs.push(trimmed)
      if (s.logs.length > MAX_LOG_LINES) s.logs.shift()
    }
  }

  /**
   * Ensure a Storybook is running for the given workspace.
   * Resolves with the URL once the server answers HTTP. Idempotent and
   * concurrency-safe: a second call while one is starting joins the same
   * promise; a call after a failure starts a fresh attempt.
   */
  ensure(id: string, frontendDir: string): Promise<string> {
    const existing = this.get(id)
    if (existing) return Promise.resolve(existing)

    const inflight = this.pending.get(id)
    if (inflight) return inflight

    const attempt = this.start(id, frontendDir).finally(() => this.pending.delete(id))
    this.pending.set(id, attempt)
    return attempt
  }

  private async start(id: string, frontendDir: string): Promise<string> {
    const state: SbState = { status: "starting", startedAt: Date.now(), logs: [] }
    this.states.set(id, state)
    this.expectedExits.delete(id)
    this.pushLog(id, `--- [storybook-mgr] starting attempt at ${new Date().toISOString()} (cwd ${frontendDir}) ---\n`)

    const port = await allocatePort()
    const url = `http://localhost:${port}`

    const bin = resolve(frontendDir, "node_modules/.bin/storybook")
    // node_modules is symlinked to the shared install, so Vite's default
    // cacheDir (node_modules/.vite) would be shared by every concurrent
    // instance — point each instance at its own cache inside the fork.
    const cacheDir = resolve(frontendDir, ".vite-logos")
    const child = spawn(bin, ["dev", "--ci", "--no-open", "-p", String(port)], {
      cwd: frontendDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LOGOS_TS_SRC: this.logosSrc,
        LOGOS_PROJECT_ROOT: this.projectRoot,
        LOGOS_SB_CACHE_DIR: cacheDir,
      },
    })

    let exited = false
    let exitCode: number | null = null
    child.on("close", (code, signal) => {
      exited = true
      exitCode = code
      this.live.delete(id)
      if (this.registry[id]?.pid === child.pid) {
        delete this.registry[id]
        this.save()
      }
      const expected = this.expectedExits.delete(id)

      if (state.status !== "ready") {
        // Died during startup — the readiness loop surfaces this as a rejection.
        if (state.status !== "failed") {
          state.status = "failed"
          state.error = `storybook for ${id} exited with code ${code}, signal ${signal} — see ${this.logFile(id)}`
        }
        console.log(`[storybook-mgr] ${id} exited during startup (code ${code}, signal ${signal})`)
        return
      }

      if (expected) {
        this.states.delete(id)
        return
      }

      // It was up and serving, then died without us shutting it down —
      // something external killed it. Restart so the workspace stays usable.
      // A healthy stretch of uptime resets the budget, so only rapid
      // ready→die cycles count toward giving up.
      if (Date.now() - state.startedAt > RESTART_RESET_MS) this.restartAttempts.delete(id)
      const attempts = (this.restartAttempts.get(id) ?? 0) + 1
      this.restartAttempts.set(id, attempts)
      if (attempts > MAX_RESTARTS) {
        state.status = "failed"
        state.error = `storybook for ${id} died unexpectedly (code ${code}, signal ${signal}); gave up after ${MAX_RESTARTS} rapid restarts — see ${this.logFile(id)}`
        console.log(`[storybook-mgr] ${id} crash loop — giving up after ${MAX_RESTARTS} restarts`)
        return
      }
      console.log(`[storybook-mgr] ${id} died unexpectedly (code ${code}, signal ${signal}) — restarting (attempt ${attempts}/${MAX_RESTARTS})`)
      this.ensure(id, frontendDir).catch(() => {})
    })
    child.on("error", (e) => {
      exited = true
      state.status = "failed"
      state.error = e.message
      console.error(`[storybook-mgr] ${id} spawn error:`, e.message)
    })
    let stdoutBuf = ""
    let actualUrl = url
    let actualPort = port
    child.stdout?.on("data", (d: Buffer) => {
      const chunk = d.toString()
      this.pushLog(id, chunk)
      stdoutBuf += chunk
      const m = stdoutBuf.match(/https?:\/\/localhost:(\d+)/)
      if (m) {
        const parsed = parseInt(m[1], 10)
        if (parsed !== port) {
          console.log(`[storybook-mgr] ${id} bound to port ${parsed} instead of allocated ${port}`)
          actualPort = parsed
          actualUrl = `http://localhost:${parsed}`
        }
      }
    })
    child.stderr?.on("data", (d: Buffer) => this.pushLog(id, d.toString()))

    if (!child.pid) {
      state.status = "failed"
      state.error = `failed to spawn storybook for ${id}`
      throw new Error(state.error)
    }
    this.live.set(id, child)

    // Readiness = the server actually answers, not a string in stdout.
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    while (true) {
      if (exited) {
        const err = state.error ?? `storybook for ${id} exited with code ${exitCode}`
        throw new Error(err)
      }
      if (Date.now() > deadline) {
        try { child.kill() } catch {}
        this.live.delete(id)
        state.status = "failed"
        state.error = `storybook for ${id} did not answer on ${actualUrl} within ${STARTUP_TIMEOUT_MS / 1000}s — see ${this.logFile(id)}`
        throw new Error(state.error)
      }
      try {
        const res = await fetch(`${actualUrl}/index.json`, { signal: AbortSignal.timeout(2_000) })
        if (res.ok) break
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, READY_POLL_MS))
    }

    const entry: SbEntry = { id, pid: child.pid, port: actualPort, url: actualUrl, cwd: frontendDir, startedAt: Date.now() }
    this.registry[id] = entry
    state.status = "ready"
    this.save()
    console.log(`[storybook-mgr] ${id} ready on ${actualUrl} (pid ${child.pid})`)
    return actualUrl
  }

  /** Kill a specific workspace's Storybook and forget its state. */
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
    this.states.delete(id)
  }

  /** Kill all tracked Storybook processes. */
  shutdownAll(): void {
    for (const id of new Set([...Object.keys(this.registry), ...this.live.keys()])) {
      this.shutdown(id)
    }
  }
}
