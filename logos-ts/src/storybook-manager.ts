/* eslint-disable prefer-const, @typescript-eslint/prefer-readonly, @typescript-eslint/no-dynamic-delete, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars */
import { spawn, type ChildProcess } from "node:child_process"
import { resolve, basename } from "node:path"
import type { LogosRuntimeStore } from "./runtime-store.js"

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
  updatedAt: number
  logs: string[]
  error?: string
}

type Registry = Record<string, SbEntry>

const MAX_LOG_LINES = 50

export class StorybookManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private stopping = new Set<string>()
  private states = new Map<string, SbState>()
  private pending = new Map<string, Promise<string>>()
  private store: LogosRuntimeStore
  private logosSrc: string
  private projectRoot: string

  constructor(store: LogosRuntimeStore, logosSrc: string, projectRoot: string) {
    this.store = store
    this.logosSrc = logosSrc
    this.projectRoot = projectRoot
    this.registry = this.store.listStorybooks()
    this.states = new Map(Object.entries(this.store.listStorybookStates()))
  }

  private save(): void {
    this.store.saveStorybooks(this.registry)
  }

  private saveState(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    this.store.saveStorybookState({ id, ...state })
  }

  private setState(id: string, state: SbState): SbState {
    this.states.set(id, state)
    this.saveState(id)
    return state
  }

  private clearState(id: string): void {
    this.states.delete(id)
    this.store.deleteStorybookState(id)
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
        if (!this.states.get(id)) {
          this.setState(id, {
            status: "ready",
            startedAt: entry.startedAt,
            updatedAt: Date.now(),
            logs: [],
          })
        }
      } else {
        console.log(`[storybook-mgr] purging stale ${id} (pid ${entry.pid} dead)`)
        delete this.registry[id]
        this.setState(id, {
          status: "failed",
          startedAt: entry.startedAt,
          updatedAt: Date.now(),
          logs: [],
          error: `storybook process ${entry.pid} is no longer running`,
        })
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
      const state = this.states.get(id)
      this.setState(id, {
        status: "failed",
        startedAt: state?.startedAt ?? entry.startedAt,
        updatedAt: Date.now(),
        logs: state?.logs ?? [],
        error: `storybook process ${entry.pid} is no longer running`,
      })
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
    s.updatedAt = Date.now()
    this.saveState(id)
  }

  /**
   * Ensure a Storybook is running for the given workspace.
   * Returns a promise that resolves with the URL once the port is detected.
   * If already running, resolves immediately.
   */
  ensure(id: string, frontendDir: string): Promise<string> {
    const existing = this.get(id)
    if (existing) return Promise.resolve(existing)
    const pending = this.pending.get(id)
    if (pending) return pending

    const state = this.setState(id, { status: "starting", startedAt: Date.now(), updatedAt: Date.now(), logs: [] })

    const promise = new Promise<string>((resolve_, reject) => {
      const npx = resolve(frontendDir, "node_modules/.bin/storybook")
      // node_modules is symlinked to the shared install, so Vite's default
      // cacheDir (node_modules/.vite) would be shared by every concurrent
      // instance — point each instance at its own cache inside the fork.
      const cacheDir = resolve(frontendDir, ".vite-logos")
      const child = spawn(npx, ["dev", "--ci", "--no-open", "--host", "127.0.0.1"], {
        cwd: frontendDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CACHE_DIR: resolve(this.projectRoot, ".logos_cache", id),
          LOGOS_TS_SRC: this.logosSrc,
          LOGOS_PROJECT_ROOT: this.projectRoot,
          LOGOS_STORYBOOK_BASE: `/storybooks/${encodeURIComponent(id)}/`,
          LOGOS_SB_CACHE_DIR: cacheDir,
          // Ownership tag: lets `ps -E` / a sweeper identify strays from dead sessions.
          LOGOS_SESSION: basename(this.projectRoot),
          LOGOS_WS: id,
        },
      })

      let resolved = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const fail = (error: string) => {
        state.status = "failed"
        state.error = error
        state.updatedAt = Date.now()
        this.saveState(id)
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
      child.stdout.on("data", (d: Buffer) => {
        bufferLines(d)
        stdoutBuf += d.toString()
        const m = stdoutBuf.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/)
        if (m != null && m[1] != null && !resolved) {
          resolved = true
          clearTimeout(timeout)
          const port = parseInt(m[1], 10)
          const url = `http://127.0.0.1:${port}`
          const pid = child.pid
          if (pid == null) {
            fail(`failed to get pid from storybook child process`)
            return
          }
          const entry: SbEntry = {
            id,
            pid,
            port,
            url,
            cwd: frontendDir,
            startedAt: Date.now(),
          }
          this.registry[id] = entry
          state.status = "ready"
          delete state.error
          state.updatedAt = Date.now()
          this.save()
          this.saveState(id)
          console.log(`[storybook-mgr] ${id} ready on ${url} (pid ${child.pid})`)
          resolve_(url)
        }
      })
      child.stderr.on("data", bufferLines)
      child.on("close", (code) => {
        console.log(`[storybook-mgr] ${id} exited (code ${code})`)
        delete this.registry[id]
        this.live.delete(id)
        this.save()
        if (this.stopping.delete(id)) return
        fail(`storybook for ${id} exited with code ${code}`)
      })
    })
    this.pending.set(id, promise)
    promise.then(
      () => this.pending.delete(id),
      () => this.pending.delete(id)
    )
    return promise
  }

  /** Kill a specific workspace's Storybook. */
  shutdown(id: string): void {
    const entry = this.registry[id]
    if (entry) {
      this.stopping.add(id)
      try { process.kill(entry.pid, "SIGTERM") } catch {}
      delete this.registry[id]
      this.save()
      this.clearState(id)
    }
    this.pending.delete(id)
    const child = this.live.get(id)
    if (child) {
      this.stopping.add(id)
      try { child.kill() } catch {}
      this.live.delete(id)
    }
    this.clearState(id)
  }

  /** Kill all tracked Storybook processes. */
  shutdownAll(): void {
    for (const id of Object.keys(this.registry)) {
      this.shutdown(id)
    }
  }
}
