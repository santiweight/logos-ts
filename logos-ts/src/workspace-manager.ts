/* eslint-disable no-restricted-syntax, @typescript-eslint/restrict-plus-operands, @typescript-eslint/prefer-readonly, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/use-unknown-in-catch-callback-variable */
// WorkspaceManager: owns workspace lifecycle, goal queue, and agent sequencing.
//
// Ontology:
//   Workspace  — user-facing intent container, typed as code or architecture
//   Instance   — a materialized project tree on disk
//   Goal       — a change request to be achieved in a workspace
//   GoalQueue  — the ordered list of goals for a workspace (one per workspace)
//   AgentRun   — executes one goal in a workspace instance directory
//
// Code and architecture work are isolated by workspace kind. Arch goals posted
// to a code workspace fork into a dedicated arch workspace. Arch goals posted
// to an arch workspace join its queue unless the caller explicitly asks to fork.
// Each architecture workspace runs at most one architecture agent at a time.

import { existsSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, readdirSync, realpathSync } from "node:fs"
import { resolve, relative, join, dirname, basename, sep } from "node:path"
import { execFileSync, execFile, spawn, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
import type { StorybookManager } from "./storybook-manager.js"
import type { ClaudeSessionManager } from "./claude-session-manager.js"
import { buildArchPrompt, buildGoalLine, buildImplPrompt, buildVerifyNote, selectNextGoal } from "./prompt.js"
import type {
  LogosRuntimeStore,
  WorkspaceKind,
} from "./runtime-store.js"

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

export type { WorkspaceKind }

export interface WorkspaceInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: unknown
}

interface WorkspaceRecord {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: Goal[]
  instances: Record<string, WorkspaceInstance>
}

export interface WorkspaceState {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  forkDir: string
  index: unknown
  goals: Goal[]
  instances: Record<string, WorkspaceInstance>
}

export interface WorkspaceMeta {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: Goal[]
}

export interface PushWorkspaceBranchResult {
  branchName: string
  remote: string
  commit: string
  changed: boolean
  pullRequest?: {
    number: number | null
    url: string
    created: boolean
  }
}

export type AddGoalResult =
  | { goal: Goal; workspaceId: string }
  | { error: string; status: number }

export type WorkspacePolicyEventType =
  import("./runtime-store.js").WorkspacePolicyEventType

export type WorkspacePolicyEvent = import("./runtime-store.js").StoredWorkspacePolicyEvent

export interface AgentEvent {
  type: string
  [key: string]: unknown
}

type AgentEventCallback = (event: AgentEvent) => void
type AgentSpawner = (command: string, args: string[], options: NonNullable<Parameters<typeof spawn>[2]>) => ChildProcess

function indexComponents(file: { component?: { captured?: unknown[] }; components?: { captured?: unknown[] }[] }): { captured?: unknown[] }[] {
  return file.components?.length ? file.components : file.component ? [file.component] : []
}

interface ProjectCaps {
  root: string
  storybook?: { configDir: string; frontendDir: string }
  tests?: { command: string[]; watchDirs: string[] }
  nodeModulesDirs: string[]
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceRecord>()
  private runningAgents = new Map<string, ChildProcess>() // goalId → child
  private workspaceSeq = 0
  private store: LogosRuntimeStore
  private runsDir: string
  private logosTsSrc: string
  private logosTsRoot: string
  private projectRoot: string
  private sourceProjectRoot: string
  private caps: ProjectCaps
  private sbManager: StorybookManager
  private sessions: ClaudeSessionManager
  private tsx: string
  private getIndex: (() => Promise<unknown>) | null
  private goalSubscribers = new Map<string, Set<AgentEventCallback>>()
  private spawnAgent: AgentSpawner

