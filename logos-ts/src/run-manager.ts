/* eslint-disable @typescript-eslint/prefer-readonly, @typescript-eslint/no-dynamic-delete */
import { spawn, type ChildProcess } from "node:child_process"
import { request as httpRequest } from "node:http"
import { createServer } from "node:net"
import { basename, isAbsolute, relative, resolve } from "node:path"
import type { LogosRuntimeStore } from "./runtime-store.js"
import type { RunTargetCaps } from "./detect-project.js"

export interface RunEntry {
  id: string
  workspaceId: string
  targetId: string
  framework: "vite" | "next"
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

export type RunStatus = "starting" | "ready" | "failed"

export interface RunState {
  id: string
  workspaceId: string
  targetId: string
  status: RunStatus
  startedAt: number
  updatedAt: number
  logs: string[]
  error?: string
}

type Registry = Record<string, RunEntry>

const MAX_LOG_LINES = 80

export class RunManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private stopping = new Set<string>()
  private pending = new Map<string, Promise<string>>()
  private states = new Map<string, RunState>()
  private store: LogosRuntimeStore
  private projectRoot: string

  constructor(store: LogosRuntimeStore, projectRoot: string) {
    this.store = store
    this.projectRoot = projectRoot
    this.registry = this.store.listRuns()
    this.states = new Map(Object.entries(this.store.listRunStates()))
  }

  static key(workspaceId: string, targetId: string): string {
    return `${workspaceId}:${targetId}`
  }

  private save(): void {
    this.store.saveRuns(this.registry)
  }

  private saveState(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    this.store.saveRunState(state)
  }

  private setState(state: RunState): RunState {
    this.states.set(state.id, state)
    this.saveState(state.id)
    return state
  }

