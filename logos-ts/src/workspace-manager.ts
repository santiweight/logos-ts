/* eslint-disable no-restricted-syntax, @typescript-eslint/restrict-plus-operands, @typescript-eslint/prefer-readonly, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/use-unknown-in-catch-callback-variable */
// WorkspaceManager: owns workspace lifecycle, goal queue, and agent sequencing.
//
// Ontology:
//   Workspace  — a forked project codebase on disk
//   Goal       — a change request to be achieved in a workspace
//   GoalQueue  — the ordered list of goals for a workspace (one per workspace)
//   AgentRun   — executes one goal in a workspace's fork directory

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, symlinkSync, readdirSync } from "node:fs"
import { resolve, relative, join, dirname, basename } from "node:path"
import { execFileSync, execFile, spawn, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
import type { StorybookManager } from "./storybook-manager.js"
import type { ClaudeSessionManager } from "./claude-session-manager.js"
import { buildGoalLine, selectNextGoal } from "./prompt.js"

export interface Goal {
  id: string
  text: string
  label: string
  target: string
  mode: "code" | "arch"
  createdAt: number
  storyId?: string | null
  selector?: string | null
  component?: string | null
  status: "pending" | "running" | "done" | "error"
  sessionId?: string | null
}

export interface WorkspaceState {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  forkDir: string
  goals: Goal[]
  index: unknown
}

export interface WorkspaceMeta {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  goals: Goal[]
}

export interface AgentEvent {
  type: string
  [key: string]: unknown
}

type AgentEventCallback = (event: AgentEvent) => void

interface ProjectCaps {
  root: string
  storybook?: { configDir: string; frontendDir: string }
  tests?: { command: string[]; watchDirs: string[] }
  nodeModulesDirs: string[]
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceState>()
  private runningAgents = new Map<string, ChildProcess>() // goalId → child
  private wsDir: string
  private runsDir: string
  private logosTsSrc: string
  private logosTsRoot: string
  private projectRoot: string
  private caps: ProjectCaps
  private sbManager: StorybookManager
  private sessions: ClaudeSessionManager
  private tsx: string
  private getIndex: (() => Promise<unknown>) | null

  constructor(opts: {
    wsDir: string
    runsDir: string
    logosTsSrc: string
    logosTsRoot: string
    projectRoot: string
    caps: ProjectCaps
    sbManager: StorybookManager
    sessions: ClaudeSessionManager
    tsx: string
    getIndex?: () => Promise<unknown>
  }) {
    this.wsDir = opts.wsDir
    this.runsDir = opts.runsDir
    this.logosTsSrc = opts.logosTsSrc
    this.logosTsRoot = opts.logosTsRoot
    this.projectRoot = opts.projectRoot
    this.caps = opts.caps
    this.sbManager = opts.sbManager
    this.sessions = opts.sessions
    this.tsx = opts.tsx
    this.getIndex = opts.getIndex ?? null

    mkdirSync(this.wsDir, { recursive: true })
    this.loadAll()
  }

  private loadAll(): void {
    if (!existsSync(this.wsDir)) return
    for (const f of readdirSync(this.wsDir).filter((f) => f.endsWith(".json"))) {
      try {
        const ws = JSON.parse(readFileSync(resolve(this.wsDir, f), "utf8")) as WorkspaceState
        this.workspaces.set(ws.id, ws)
      } catch { /* corrupt file */ }
    }
  }

  private save(ws: WorkspaceState): void {
    writeFileSync(resolve(this.wsDir, `${ws.id}.json`), JSON.stringify(ws))
  }

  private async snapshotIndex(): Promise<unknown> {
    if (this.getIndex) return this.getIndex()
    const args = [resolve(this.logosTsRoot, "src/build-index.ts"), this.projectRoot, "-"]
    return JSON.parse(
      execFileSync(this.tsx, args, { cwd: this.logosTsRoot, encoding: "utf8" })
    )
  }

  private createFork(wsId: string): string {
    mkdirSync(this.runsDir, { recursive: true })
    const dir = resolve(this.runsDir, wsId)
    if (!existsSync(dir)) {
      cpSync(this.projectRoot, dir, {
        recursive: true,
        filter: (s) => !/node_modules|\.workspaces|\.logos_cache|\.vite-logos|dist|__snapshots__/.test(s),
      })
      for (const nmDir of this.caps.nodeModulesDirs) {
        const rel = relative(this.projectRoot, nmDir)
        const target = join(dir, rel)
        try { mkdirSync(dirname(target), { recursive: true }) } catch { /* exists */ }
        try { symlinkSync(nmDir, target) } catch { /* exists */ }
      }
    }
    return dir
  }

  // --- public API ---

  list(): WorkspaceMeta[] {
    return [...this.workspaces.values()].map((ws) => ({
      id: ws.id,
      name: ws.name,
      parentId: ws.parentId,
      createdAt: ws.createdAt,
      goals: ws.goals,
    }))
  }

  get(id: string): WorkspaceState | undefined {
    return this.workspaces.get(id)
  }

  reindex(id: string): WorkspaceState | undefined {
    const ws = this.workspaces.get(id)
    if (!ws) return undefined
    const args = [resolve(this.logosTsRoot, "src/build-index.ts"), ws.forkDir, "-"]
    const wsSbUrl = this.sbManager.get(ws.id)
    if (wsSbUrl) args.push(wsSbUrl)
    ws.index = JSON.parse(
      execFileSync(this.tsx, args, { cwd: this.logosTsRoot, encoding: "utf8" })
    )
    this.save(ws)
    return ws
  }

  async create(opts?: { name?: string; fromWorkspaceId?: string }): Promise<WorkspaceMeta> {
    const id = `ws-${Date.now()}`
    const parentId = opts?.fromWorkspaceId ?? null
    const parentWs = parentId ? this.workspaces.get(parentId) : null
    const forkDir = this.createFork(id)

    // Start Storybook before awaiting the index — it only needs the fork dir,
    // and on a cold server the index build would otherwise delay it by ~15s.
    if (this.caps.storybook) {
      this.startStorybook(id, forkDir).catch((e: any) => {
        console.error(`[workspace] storybook for ${id} failed to start:`, e.message)
      })
    }

    const index = parentWs ? parentWs.index : await this.snapshotIndex()

    const ws: WorkspaceState = {
      id,
      name: opts?.name ?? "workspace",
      parentId,
      createdAt: Date.now(),
      forkDir,
      goals: [],
      index,
    }
    this.workspaces.set(id, ws)
    this.save(ws)

    return { id: ws.id, name: ws.name, parentId: ws.parentId, createdAt: ws.createdAt, goals: ws.goals }
  }

  private startStorybook(id: string, forkDir: string): Promise<string> {
    if (!this.caps.storybook) return Promise.reject(new Error("storybook is not configured for this project"))
    const wsFrontend = join(forkDir, relative(this.projectRoot, this.caps.storybook.frontendDir))
    return this.sbManager.ensure(id, wsFrontend)
  }

  /** Start (or restart after a failure) the Storybook for a workspace. Idempotent. */
  ensureStorybook(wsId: string): Promise<string> {
    const ws = this.workspaces.get(wsId)
    if (!ws) return Promise.reject(new Error("no such workspace"))
    return this.startStorybook(wsId, ws.forkDir)
  }

  delete(id: string): void {
    const ws = this.workspaces.get(id)
    if (!ws) return

    // Kill any running agents for this workspace's goals
    for (const g of ws.goals) {
      const child = this.runningAgents.get(g.id)
      if (child) { try { child.kill() } catch {} }
      this.runningAgents.delete(g.id)
    }

    // Shutdown workspace storybook
    this.sbManager.shutdown(id)

    // Remove sessions
    this.sessions.deleteByWorkspace(id)

    // Remove fork directory
    rmSync(ws.forkDir, { recursive: true, force: true })

    // Remove workspace file and state
    rmSync(resolve(this.wsDir, `${id}.json`), { force: true })
    this.workspaces.delete(id)
  }

  addGoal(wsId: string, goal: Omit<Goal, "status">): Goal | null {
    const ws = this.workspaces.get(wsId)
    if (!ws) return null

    const g: Goal = { ...goal, status: "pending" }
    ws.goals.push(g)
    this.save(ws)
    return g
  }

  removeGoal(wsId: string, goalId: string): void {
    const ws = this.workspaces.get(wsId)
    if (!ws) return
    ws.goals = ws.goals.filter((g) => g.id !== goalId)
    this.save(ws)
  }

  goalsForWorkspace(wsId: string): Goal[] {
    return this.workspaces.get(wsId)?.goals ?? []
  }

  nextPendingGoal(wsId: string): Goal | undefined {
    return this.workspaces.get(wsId)?.goals.find((g) => g.status === "pending")
  }

  isGoalRunning(goalId: string): boolean {
    return this.runningAgents.has(goalId)
  }

  /** Process the next pending goal in the workspace's queue. Returns the goal ID, or null if nothing to do. */
  processNext(wsId: string, onEvent: AgentEventCallback): string | null {
    const ws = this.workspaces.get(wsId)
    if (!ws) { onEvent({ type: "error", message: "no such workspace" }); return null }

    const goal = selectNextGoal(ws.goals, this.runningAgents)
    if (!goal) { onEvent({ type: "error", message: "no pending goals" }); return null }

    goal.status = "running"
    this.save(ws)

    this.runGoalAgent(ws, goal, onEvent)
    return goal.id
  }

  private async runGoalAgent(ws: WorkspaceState, goal: Goal, onEvent: AgentEventCallback): Promise<void> {
    const dir = ws.forkDir

    // Architecture mode: strip bodies
    const mode = goal.mode
    const bodiesFile = resolve(this.runsDir, `${goal.id}.bodies.json`)
    if (mode === "arch") {
      onEvent({ type: "status", message: "stripping to architecture view…" })
      try {
        await execFileAsync(this.tsx, [resolve(this.logosTsRoot, "src/archmode.ts"), "strip", dir, bodiesFile], {
          cwd: this.logosTsRoot, encoding: "utf8",
        })
      } catch (e) {
        onEvent({ type: "stderr", message: "strip failed: " + String(e) })
      }
    }

    // Build context
    onEvent({ type: "status", message: "building architecture context…" })
    const targets = [goal.component ? `component:${goal.component}` : goal.target]
    let context = ""
    try {
      const { stdout } = await execFileAsync(this.tsx, [resolve(this.logosTsRoot, "src/context.ts"), dir, "40000", ...targets], {
        cwd: this.logosTsRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      })
      context = stdout
    } catch (e) {
      onEvent({ type: "stderr", message: "context build failed: " + String(e) })
    }

    const sandbox = `IMPORTANT: Your working directory is ${dir}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`
    const goalLine = buildGoalLine(goal)
    const prompt =
      mode === "arch"
        ? `${context}\n\n${sandbox}` +
          `You are in ARCHITECTURE MODE. The code is shown as pure SIGNATURES using \`declare\` — no bodies, no \`=\`, no values. The real implementations are filled back in automatically after you finish.\n\n` +
          `Tests appear as \`test("name")\` or \`test("name", () => expr)\` lines above the declaration they cover. You can add new tests (name-only or with a single expression), remove tests, or leave them. Test lines are written back to \`.test.ts\` files automatically — name-only tests get a placeholder body.\n\n` +
          `Restructure the ARCHITECTURE to satisfy the change: move / split / rename / add these \`declare\` signatures across files. Keep everything as bare \`declare\` declarations — do NOT write bodies, values, or import statements.\n\n` +
          `Change requests:\n${goalLine}\n`
        : `${context}\n\n${sandbox}` +
          `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. Open a file only to read or edit an implementation body you must change.\n\n` +
          `Address these change requests:\n${goalLine}\n\n` +
          `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck.` +
          (this.caps.tests
            ? ` Do NOT run tests yourself. Tests auto-run on every file save via the test-runner MCP. ` +
              `After making changes, call \`test_results(wait_for_completion=true)\` to wait for the auto-triggered run to finish and see the results. ` +
              `Iterate until the tests relevant to your change pass; ignore pre-existing stub failures you didn't cause. ` +
              `Always check test_results before finishing — do not consider your work done until tests pass.`
            : ` This project has no automated test runner configured. Verify your changes manually.`)

    // MCP config
    const mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} }
    if (this.caps.tests) {
      const testRunnerConfig = JSON.stringify({
        cwd: dir,
        command: this.caps.tests.command,
        watch: this.caps.tests.watchDirs,
        filePattern: "\\.(tsx?|jsx?)$",
      })
      mcpConfig.mcpServers["test-runner"] = {
        command: this.tsx,
        args: [resolve(this.logosTsRoot, "src/test-runner-mcp.ts"), testRunnerConfig],
      }
    }
    const mcpConfigPath = resolve(this.runsDir, `${goal.id}.mcp.json`)
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))

    onEvent({ type: "status", message: "starting agent…" })

    const session = this.sessions.create(goal.id, ws.id)
    let sessionId = session.id
    goal.sessionId = sessionId
    this.save(ws)

    const recordAndEmit = (evt: AgentEvent) => {
      this.sessions.addEvent(sessionId, evt.type, evt)

      if (evt.type === "event") {
        const e = evt["event"] as Record<string, unknown> | undefined
        if (e?.["type"] === "system" && e?.["subtype"] === "init" && typeof e?.["session_id"] === "string") {
          this.sessions.setClaudeId(sessionId, e["session_id"] as string)
          sessionId = e["session_id"] as string
          goal.sessionId = sessionId
          this.save(ws)
        }
      }

      onEvent(evt)
    }

    const child = spawn(
      "claude",
      ["-p", prompt, "--model", "sonnet", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--mcp-config", mcpConfigPath],
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        // Ownership tag: lets `ps -E` / a sweeper identify strays from dead sessions.
        env: { ...process.env, LOGOS_SESSION: basename(this.projectRoot), LOGOS_WS: ws.id },
      },
    )
    this.runningAgents.set(goal.id, child)

    let buf = ""
    child.stdout.on("data", (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        try { recordAndEmit({ type: "event", event: JSON.parse(line) }) } catch { recordAndEmit({ type: "raw", line }) }
      }
    })
    child.stderr.on("data", (d) => recordAndEmit({ type: "stderr", message: d.toString() }))
    child.on("error", (e) => recordAndEmit({ type: "error", message: String(e) }))
    child.on("close", async (code) => {
      this.runningAgents.delete(goal.id)

      if (mode === "arch") {
        recordAndEmit({ type: "status", message: "splicing implementations + inferring imports…" })
        try {
          await execFileAsync(this.tsx, [resolve(this.logosTsRoot, "src/archmode.ts"), "splice", dir, bodiesFile], {
            cwd: this.logosTsRoot, encoding: "utf8",
          })
        } catch (e) {
          recordAndEmit({ type: "stderr", message: "splice failed: " + String(e) })
        }
      }

      // Collect base snapshots before re-indexing so we can populate previousSnapshot
      const baseSnapshots = new Map<string, string | null>()
      const oldIndex = ws.index as { files?: { component?: { captured?: { exportName: string; snapshot: string | null }[] } }[] } | null
      if (oldIndex?.files) {
        for (const f of oldIndex.files) {
          if (!f.component?.captured) continue
          for (const c of f.component.captured) baseSnapshots.set(c.exportName, c.snapshot)
        }
      }

      // Re-index workspace
      try {
        const reindexArgs = [resolve(this.logosTsRoot, "src/build-index.ts"), dir, "-"]
        const wsSbUrl = this.sbManager.get(ws.id)
        if (wsSbUrl) reindexArgs.push(wsSbUrl)
        const { stdout } = await execFileAsync(this.tsx, reindexArgs, { cwd: this.logosTsRoot, encoding: "utf8" })
        ws.index = JSON.parse(stdout)
        // Merge previousSnapshot from the base index
        const newIndex = ws.index as { files?: { component?: { captured?: { exportName: string; snapshot: string | null; previousSnapshot: string | null }[] } }[] }
        if (newIndex.files) {
          for (const f of newIndex.files) {
            if (!f.component?.captured) continue
            for (const c of f.component.captured) {
              const prev = baseSnapshots.get(c.exportName) ?? null
              c.previousSnapshot = prev !== c.snapshot ? prev : null
            }
          }
        }
      } catch (e) { console.error(`[logos] re-index failed for ${ws.id}:`, e) }

      goal.status = code === 0 ? "done" : "error"
      this.save(ws)
      rmSync(mcpConfigPath, { force: true })
      recordAndEmit({ type: "done", code })
    })
  }

  get sessionManager(): ClaudeSessionManager {
    return this.sessions
  }

  /** Kill all running agents (studio shutdown). */
  abortAll(): void {
    for (const goalId of [...this.runningAgents.keys()]) this.abort(goalId)
  }

  /** Kill the running agent for a goal. */
  abort(goalId: string): void {
    const child = this.runningAgents.get(goalId)
    if (child) {
      try { child.kill() } catch {}
      this.runningAgents.delete(goalId)
    }
  }
}