  constructor(opts: {
    store: LogosRuntimeStore
    runsDir: string
    logosTsSrc: string
    logosTsRoot: string
    projectRoot: string
    sourceProjectRoot?: string
    caps: ProjectCaps
    sbManager: StorybookManager
    sessions: ClaudeSessionManager
    tsx: string
    getIndex?: () => Promise<unknown>
    spawnAgent?: AgentSpawner
  }) {
    this.store = opts.store
    this.runsDir = opts.runsDir
    this.logosTsSrc = opts.logosTsSrc
    this.logosTsRoot = opts.logosTsRoot
    this.projectRoot = opts.projectRoot
    this.sourceProjectRoot = opts.sourceProjectRoot ?? opts.projectRoot
    this.caps = opts.caps
    this.sbManager = opts.sbManager
    this.sessions = opts.sessions
    this.tsx = opts.tsx
    this.getIndex = opts.getIndex ?? null
    this.spawnAgent = opts.spawnAgent ?? spawn

    this.loadAll()
  }

  private loadAll(): void {
    this.workspaces.clear()
    for (const ws of this.store.listWorkspaces()) this.workspaces.set(ws.id, ws)
  }

  private save(ws: WorkspaceRecord): void {
    this.store.saveWorkspace(ws)
  }

  private async snapshotIndex(root = this.projectRoot): Promise<unknown> {
    if (root === this.projectRoot && this.getIndex) return this.getIndex()
    const args = [resolve(this.logosTsRoot, "src/build-index.ts"), root, "-"]
    return JSON.parse(
      execFileSync(this.tsx, args, { cwd: this.logosTsRoot, encoding: "utf8" })
    )
  }