  private clearState(id: string): void {
    this.states.delete(id)
    this.store.deleteRunState(id)
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  cleanupAll(): void {
    for (const [id, entry] of Object.entries(this.registry)) {
      if (this.isAlive(entry.pid)) {
        console.log(`[run-mgr] reconnected ${id} on port ${entry.port} (pid ${entry.pid})`)
        if (!this.states.get(id)) {
          this.setState({
            id,
            workspaceId: entry.workspaceId,
            targetId: entry.targetId,
            status: "ready",
            startedAt: entry.startedAt,
            updatedAt: Date.now(),
            logs: [],
          })
        }
      } else {
        console.log(`[run-mgr] purging stale ${id} (pid ${entry.pid} dead)`)
        delete this.registry[id]
        this.setState({
          id,
          workspaceId: entry.workspaceId,
          targetId: entry.targetId,
          status: "failed",
          startedAt: entry.startedAt,
          updatedAt: Date.now(),
          logs: [],
          error: `run process ${entry.pid} is no longer running`,
        })
      }
    }
    this.save()
  }

  get(workspaceId: string, targetId: string): string | null {
    return this.getEntry(workspaceId, targetId)?.url ?? null
  }

  getEntry(workspaceId: string, targetId: string): RunEntry | null {
    const id = RunManager.key(workspaceId, targetId)
    const entry = this.registry[id]
    if (!entry) return null
    if (!this.isAlive(entry.pid)) {
      delete this.registry[id]
      this.live.delete(id)
      this.save()
      const state = this.states.get(id)
      this.setState({
        id,
        workspaceId,
        targetId,
        status: "failed",
        startedAt: state?.startedAt ?? entry.startedAt,
        updatedAt: Date.now(),
        logs: state?.logs ?? [],
        error: `run process ${entry.pid} is no longer running`,
      })
      return null
    }
    return entry
  }

  all(): Record<string, RunEntry> {
    return { ...this.registry }
  }

  state(workspaceId: string, targetId: string): RunState | null {
    return this.states.get(RunManager.key(workspaceId, targetId)) ?? null
  }

  allStates(): Record<string, RunState> {
    const out: Record<string, RunState> = {}
    for (const [id, state] of this.states) out[id] = state
    return out
  }

  private pushLog(id: string, line: string): void {
    const state = this.states.get(id)
    if (!state) return
    state.logs.push(line)
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift()
    state.updatedAt = Date.now()
    this.saveState(id)
  }

  async ensure(workspaceId: string, workspaceRoot: string, target: RunTargetCaps): Promise<string> {
    const existing = this.get(workspaceId, target.id)
    if (existing) return existing
    const id = RunManager.key(workspaceId, target.id)
    const pending = this.pending.get(id)
    if (pending) return pending

    const state = this.setState({
      id,
      workspaceId,
      targetId: target.id,
      status: "starting",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      logs: [],
    })

    const promise = this.start(id, workspaceId, workspaceRoot, target, state)
    this.pending.set(id, promise)
    promise.finally(() => this.pending.delete(id)).catch(() => undefined)
    return promise
  }

  restart(workspaceId: string, workspaceRoot: string, target: RunTargetCaps): Promise<string> {
    this.shutdown(workspaceId, target.id)
    return this.ensure(workspaceId, workspaceRoot, target)
  }

  private async start(
    id: string,
    workspaceId: string,
    workspaceRoot: string,
    target: RunTargetCaps,
    state: RunState,
  ): Promise<string> {
    const port = await findFreePort()
    const targetRel = relative(this.projectRoot, target.cwd)
    const cwd = resolve(workspaceRoot, targetRel)
    const command = commandForCwd(cwd, target.command)
    const base = `/runs/${encodeURIComponent(workspaceId)}/${encodeURIComponent(target.id)}/`
    const args = target.args.map((arg) => arg
      .replace(/\$\{PORT\}/g, String(port))
      .replace(/\$\{BASE\}/g, base))
    const url = `http://127.0.0.1:${port}`

    return new Promise<string>((resolve_, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: runEnv({
          port,
          base,
          workspaceId,
          targetId: target.id,
          projectRoot: this.projectRoot,
          workspaceRoot,
          cwd,
          targetEnv: target.env,
        }),
      })

      let settled = false
      let ready = false
      let closed = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      let poll: ReturnType<typeof setInterval> | undefined

      const fail = (error: string) => {
        state.status = "failed"
        state.error = error
        state.updatedAt = Date.now()
        this.saveState(id)
        if (!settled) {
          settled = true
          if (timeout) clearTimeout(timeout)
          if (poll) clearInterval(poll)
          reject(new Error(error))
        }
      }

      const markReady = () => {
        if (ready || settled) return
        if (closed) return
        if (child.killed || child.exitCode != null || child.signalCode != null) return
        ready = true
        settled = true
        if (timeout) clearTimeout(timeout)
        if (poll) clearInterval(poll)
        const pid = child.pid
        if (pid == null) {
          fail(`failed to get pid from run child process`)
          return
        }
        this.registry[id] = {
          id,
          workspaceId,
          targetId: target.id,
          framework: target.framework,
          pid,
          port,
          url,
          cwd,
          startedAt: Date.now(),
        }
        state.status = "ready"
        delete state.error
        state.updatedAt = Date.now()
        this.save()
        this.saveState(id)
        console.log(`[run-mgr] ${id} ready on ${url} (pid ${child.pid})`)
        resolve_(url)
      }

      child.on("error", (e) => {
        console.error(`[run-mgr] ${id} error:`, e.message)
        fail(e.message)
      })

      if (!child.pid) {
        fail(`failed to spawn run ${id}`)
        return
      }

      this.live.set(id, child)

      timeout = setTimeout(() => {
        try { child.kill() } catch {}
        this.live.delete(id)
        fail(`run ${id} did not become ready within 120s`)
      }, 120_000)

      const bufferLines = (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          const trimmed = line.trim()
          if (!trimmed) continue
          this.pushLog(id, trimmed)
          if (isReadyLog(target, trimmed)) markReady()
        }
      }

      child.stdout.on("data", bufferLines)
      child.stderr.on("data", bufferLines)

      poll = setInterval(() => {
        probe(url).then((ok) => {
          if (ok) markReady()
        }).catch(() => undefined)
      }, 500)

      child.on("close", (code) => {
        closed = true
        console.log(`[run-mgr] ${id} exited (code ${code})`)
        if (timeout) clearTimeout(timeout)
        if (poll) clearInterval(poll)
        delete this.registry[id]
        this.live.delete(id)
        this.save()
        if (this.stopping.delete(id)) {
          settled = true
          return
        }
        fail(`run ${id} exited with code ${code}`)
        if (ready) {
          this.setState({
            id,
            workspaceId,
            targetId: target.id,
            status: "failed",
            startedAt: state.startedAt,
            updatedAt: Date.now(),
            logs: state.logs,
            error: `run exited with code ${code}`,
          })
        }
      })
    })
  }

  shutdown(workspaceId: string, targetId: string): void {
    const id = RunManager.key(workspaceId, targetId)
    const entry = this.registry[id]
    if (entry) {
      this.stopping.add(id)
      try { process.kill(entry.pid, "SIGTERM") } catch {}
      delete this.registry[id]
      this.save()
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

  shutdownWorkspace(workspaceId: string): void {
    for (const entry of Object.values(this.registry)) {
      if (entry.workspaceId === workspaceId) this.shutdown(workspaceId, entry.targetId)
    }
    for (const state of Object.values(this.allStates())) {
      if (state.workspaceId === workspaceId) this.clearState(state.id)
    }
  }

  shutdownAll(): void {
    for (const entry of Object.values(this.registry)) this.shutdown(entry.workspaceId, entry.targetId)
  }
}

function commandForCwd(cwd: string, command: string): string {
  if (isAbsolute(command)) return command
  if (command.includes("/")) return resolve(cwd, command)
  return command
}

function copyEnv(name: string, env: NodeJS.ProcessEnv, out: Record<string, string>): void {
  const value = env[name]
  if (value != null) out[name] = value
}

function runEnv(opts: {
  port: number
  base: string
  workspaceId: string
  targetId: string
  projectRoot: string
  workspaceRoot: string
  cwd: string
  targetEnv?: Record<string, string> | undefined
}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of [
    "PATH",
    "HOME",
    "SHELL",
    "USER",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSH_AUTH_SOCK",
  ]) copyEnv(name, process.env, out)

  out["PORT"] = String(opts.port)
  out["HOST"] = "127.0.0.1"
  out["BROWSER"] = "none"
  out["CI"] = process.env["CI"] ?? "true"
  out["LOGOS_SESSION"] = basename(opts.projectRoot)
  out["LOGOS_WS"] = opts.workspaceId
  out["LOGOS_RUN_TARGET"] = opts.targetId
  out["LOGOS_RUN_BASE"] = opts.base
  for (const [name, value] of Object.entries(opts.targetEnv ?? {})) {
    out[name] = expandRunEnvValue(value, opts)
  }
  return out
}