  private createMaterializedRoot(instanceId: string, sourceRoot = this.projectRoot): string {
    mkdirSync(this.runsDir, { recursive: true })
    const dir = resolve(this.runsDir, instanceId)
    if (!existsSync(dir)) {
      cpSync(sourceRoot, dir, {
        recursive: true,
        filter: (s) => !/node_modules|\.workspaces|\.logos$|\.logos_cache|\.vite-logos|dist/.test(s),
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

  private activeInstance(ws: WorkspaceRecord): WorkspaceInstance {
    const inst = ws.instances[ws.activeInstanceId]
    if (!inst) throw new Error(`active instance not found for workspace ${ws.id}: ${ws.activeInstanceId}`)
    return inst
  }

  private nextWorkspaceId(): string {
    this.workspaceSeq += 1
    return `ws-${Date.now()}-${this.workspaceSeq}`
  }

  private toState(ws: WorkspaceRecord): WorkspaceState {
    const inst = this.activeInstance(ws)
    return {
      id: ws.id,
      name: ws.name,
      kind: ws.kind,
      parentId: ws.parentId,
      createdAt: ws.createdAt,
      baseInstanceId: ws.baseInstanceId,
      activeInstanceId: ws.activeInstanceId,
      forkDir: inst.materializedRoot,
      index: inst.index,
      goals: ws.goals,
      instances: ws.instances,
    }
  }

  private toMeta(ws: WorkspaceRecord): WorkspaceMeta {
    return {
      id: ws.id,
      name: ws.name,
      kind: ws.kind,
      parentId: ws.parentId,
      createdAt: ws.createdAt,
      baseInstanceId: ws.baseInstanceId,
      activeInstanceId: ws.activeInstanceId,
      goals: ws.goals,
    }
  }

  private async createInstance(workspaceId: string, sourceRoot: string, index?: unknown): Promise<WorkspaceInstance> {
    const id = `inst-${Date.now()}-${Math.round(Math.random() * 1e6)}`
    const materializedRoot = this.createMaterializedRoot(id, sourceRoot)
    return {
      id,
      workspaceId,
      materializedRoot,
      mutability: "writable",
      createdAt: Date.now(),
      index: index ?? await this.snapshotIndex(materializedRoot),
    }
  }

  // --- public API ---

  list(): WorkspaceMeta[] {
    return [...this.workspaces.values()].map((ws) => this.toMeta(ws))
  }

  get(id: string): WorkspaceState | undefined {
    const ws = this.workspaces.get(id)
    return ws ? this.toState(ws) : undefined
  }

  listPolicyEvents(opts?: { workspaceId?: string; limit?: number }): WorkspacePolicyEvent[] {
    return this.store.listPolicyEvents(opts)
  }

  private recordPolicyEvent(event: Omit<WorkspacePolicyEvent, "seq" | "createdAt">): void {
    this.store.addPolicyEvent(event)
  }

  reindex(id: string): WorkspaceState | undefined {
    const ws = this.workspaces.get(id)
    if (!ws) return undefined
    const inst = this.activeInstance(ws)
    const args = [resolve(this.logosTsRoot, "src/build-index.ts"), inst.materializedRoot, "-"]
    const wsSbUrl = this.sbManager.get(ws.id)
    if (wsSbUrl) args.push(wsSbUrl)
    inst.index = JSON.parse(
      execFileSync(this.tsx, args, { cwd: this.logosTsRoot, encoding: "utf8" })
    )
    this.save(ws)
    return this.toState(ws)
  }

  pushAsBranch(id: string, branchName: string, opts?: {
    remote?: string
    createPullRequest?: boolean
    baseBranch?: string
    title?: string
    body?: string
  }): PushWorkspaceBranchResult {
    const ws = this.workspaces.get(id)
    if (!ws) throw new Error("workspace not found")

    const branch = this.normalizeBranchName(branchName)
    if (!branch) throw new Error("branch name is required")
    if (branch.startsWith("-")) throw new Error("branch name cannot start with '-'")

    const remote = opts?.remote?.trim() || "origin"
    this.logPublishStep("start", { workspaceId: id, workspaceName: ws.name, branch, remote })
    const inst = this.activeInstance(ws)
    const sourceRoot = realpathSync(resolve(this.sourceProjectRoot))
    const gitRoot = realpathSync(execFileSync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim())
    execFileSync("git", ["-C", gitRoot, "check-ref-format", "--branch", branch], { encoding: "utf8" })
    const base = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    const projectRel = relative(gitRoot, sourceRoot)
    if (projectRel === ".." || projectRel.startsWith(`..${sep}`)) throw new Error("source project is outside the git repository")

    mkdirSync(this.runsDir, { recursive: true })
    const publishDir = resolve(this.runsDir, `.publish-${Date.now()}-${Math.round(Math.random() * 1e6)}`)
    try {
      this.logPublishStep("create temporary worktree", { publishDir, base })
      execFileSync("git", ["-C", gitRoot, "worktree", "add", "--detach", publishDir, base], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })

      this.logPublishStep("copy workspace contents", { from: inst.materializedRoot, to: projectRel ? join(publishDir, projectRel) : publishDir })
      const targetRoot = projectRel ? join(publishDir, projectRel) : publishDir
      this.replaceTreeContents(inst.materializedRoot, targetRoot, { preserveGitDir: projectRel === "" })

      const addPath = projectRel || "."
      execFileSync("git", ["-C", publishDir, "add", "-A", "--", addPath], { encoding: "utf8" })
      const changed = execFileSync("git", ["-C", publishDir, "status", "--porcelain", "--", addPath], {
        encoding: "utf8",
      }).trim().length > 0

      if (changed) {
        this.logPublishStep("commit workspace changes", { message: `Publish workspace ${ws.name}` })
        execFileSync("git", ["-C", publishDir, "commit", "-m", `Publish workspace ${ws.name}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      }

      const commit = execFileSync("git", ["-C", publishDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
      this.logPublishStep("push branch", { remote, branch, commit })
      execFileSync("git", ["-C", publishDir, "push", "--force-with-lease", remote, `HEAD:refs/heads/${branch}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })

      const prOpts: { baseBranch?: string; title: string; body: string } = {
        title: opts?.title ?? `Publish workspace ${ws.name}`,
        body: opts?.body ?? `Created from Logos workspace ${ws.name}.`,
      }
      if (opts?.baseBranch) prOpts.baseBranch = opts.baseBranch
      const pullRequest = opts?.createPullRequest
        ? this.createOrGetPullRequest(publishDir, remote, branch, prOpts)
        : undefined

      return {
        branchName: branch,
        remote,
        commit,
        changed,
        ...(pullRequest ? { pullRequest } : {}),
      }
    } catch (e) {
      this.logPublishError(e)
      throw e
    } finally {
      try {
        execFileSync("git", ["-C", gitRoot, "worktree", "remove", "--force", publishDir], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch {
        rmSync(publishDir, { recursive: true, force: true })
      }
    }
  }

  private replaceTreeContents(sourceRoot: string, targetRoot: string, opts?: { preserveGitDir?: boolean }): void {
    mkdirSync(targetRoot, { recursive: true })
    for (const entry of readdirSync(targetRoot)) {
      if (opts?.preserveGitDir && entry === ".git") continue
      rmSync(join(targetRoot, entry), { recursive: true, force: true })
    }
    for (const entry of readdirSync(sourceRoot)) {
      cpSync(join(sourceRoot, entry), join(targetRoot, entry), {
        recursive: true,
        filter: (s) => this.shouldCopyPublishedPath(s),
      })
    }
  }

  private shouldCopyPublishedPath(path: string): boolean {
    const name = basename(path)
    return ![
      "node_modules",
      ".git",
      ".workspaces",
      ".logos",
      ".logos_cache",
      ".vite-logos",
      "dist",
    ].includes(name)
  }

  private normalizeBranchName(input: string): string {
    let branch = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._/-]+/g, "-")
      .replace(/\/+/g, "/")
      .replace(/-+/g, "-")
      .replace(/^[-/.]+|[-/.]+$/g, "")
      .replace(/\.\.+/g, ".")
      .replace(/@\{/g, "-")
    branch = branch
      .split("/")
      .map((part) => part.replace(/^[-.]+|[-.]+$/g, ""))
      .filter(Boolean)
      .join("/")
    if (branch && !branch.includes("/")) branch = `logos/${branch}`
    return branch
  }

  private logPublishStep(step: string, details: Record<string, unknown>): void {
    console.log(`[workspace-publish] ${step}: ${JSON.stringify(details)}`)
  }

  private logPublishError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[workspace-publish] failed: ${detail}`)
  }

  private createOrGetPullRequest(
    cwd: string,
    remote: string,
    branch: string,
    opts: { baseBranch?: string; title: string; body: string },
  ): { number: number | null; url: string; created: boolean } {
    const repo = this.githubRepoForRemote(cwd, remote)
    this.logPublishStep("resolve GitHub repo", { remote, repo, branch })
    const existing = this.readPullRequestForBranch(cwd, repo, branch)
    if (existing) {
      this.logPublishStep("reuse existing pull request", { branch, url: existing.url, number: existing.number })
      return { ...existing, created: false }
    }

    const baseBranch = opts.baseBranch?.trim() || this.defaultBranchForRemote(cwd, remote)
    this.logPublishStep("create pull request", { repo, branch, baseBranch, title: opts.title })
    const raw = execFileSync("gh", [
      "pr",
      "create",
      "--repo",
      repo,
      "--head",
      branch,
      "--base",
      baseBranch,
      "--title",
      opts.title,
      "--body",
      opts.body,
    ], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
    const url = this.extractPullRequestUrl(raw)
    if (!url) throw new Error(`GitHub did not return a pull request URL: ${raw}`)
    const number = this.pullRequestNumberFromUrl(url)
    this.logPublishStep("created pull request", { branch, url, number })
    return { number, url, created: true }
  }

  private extractPullRequestUrl(output: string): string | null {
    return output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0] ?? null
  }

  private pullRequestNumberFromUrl(url: string): number | null {
    const raw = url.match(/\/pull\/(\d+)/)?.[1]
    if (!raw) return null
    const number = Number(raw)
    return Number.isFinite(number) ? number : null
  }

  private readPullRequestForBranch(
    cwd: string,
    repo: string,
    branch: string,
  ): { number: number | null; url: string } | null {
    try {
      const raw = execFileSync("gh", [
        "pr",
        "view",
        branch,
        "--repo",
        repo,
        "--json",
        "number,url",
      ], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      const pr = JSON.parse(raw) as { number?: number; url?: string }
      if (!pr.url) return null
      return { number: typeof pr.number === "number" ? pr.number : null, url: pr.url }
    } catch {
      return null
    }
  }

  private githubRepoForRemote(cwd: string, remote: string): string {
    const remoteUrl = execFileSync("git", ["-C", cwd, "remote", "get-url", remote], { encoding: "utf8" }).trim()
    const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/.exec(remoteUrl)
    if (httpsMatch?.[1]) return httpsMatch[1]
    const sshMatch = /^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/.exec(remoteUrl)
    if (sshMatch?.[1]) return sshMatch[1]
    throw new Error(`remote ${remote} is not a GitHub remote`)
  }

  private defaultBranchForRemote(cwd: string, remote: string): string {
    try {
      const ref = execFileSync("git", ["-C", cwd, "symbolic-ref", `refs/remotes/${remote}/HEAD`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      const prefix = `refs/remotes/${remote}/`
      if (ref.startsWith(prefix)) return ref.slice(prefix.length)
    } catch {}
    try {
      const output = execFileSync("git", ["-C", cwd, "remote", "show", remote], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      const match = output.match(/HEAD branch:\s*(\S+)/)
      if (match?.[1]) return match[1]
    } catch {}
    return "main"
  }

  async create(opts?: { name?: string; fromWorkspaceId?: string; kind?: WorkspaceKind }): Promise<WorkspaceMeta> {
    const id = this.nextWorkspaceId()
    const parentId = opts?.fromWorkspaceId ?? null
    const parentWs = parentId ? this.workspaces.get(parentId) : null
    const kind = opts?.kind ?? "code"
    const parentInst = parentWs ? this.activeInstance(parentWs) : null
    const sourceRoot = parentInst?.materializedRoot ?? this.projectRoot
    const instance = await this.createInstance(id, sourceRoot, parentInst?.index)

    const ws: WorkspaceRecord = {
      id,
      name: opts?.name ?? "workspace",
      kind,
      parentId,
      createdAt: Date.now(),
      baseInstanceId: instance.id,
      activeInstanceId: instance.id,
      goals: [],
      instances: { [instance.id]: instance },
    }
    this.workspaces.set(id, ws)
    this.save(ws)

    if (this.caps.storybook) {
      this.startStorybook(id, instance.materializedRoot).catch((e: any) => {
        console.error(`[workspace] storybook for ${id} failed to start:`, e.message)
      })
    }

    return this.toMeta(ws)
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
    return this.startStorybook(wsId, this.activeInstance(ws).materializedRoot)
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

    // Remove materialized instance directories
    for (const inst of Object.values(ws.instances)) {
      rmSync(inst.materializedRoot, { recursive: true, force: true })
    }

    // Remove workspace state
    this.store.deleteWorkspace(id)
    this.workspaces.delete(id)
  }

  resetAll(): void {
    this.abortAll()
    for (const id of [...this.workspaces.keys()]) {
      this.delete(id)
    }
    this.sbManager.shutdownAll()
    this.sessions.deleteAll()
    rmSync(this.runsDir, { recursive: true, force: true })
    mkdirSync(this.runsDir, { recursive: true })
    this.store.deleteAllWorkspaces()
    this.store.deleteAllPolicyEvents()
    this.workspaces.clear()
  }

  async addGoal(wsId: string, goal: Omit<Goal, "status">, opts?: { fork?: boolean }): Promise<AddGoalResult> {
    let ws = this.workspaces.get(wsId)
    if (!ws) return { error: "workspace not found", status: 404 }

    if (goal.mode === "code" && ws.kind === "arch") {
      this.recordPolicyEvent({
        type: "goal_rejected",
        workspaceId: ws.id,
        goalId: goal.id,
        message: "code goals cannot be added to architecture workspaces",
        details: {
          workspaceKind: ws.kind,
          goalMode: goal.mode,
        },
      })
      return { error: "code goals cannot be added to architecture workspaces", status: 409 }
    }

    if (goal.mode === "arch" && (ws.kind !== "arch" || opts?.fork === true)) {
      const sourceWs = ws
      const meta = await this.create({
        name: `arch: ${goal.label || goal.target}`,
        fromWorkspaceId: wsId,
        kind: "arch",
      })
      ws = this.workspaces.get(meta.id)
      if (!ws) return { error: "created architecture workspace could not be loaded", status: 500 }
      this.recordPolicyEvent({
        type: "arch_goal_redirected",
        workspaceId: sourceWs.id,
        goalId: goal.id,
        message: "architecture goal placed in a dedicated architecture workspace",
        details: {
          sourceWorkspaceId: sourceWs.id,
          sourceWorkspaceKind: sourceWs.kind,
          targetWorkspaceId: ws.id,
          targetWorkspaceKind: ws.kind,
          forkRequested: opts?.fork === true,
        },
      })
    }

    const g: Goal = { ...goal, status: "pending" }
    ws.goals.push(g)
    this.save(ws)
    return { goal: g, workspaceId: ws.id }
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
    return this.processGoal(wsId, null, onEvent)
  }

  /** Process a specific pending goal. Returns the goal ID, or null if it cannot run. */
  processById(wsId: string, goalId: string, onEvent: AgentEventCallback): string | null {
    return this.processGoal(wsId, goalId, onEvent)
  }

  unsubscribeGoalEvents(goalId: string, onEvent: AgentEventCallback): void {
    const subscribers = this.goalSubscribers.get(goalId)
    if (!subscribers) return
    subscribers.delete(onEvent)
    if (subscribers.size === 0) this.goalSubscribers.delete(goalId)
  }

  private subscribeGoalEvents(goalId: string, onEvent: AgentEventCallback): void {
    const subscribers = this.goalSubscribers.get(goalId) ?? new Set<AgentEventCallback>()
    subscribers.add(onEvent)
    this.goalSubscribers.set(goalId, subscribers)
  }

  private publishGoalEvent(goalId: string, event: AgentEvent, source: AgentEventCallback): void {
    const subscribers = this.goalSubscribers.get(goalId)
    if (!subscribers) return
    for (const subscriber of subscribers) {
      if (subscriber !== source) subscriber(event)
    }
    if (event.type === "done" || event.type === "error") this.goalSubscribers.delete(goalId)
  }

  private runningGoal(ws: WorkspaceRecord): Goal | undefined {
    return ws.goals.find((g) => g.status === "running" || this.runningAgents.has(g.id))
  }

  private processGoal(wsId: string, goalId: string | null, onEvent: AgentEventCallback): string | null {
    const ws = this.workspaces.get(wsId)
    if (!ws) { onEvent({ type: "error", message: "no such workspace" }); return null }
    const requestedGoal = goalId ? ws.goals.find((g) => g.id === goalId) : null
    if (goalId && !requestedGoal) {
      onEvent({ type: "error", message: "goal not found" })
      return null
    }
    const runningGoal = this.runningGoal(ws)
    if (runningGoal) {
      if (requestedGoal?.id === runningGoal.id || (requestedGoal && this.runningAgents.has(requestedGoal.id))) {
        this.subscribeGoalEvents(requestedGoal.id, onEvent)
        onEvent({ type: "status", goalId: requestedGoal.id, message: "attached to running agent" })
        return requestedGoal.id
      }
      if (requestedGoal && requestedGoal.status !== "pending") {
        onEvent({ type: "error", message: `goal is ${requestedGoal.status}` })
        return null
      }
      if (requestedGoal?.status === "pending" && requestedGoal.mode === ws.kind && !this.runningAgents.has(requestedGoal.id)) {
        this.subscribeGoalEvents(requestedGoal.id, onEvent)
        onEvent({
          type: "queued",
          goalId: requestedGoal.id,
          runningGoalId: runningGoal.id,
          message: "goal queued behind running agent",
        })
        return requestedGoal.id
      }

      const runningDetails: Record<string, unknown> = { workspaceKind: ws.kind }
      runningDetails["runningGoalId"] = runningGoal.id
      if (ws.kind === "arch") {
        this.recordPolicyEvent({
          type: "arch_agent_blocked",
          workspaceId: ws.id,
          message: "architecture workspace already has a running agent",
          goalId: runningGoal.id,
          details: runningDetails,
        })
      }
      onEvent({ type: "error", message: ws.kind === "arch" ? "architecture workspace already has a running agent" : "workspace already has a running agent" })
      return null
    }

    const goal = goalId
      ? requestedGoal
      : selectNextGoal(ws.goals, this.runningAgents)
    if (!goal) {
      onEvent({ type: "error", message: goalId ? "goal not found" : "no pending goals" })
      return null
    }
    if (goal.status !== "pending") {
      onEvent({ type: "error", message: `goal is ${goal.status}` })
      return null
    }
    if (this.runningAgents.has(goal.id)) {
      onEvent({ type: "error", message: "goal is already running" })
      return null
    }
    if (goal.mode !== ws.kind) {
      onEvent({ type: "error", message: `${goal.mode} goal cannot run in ${ws.kind} workspace` })
      return null
    }

    goal.status = "running"
    this.save(ws)

    this.runGoalAgent(ws, goal, onEvent)
    return goal.id
  }

  private maybeStartNextQueued(wsId: string): void {
    const ws = this.workspaces.get(wsId)
    if (!ws || this.runningGoal(ws)) return
    const goal = selectNextGoal(ws.goals, this.runningAgents)
    if (!goal || goal.mode !== ws.kind) return

    goal.status = "running"
    this.save(ws)
    this.runGoalAgent(ws, goal, () => undefined).catch((e) => {
      goal.status = "error"
      this.save(ws)
      console.error(`[workspace] failed to start queued goal ${goal.id}:`, e)
    })
  }

  private async runGoalAgent(ws: WorkspaceRecord, goal: Goal, onEvent: AgentEventCallback): Promise<void> {
    const baseInst = this.activeInstance(ws)
    const workingInst = await this.createInstance(ws.id, baseInst.materializedRoot, baseInst.index)
    ws.instances[workingInst.id] = workingInst
    this.save(ws)
    const dir = workingInst.materializedRoot

    // Architecture mode: strip bodies for this single architecture agent.
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
        ? buildArchPrompt(context, sandbox, goalLine)
        : buildImplPrompt(context, sandbox, goalLine, buildVerifyNote(!!this.caps.tests))

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
      this.publishGoalEvent(goal.id, evt, onEvent)
    }

    const child = this.spawnAgent(
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
    child.stdout?.on("data", (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        try { recordAndEmit({ type: "event", event: JSON.parse(line) }) } catch { recordAndEmit({ type: "raw", line }) }
      }
    })
    child.stderr?.on("data", (d) => recordAndEmit({ type: "stderr", message: d.toString() }))
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
      const oldIndex = baseInst.index as { files?: { component?: { captured?: { exportName: string; testFile: string; snapshot: string | null }[] } }[] } | null
      if (oldIndex?.files) {
        for (const f of oldIndex.files) {
          for (const component of indexComponents(f)) {
          if (!component.captured) continue
          for (const c of component.captured as { exportName: string; testFile: string; snapshot: string | null }[]) {
            baseSnapshots.set(`${c.testFile}::${c.exportName}`, c.snapshot)
          }
          }
        }
      }

      // Re-index workspace
      try {
        const reindexArgs = [resolve(this.logosTsRoot, "src/build-index.ts"), dir, "-"]
        const wsSbUrl = this.sbManager.get(ws.id)
        if (wsSbUrl) reindexArgs.push(wsSbUrl)
        const { stdout } = await execFileAsync(this.tsx, reindexArgs, { cwd: this.logosTsRoot, encoding: "utf8" })
        workingInst.index = JSON.parse(stdout)
        // Merge previousSnapshot from the base index
        const newIndex = workingInst.index as { files?: { component?: { captured?: { exportName: string; testFile: string; snapshot: string | null; previousSnapshot: string | null }[] }; components?: { captured?: { exportName: string; testFile: string; snapshot: string | null; previousSnapshot: string | null }[] }[] }[] }
        if (newIndex.files) {
          for (const f of newIndex.files) {
            for (const component of indexComponents(f) as { captured?: { exportName: string; testFile: string; snapshot: string | null; previousSnapshot: string | null }[] }[]) {
            if (!component.captured) continue
            for (const c of component.captured) {
              const prev = baseSnapshots.get(`${c.testFile}::${c.exportName}`) ?? null
              c.previousSnapshot = prev !== c.snapshot ? prev : null
            }
            }
          }
        }
      } catch (e) { console.error(`[logos] re-index failed for ${ws.id}:`, e) }

      goal.status = code === 0 ? "done" : "error"
      if (code === 0) {
        ws.activeInstanceId = workingInst.id
        this.sbManager.shutdown(ws.id)
        if (this.caps.storybook) {
          this.startStorybook(ws.id, workingInst.materializedRoot).catch((e: any) => {
            console.error(`[workspace] storybook for ${ws.id} failed to restart:`, e.message)
          })
        }
      }
      this.save(ws)
      rmSync(mcpConfigPath, { force: true })
      recordAndEmit({ type: "done", code })
      this.maybeStartNextQueued(ws.id)
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