function expandRunEnvValue(value: string, opts: {
  port: number
  base: string
  workspaceId: string
  targetId: string
  projectRoot: string
  workspaceRoot: string
  cwd: string
}): string {
  return value
    .replace(/\$\{PORT\}/g, String(opts.port))
    .replace(/\$\{BASE\}/g, opts.base)
    .replace(/\$\{WORKSPACE_ROOT\}/g, opts.workspaceRoot)
    .replace(/\$\{CWD\}/g, opts.cwd)
    .replace(/\$\{PROJECT_ROOT\}/g, opts.projectRoot)
}

function findFreePort(): Promise<number> {
  return new Promise((resolve_, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve_(port))
    })
  })
}

function probe(url: string): Promise<boolean> {
  return new Promise((resolve_) => {
    const req = httpRequest(url, { method: "GET", timeout: 1000 }, (res) => {
      res.resume()
      resolve_(res.statusCode != null)
    })
    req.on("timeout", () => {
      req.destroy()
      resolve_(false)
    })
    req.on("error", () => resolve_(false))
    req.end()
  })
}

function isReadyLog(target: RunTargetCaps, line: string): boolean {
  if (target.framework === "next") return /\bready\b/i.test(line)
  if (target.framework === "vite") return /\blocal:\s+http:\/\//i.test(line)
  return false
}
