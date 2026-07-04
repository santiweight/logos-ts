/* eslint-disable no-restricted-syntax, @typescript-eslint/restrict-plus-operands, @typescript-eslint/prefer-readonly, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/use-unknown-in-catch-callback-variable */
// WorkspaceManager: owns workspace lifecycle, goal queue, and agent sequencing.
//
// Ontology:
//   Workspace  — user-facing intent container
//   Instance   — a materialized project tree on disk
//   Goal       — a change request to be achieved in a workspace
//   GoalQueue  — the ordered list of goals for a workspace (one per workspace)
//   AgentRun   — executes one goal in a workspace instance directory
//
import { existsSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync, realpathSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, relative, join, basename, dirname, sep } from "node:path"
import { execFileSync, execFile, spawn, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
import type { StorybookManager } from "./storybook-manager.js"
import type { RunManager } from "./run-manager.js"
import type { ClaudeSessionManager } from "./claude-session-manager.js"
import { buildGoalLine, buildImplPrompt, buildStoryGenerationSystemPrompt, buildVerifyNote, isStoryGenerationRequest, isWebResearchRequest, selectNextGoal } from "./prompt.js"
import { buildClaudePrintArgs, cleanEnvForClaude } from "./claude-cli.js"
import type { LogosSecrets } from "./logos-secrets.js"
import { WorkspaceCodeService, type RebaseInstanceResult } from "./workspace-code-service.js"
import type {
  StoredGoalLifecycle,
  StoredGoalMergePolicy,
  LogosRuntimeStore,
  StoredWorkspaceInitialization,
  StoredWorkspaceInitializationStep,
  StoredWorkspacePublication,
  StoredWorkspaceTracking,
  StoredWorkspaceType,
  WorkspaceKind,
} from "./runtime-store.js"
import { ensureStoryCaptureHarnessForRoot, missingStorySnapshotDependencies } from "./story-snapshots.js"
import { TsIndexCache } from "./ts-index-cache.js"
import { PROJECT_SOURCE_EXCLUDES } from "./project.js"
import { detectProject } from "./detect-project.js"

export interface GoalReply {
  author: "agent" | "user"
  text: string
  createdAt: number
}

function parsePngDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl.trim())
  if (!match?.[1]) return null
  try {
    return Buffer.from(match[1], "base64")
  } catch {
    return null
  }
}

export interface Goal {
  id: string
  text: string
  label: string
  target: string
  mode: "code"
  createdAt: number
  storyId?: string | null
  selector?: string | null
  component?: string | null
  appPath?: string | null
  runTargetId?: string | null
  screenshotDataUrl?: string | null
  status: "pending" | "running" | "done" | "error"
  lifecycle: StoredGoalLifecycle
  mergePolicy: StoredGoalMergePolicy
  baseInstanceId?: string | null
  workingInstanceId?: string | null
  mergedInstanceId?: string | null
  sessionId?: string | null
  replies?: GoalReply[]
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

interface WorkspaceRecordBase {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: Goal[]
  instances: Record<string, WorkspaceInstance>
  initialization?: StoredWorkspaceInitialization
  publication?: StoredWorkspacePublication
}

interface LocalWorkspaceRecord extends WorkspaceRecordBase {
  type: "local"
}

interface RemoteWorkspaceRecord extends WorkspaceRecordBase {
  type: "remote"
  tracking: StoredWorkspaceTracking
}

type WorkspaceRecord = LocalWorkspaceRecord | RemoteWorkspaceRecord

interface WorkspaceStateBase {
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
  initialization?: StoredWorkspaceInitialization
  publication?: StoredWorkspacePublication
}

export interface LocalWorkspaceState extends WorkspaceStateBase {
  type: "local"
}

export interface RemoteWorkspaceState extends WorkspaceStateBase {
  type: "remote"
  tracking: StoredWorkspaceTracking
}

export type WorkspaceState = LocalWorkspaceState | RemoteWorkspaceState

interface WorkspaceMetaBase {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: Goal[]
  initialization?: StoredWorkspaceInitialization
  publication?: StoredWorkspacePublication
  status?: string | null
}

export interface LocalWorkspaceMeta extends WorkspaceMetaBase {
  type: "local"
}

export interface RemoteWorkspaceMeta extends WorkspaceMetaBase {
  type: "remote"
  tracking: StoredWorkspaceTracking
}

export type WorkspaceMeta = LocalWorkspaceMeta | RemoteWorkspaceMeta

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

type AddGoalInput = Omit<Goal, "status" | "lifecycle" | "mergePolicy" | "workingInstanceId" | "mergedInstanceId" | "mode"> & {
  mode?: "code" | "arch"
}

export type WorkspacePolicyEventType =
  import("./runtime-store.js").WorkspacePolicyEventType

export type WorkspacePolicyEvent = import("./runtime-store.js").StoredWorkspacePolicyEvent

export interface AgentEvent {
  type: string
  [key: string]: unknown
}

export type GoalLifecycle = StoredGoalLifecycle
export type GoalMergePolicy = StoredGoalMergePolicy
export type MergeGoalResult =
  | { ok: true; status: "completed" | "resumed" }
  | { ok: false }

type AgentEventCallback = (event: AgentEvent) => void
type AgentSpawner = (command: string, args: string[], options: NonNullable<Parameters<typeof spawn>[2]>) => ChildProcess
type RunManagerLike = Pick<RunManager, "ensure" | "restart" | "shutdownWorkspace" | "shutdownAll">
const MAX_ACCEPTANCE_REPAIR_ATTEMPTS = 1
const INDEX_MAX_BUFFER = 128 * 1024 * 1024
const DEFAULT_MERGE_POLICY: GoalMergePolicy = { autoMerge: false }
const storyGenerationSystemArgs = () => ["--append-system-prompt", buildStoryGenerationSystemPrompt()]

const noopRunManager: RunManagerLike = {
  ensure: () => Promise.resolve(""),
  restart: () => Promise.resolve(""),
  shutdownWorkspace: () => {},
  shutdownAll: () => {},
}

function extractAgentSummary(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]!
    if (evt.type !== "event") continue
    const e = evt["event"] as Record<string, unknown> | undefined
    if (e?.["type"] !== "assistant") continue
    const content = (e["message"] as Record<string, unknown> | undefined)?.["content"] as { type: string; text?: string }[] | undefined
    if (!content) continue
    const texts = content.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text!.trim())
    if (texts.length > 0) return texts.join("\n\n")
  }
  return null
}

function setGoalLifecycle(goal: Goal, lifecycle: GoalLifecycle): void {
  goal.lifecycle = lifecycle
}

function isGoalReadyToMerge(goal: Goal): boolean {
  return goal.lifecycle.stage === "impl" && goal.lifecycle.state === "ready_to_merge"
}

function goalLifecycleLabel(lifecycle: GoalLifecycle): string {
  return `${lifecycle.stage}/${lifecycle.state}`
}

interface ProjectCaps {
  root: string
  storybook?: { configDir: string; frontendDir: string }
  storybooks?: { configDir: string; frontendDir: string }[]
  tests?: { command: string[]; watchDirs: string[] }
  runs?: { id: string; label: string; cwd: string; command: string; args: string[]; framework: "vite" | "next"; mode: "dev" | "preview"; env?: Record<string, string> }[]
  nodeModulesDirs: string[]
}

interface StorybookCapsResolution {
  sourceRoot: string
  storybooks: { configDir: string; frontendDir: string }[]
}

const DEFAULT_BRANCH = "main"

function defaultWorkspaceName(): string {
  const now = new Date()
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const day = days[now.getDay()]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const month = months[now.getMonth()]
  const date = now.getDate()
  const suffixes = ["th", "st", "nd", "rd"]
  const suffix = date % 10 <= 3 && Math.floor(date / 10) !== 1 ? suffixes[date % 10]! : "th"
  const h = now.getHours()
  const hour = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`
  return `Scratch (${day} ${month} ${date}${suffix} ${hour})`
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceRecord>()
  private runningAgents = new Map<string, ChildProcess>() // goalId → child
  private workspaceSeq = 0
  private deletingWorkspaces = new Set<string>()
  private initializingWorkspaces = new Set<string>()
  private workspaceStatuses = new Map<string, string>()
  private store: LogosRuntimeStore
  private runsDir: string
  private logosTsSrc: string
  private logosTsRoot: string
  private projectRoot: string
  private sourceProjectRoot: string
  private caps: ProjectCaps
  private sbManager: StorybookManager
  private runManager: RunManagerLike
  private sessions: ClaudeSessionManager
  private tsx: string
  private getIndex: (() => Promise<unknown>) | null
  private initializeWorkspaces: boolean
  private indexCache: TsIndexCache
  private goalSubscribers = new Map<string, Set<AgentEventCallback>>()
  private spawnAgent: AgentSpawner
  private secrets: LogosSecrets
  private codeService: WorkspaceCodeService
  private studioInstanceId: string
  private defaultBranch: string
  private goalWorkingInstances = new Map<string, string>()
  private acceptanceRepairAttempts = new Map<string, number>()

  constructor(opts: {
    store: LogosRuntimeStore
    runsDir: string
    logosTsSrc: string
    logosTsRoot: string
    projectRoot: string
    sourceProjectRoot?: string
    caps: ProjectCaps
    sbManager: StorybookManager
    runManager?: RunManager
    sessions: ClaudeSessionManager
    secrets: LogosSecrets
    tsx: string
    getIndex?: () => Promise<unknown>
    spawnAgent?: AgentSpawner
    initializeWorkspaces?: boolean
    installNodeModules?: boolean
    studioInstanceId?: string
    defaultBranch?: string
  }) {
    this.store = opts.store
    this.runsDir = opts.runsDir
    this.logosTsSrc = opts.logosTsSrc
    this.logosTsRoot = opts.logosTsRoot
    this.projectRoot = opts.projectRoot
    this.sourceProjectRoot = opts.sourceProjectRoot ?? opts.projectRoot
    this.caps = opts.caps
    this.sbManager = opts.sbManager
    this.runManager = opts.runManager ?? noopRunManager
    this.sessions = opts.sessions
    this.tsx = opts.tsx
    this.getIndex = opts.getIndex ?? null
    this.initializeWorkspaces = opts.initializeWorkspaces ?? true
    this.indexCache = new TsIndexCache({ logosTsRoot: this.logosTsRoot, tsx: this.tsx })
    this.secrets = opts.secrets
    this.spawnAgent = opts.spawnAgent ?? spawn
    this.studioInstanceId = opts.studioInstanceId ?? process.env["LOGOS_STUDIO_INSTANCE_ID"] ?? basename(this.projectRoot)
    this.defaultBranch = opts.defaultBranch ?? DEFAULT_BRANCH
    this.codeService = new WorkspaceCodeService({
      runsDir: this.runsDir,
      projectRoot: this.projectRoot,
      nodeModulesDirs: this.caps.nodeModulesDirs,
      ...(opts.installNodeModules === undefined ? {} : { installNodeModules: opts.installNodeModules }),
    })

    this.loadAll()
  }

  private static storedToRecord(stored: import("./runtime-store.js").StoredWorkspaceRecord): WorkspaceRecord {
    const base = {
      id: stored.id,
      name: stored.name,
      kind: stored.kind,
      parentId: stored.parentId,
      createdAt: stored.createdAt,
      baseInstanceId: stored.baseInstanceId,
      activeInstanceId: stored.activeInstanceId,
      goals: stored.goals as Goal[],
      instances: stored.instances as Record<string, WorkspaceInstance>,
      ...(stored.initialization ? { initialization: stored.initialization } : {}),
      ...(stored.publication ? { publication: stored.publication } : {}),
    }
    if (stored.type === "remote" && stored.tracking) {
      return { ...base, type: "remote", tracking: stored.tracking }
    }
    return { ...base, type: "local" }
  }

  private loadAll(): void {
    this.workspaces.clear()
    for (const stored of this.store.listWorkspaces()) {
      const ws = WorkspaceManager.storedToRecord(stored)
      let dirty = false
      for (const goal of ws.goals) {
        if (goal.status === "running") {
          goal.status = "pending"
          dirty = true
        }
      }
      if (WorkspaceManager.stripExcludedIndexFiles(ws)) dirty = true
      if (this.activateSingleReadyWorkingInstance(ws, { restartServices: true })) dirty = true
      if (dirty) this.store.saveWorkspace(ws)
      this.workspaces.set(ws.id, ws)
      if (this.initializeWorkspaces && ws.initialization?.status === "initializing") {
        queueMicrotask(() => this.initializeWorkspace(ws.id, ws.activeInstanceId))
      }
    }
  }

  private static stripExcludedIndexFiles(ws: WorkspaceRecord): boolean {
    const excludePatterns = PROJECT_SOURCE_EXCLUDES.map(
      (dir) => new RegExp(`(^|/)${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
    )
    const shouldExclude = (file: string) => excludePatterns.some((re) => re.test(file))
    let changed = false
    for (const inst of Object.values(ws.instances)) {
      const idx = inst.index as { files?: { file: string }[] } | undefined
      if (!idx?.files) continue
      const before = idx.files.length
      idx.files = idx.files.filter((f) => !shouldExclude(f.file))
      if (idx.files.length !== before) changed = true
    }
    return changed
  }

  private save(ws: WorkspaceRecord): void {
    this.store.saveWorkspace(ws)
  }

  private async snapshotIndex(root = this.projectRoot): Promise<unknown> {
    if (root === this.projectRoot && this.getIndex) return this.getIndex()
    return this.indexCache.buildIndex(root)
  }

  private activeInstance(ws: WorkspaceRecord): WorkspaceInstance {
    const inst = ws.instances[ws.activeInstanceId]
    if (!inst) throw new Error(`active instance not found for workspace ${ws.id}: ${ws.activeInstanceId}`)
    return inst
  }

  private rootWorkspace(): WorkspaceRecord | null {
    return [...this.workspaces.values()].find((ws) => ws.parentId === null) ?? null
  }

  private nextWorkspaceId(): string {
    this.workspaceSeq += 1
    return `ws-${Date.now()}-${this.workspaceSeq}`
  }

  private toState(ws: WorkspaceRecord): WorkspaceState {
    const inst = this.activeInstance(ws)
    const base = {
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
      ...(ws.initialization ? { initialization: ws.initialization } : {}),
      ...(ws.publication ? { publication: ws.publication } : {}),
    }
    if (ws.type === "remote") return { ...base, type: "remote", tracking: ws.tracking }
    return { ...base, type: "local" }
  }

  private toMeta(ws: WorkspaceRecord): WorkspaceMeta {
    const base = {
      id: ws.id,
      name: ws.name,
      kind: ws.kind,
      parentId: ws.parentId,
      createdAt: ws.createdAt,
      baseInstanceId: ws.baseInstanceId,
      activeInstanceId: ws.activeInstanceId,
      goals: ws.goals,
      ...(ws.initialization ? { initialization: ws.initialization } : {}),
      ...(ws.publication ? { publication: ws.publication } : {}),
      ...(this.workspaceStatuses.has(ws.id) ? { status: this.workspaceStatuses.get(ws.id) ?? null } : {}),
    }
    if (ws.type === "remote") return { ...base, type: "remote" as const, tracking: ws.tracking }
    return { ...base, type: "local" as const }
  }

  private storybookCapsForInstance(inst?: WorkspaceInstance): StorybookCapsResolution {
    if (!inst) return { sourceRoot: this.projectRoot, storybooks: [] }
    const detected = detectProject(inst.materializedRoot)
    return { sourceRoot: inst.materializedRoot, storybooks: detected.storybooks }
  }

  private storybookServiceId(inst: WorkspaceInstance, frontendDir: string, sourceRoot = this.projectRoot): string {
    const rel = relative(sourceRoot, frontendDir).replace(/\\/g, "/")
    return rel ? `${inst.id}:${rel}` : inst.id
  }

  private async createInstance(
    workspaceId: string,
    sourceRoot: string,
    index?: unknown,
    opts: { installNodeModules?: boolean } = {},
  ): Promise<WorkspaceInstance> {
    const inst = this.codeService.createInstance(workspaceId, sourceRoot, index ?? {}, opts)
    if (index) {
      inst.index = index
    } else {
      inst.index = await this.snapshotIndex(inst.materializedRoot)
    }
    return inst
  }

  private sourceProjectGitInfo(): { gitRoot: string; projectRel: string } {
    const sourceRoot = realpathSync(resolve(this.sourceProjectRoot))
    const gitRoot = realpathSync(execFileSync("git", ["-C", sourceRoot, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim())
    const projectRel = relative(gitRoot, sourceRoot)
    if (projectRel === ".." || projectRel.startsWith(`..${sep}`)) {
      throw new Error("source project is outside the git repository")
    }
    return { gitRoot, projectRel }
  }

  private checkoutDefaultBranchProject(): { root: string; cleanup: () => void } {
    const { gitRoot, projectRel } = this.sourceProjectGitInfo()
    const branch = this.defaultBranch
    try {
      execFileSync("git", ["-C", gitRoot, "fetch", "origin", branch], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {}
    let commit = ""
    try {
      commit = execFileSync("git", ["-C", gitRoot, "rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim()
    } catch {
      throw new Error(`origin/${branch} does not exist`)
    }
    if (!commit) throw new Error(`origin/${branch} does not exist`)

    const worktreeRoot = mkdtempSync(join(tmpdir(), `logos-origin-${branch}-`))
    try {
      execFileSync("git", ["-C", gitRoot, "worktree", "add", "--detach", worktreeRoot, commit], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (e) {
      rmSync(worktreeRoot, { recursive: true, force: true })
      throw e
    }

    return {
      root: projectRel ? join(worktreeRoot, projectRel) : worktreeRoot,
      cleanup: () => {
        try {
          execFileSync("git", ["-C", gitRoot, "worktree", "remove", "--force", worktreeRoot], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          })
        } catch {
          rmSync(worktreeRoot, { recursive: true, force: true })
        }
      },
    }
  }

  private async refreshFromRemote(ws: RemoteWorkspaceRecord): Promise<void> {
    const { gitRoot, projectRel } = this.sourceProjectGitInfo()
    const { remote, branch } = ws.tracking
    await execFileAsync("git", ["-C", gitRoot, "fetch", remote, branch], { encoding: "utf8" })

    const ref = `refs/remotes/${remote}/${branch}`
    const commit = execFileSync("git", ["-C", gitRoot, "rev-parse", "--verify", `${ref}^{commit}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
    if (!commit) throw new Error(`${ref} does not exist`)

    const worktreeRoot = mkdtempSync(join(tmpdir(), `logos-${remote}-${branch}-`))
    try {
      execFileSync("git", ["-C", gitRoot, "worktree", "add", "--detach", worktreeRoot, commit], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      const sourceRoot = projectRel ? join(worktreeRoot, projectRel) : worktreeRoot
      const newInst = await this.createInstance(ws.id, sourceRoot, undefined, { installNodeModules: false })
      ws.instances[newInst.id] = newInst
      ws.activeInstanceId = newInst.id
      this.save(ws)
    } finally {
      try {
        execFileSync("git", ["-C", gitRoot, "worktree", "remove", "--force", worktreeRoot], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch {
        rmSync(worktreeRoot, { recursive: true, force: true })
      }
    }
  }

  private async pushToRemote(ws: RemoteWorkspaceRecord, inst: WorkspaceInstance, commitMessage: string): Promise<void> {
    const { gitRoot, projectRel } = this.sourceProjectGitInfo()
    const { remote, branch } = ws.tracking
    const ref = `refs/remotes/${remote}/${branch}`

    const base = execFileSync("git", ["-C", gitRoot, "rev-parse", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()

    mkdirSync(this.runsDir, { recursive: true })
    const publishDir = resolve(this.runsDir, `.push-${remote}-${branch}-${Date.now()}`)
    try {
      execFileSync("git", ["-C", gitRoot, "worktree", "add", "--detach", publishDir, base], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })

      const targetRoot = projectRel ? join(publishDir, projectRel) : publishDir
      this.replaceTreeContents(inst.materializedRoot, targetRoot, { preserveGitDir: projectRel === "" })

      const addPath = projectRel || "."
      execFileSync("git", ["-C", publishDir, "add", "-A", "--", addPath], { encoding: "utf8" })
      const changed = execFileSync("git", ["-C", publishDir, "status", "--porcelain", "--", addPath], {
        encoding: "utf8",
      }).trim().length > 0

      if (changed) {
        execFileSync("git", ["-C", publishDir, "commit", "-m", commitMessage], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      }

      execFileSync("git", ["-C", publishDir, "push", remote, `HEAD:refs/heads/${branch}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
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

  private createInitializationState(): StoredWorkspaceInitialization {
    return {
      status: "initializing",
      updatedAt: Date.now(),
      steps: [
        { id: "materialize", label: "Materialize workspace", status: "done" },
        { id: "install_dependencies", label: "Install dependencies", status: "pending" },
        { id: "story_snapshots", label: "Capture story snapshots", status: "pending" },
        { id: "commit_baseline", label: "Commit snapshot baseline", status: "pending" },
        { id: "index", label: "Index workspace", status: "pending" },
      ],
    }
  }

  private setInitializationStep(
    ws: WorkspaceRecord,
    stepId: StoredWorkspaceInitializationStep["id"],
    status: StoredWorkspaceInitializationStep["status"],
    detail?: string,
  ): void {
    if (!ws.initialization) ws.initialization = this.createInitializationState()
    ws.initialization.updatedAt = Date.now()
    const step = ws.initialization.steps.find((candidate) => candidate.id === stepId)
    if (!step) return
    step.status = status
    delete step.detail
    delete step.error
    if (detail && status === "error") step.error = detail
    else if (detail) step.detail = detail
    this.save(ws)
  }

  private setInitializationStatus(ws: WorkspaceRecord, status: StoredWorkspaceInitialization["status"]): void {
    if (!ws.initialization) ws.initialization = this.createInitializationState()
    ws.initialization.status = status
    ws.initialization.updatedAt = Date.now()
    this.save(ws)
  }

  private failWorkspaceInitialization(ws: WorkspaceRecord, message: string): void {
    this.setInitializationStatus(ws, "error")
    for (const goal of ws.goals.filter((candidate) => candidate.status === "pending")) {
      this.publishGoalEvent(goal.id, {
        type: "error",
        goalId: goal.id,
        message: `workspace initialization failed: ${message}`,
      }, () => undefined)
    }
  }

  private async initializeWorkspace(workspaceId: string, instanceId: string): Promise<void> {
    if (this.initializingWorkspaces.has(workspaceId)) return
    this.initializingWorkspaces.add(workspaceId)
    try {
      const ws = this.workspaces.get(workspaceId)
      if (!ws || this.deletingWorkspaces.has(workspaceId)) return
      const inst = ws.instances[instanceId]
      if (!inst) return

      this.setInitializationStep(ws, "install_dependencies", "running")
      this.codeService.ensureNodeModules(inst)
      if (this.deletingWorkspaces.has(workspaceId) || !this.workspaces.has(workspaceId)) return
      this.setInitializationStep(ws, "install_dependencies", "done")

      this.setInitializationStep(ws, "story_snapshots", "running")
      const snapshots = await this.runStorySnapshotAcceptance(inst)
      if (this.deletingWorkspaces.has(workspaceId) || !this.workspaces.has(workspaceId)) return
      if (!snapshots.ok) {
        this.setInitializationStep(ws, "story_snapshots", "error", snapshots.output)
        this.failWorkspaceInitialization(ws, snapshots.output)
        console.warn(`[logos] story snapshot capture failed for ${inst.id}: ${snapshots.output}`)
        return
      }
      this.setInitializationStep(ws, "story_snapshots", "done", snapshots.output)

      this.setInitializationStep(ws, "commit_baseline", "running")
      await this.codeService.commitWorkspaceChanges(inst, "Logos story snapshots")
      if (this.deletingWorkspaces.has(workspaceId) || !this.workspaces.has(workspaceId)) return
      this.setInitializationStep(ws, "commit_baseline", "done")

      this.setInitializationStep(ws, "index", "running")
      inst.index = await this.snapshotIndex(inst.materializedRoot)
      if (this.deletingWorkspaces.has(workspaceId) || !this.workspaces.has(workspaceId)) return
      this.setInitializationStep(ws, "index", "done")
      this.setInitializationStatus(ws, "ready")
      this.restartWorkspaceServices(ws, inst)
      this.maybeStartNextQueued(ws.id)
    } catch (e) {
      const ws = this.workspaces.get(workspaceId)
      if (!ws || this.deletingWorkspaces.has(workspaceId)) return
      const message = e instanceof Error ? e.message : String(e)
      const runningStep = ws.initialization?.steps.find((step) => step.status === "running")
      if (runningStep) this.setInitializationStep(ws, runningStep.id, "error", message)
      this.failWorkspaceInitialization(ws, message)
      console.error(`[workspace] initialization for ${workspaceId} failed:`, message)
    } finally {
      this.initializingWorkspaces.delete(workspaceId)
    }
  }

  private async prepareStorySnapshotsForInstance(inst: WorkspaceInstance): Promise<{ ok: boolean; output: string }> {
    const snapshots = await this.runStorySnapshotAcceptance(inst)
    if (!snapshots.ok) return snapshots
    await this.codeService.commitWorkspaceChanges(inst, "Logos story snapshots")
    inst.index = await this.snapshotIndex(inst.materializedRoot)
    return snapshots
  }

  // --- public API ---

  list(): WorkspaceMeta[] {
    return [...this.workspaces.values()].map((ws) => this.toMeta(ws))
  }

  get(id: string): WorkspaceState | undefined {
    const ws = this.workspaces.get(id)
    return ws ? this.toState(ws) : undefined
  }

  screenshotPath(workspaceId: string, instanceId: string, storyFile: string): string | null {
    const ws = this.workspaces.get(workspaceId)
    if (!ws) return null
    const inst = ws.instances[instanceId]
    if (!inst) return null
    const file = join(inst.materializedRoot, ".logos", "__snapshots__", "story-snapshots", `${storyFile}.png`)
    return existsSync(file) ? file : null
  }

  listPolicyEvents(opts?: { workspaceId?: string; limit?: number }): WorkspacePolicyEvent[] {
    return this.store.listPolicyEvents(opts)
  }

  private recordPolicyEvent(event: Omit<WorkspacePolicyEvent, "seq" | "createdAt">): void {
    this.store.addPolicyEvent(event)
  }

  async reindex(id: string, opts?: { goalId?: string | null }): Promise<WorkspaceState | undefined> {
    const ws = this.workspaces.get(id)
    if (!ws) return undefined
    const review = this.reviewInstanceForGoal(ws, opts?.goalId)
    const inst = review?.instance ?? this.activeInstance(ws)
    if (review && isGoalReadyToMerge(review.goal)) await this.captureReviewSnapshots(ws, review.goal, inst, () => undefined)
    await this.reindexInstance(ws, inst)
    this.save(ws)
    return this.toState(ws)
  }

  private reviewInstanceForGoal(ws: WorkspaceRecord, goalId?: string | null): { goal: Goal; instance: WorkspaceInstance } | null {
    if (!goalId) return null
    const goal = ws.goals.find((candidate) => candidate.id === goalId)
    if (!goal) return null
    const instanceId = goal.workingInstanceId ?? goal.mergedInstanceId
    const instance = instanceId ? ws.instances[instanceId] ?? null : null
    return instance ? { goal, instance } : null
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

      const result = {
        branchName: branch,
        remote,
        commit,
        changed,
        ...(pullRequest ? { pullRequest } : {}),
      }
      ws.publication = { ...result, updatedAt: Date.now() }
      this.save(ws)
      return result
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

  async ensureOriginMainWorkspace(): Promise<WorkspaceMeta> {
    const existing = this.rootWorkspace()
    if (existing) return this.toMeta(existing)

    const id = this.nextWorkspaceId()
    const checkout = this.checkoutDefaultBranchProject()
    let instance: WorkspaceInstance
    try {
      const sourceIndex = this.getIndex ? await this.getIndex() : undefined
      instance = await this.createInstance(id, checkout.root, sourceIndex, {
        installNodeModules: !this.initializeWorkspaces,
      })
    } finally {
      checkout.cleanup()
    }

    const ws: RemoteWorkspaceRecord = {
      id,
      type: "remote",
      tracking: { remote: "origin", branch: this.defaultBranch },
      name: `origin/${this.defaultBranch}`,
      kind: "code",
      parentId: null,
      createdAt: Date.now(),
      baseInstanceId: instance.id,
      activeInstanceId: instance.id,
      goals: [],
      instances: { [instance.id]: instance },
      ...(this.initializeWorkspaces ? { initialization: this.createInitializationState() } : {}),
    }
    this.workspaces.set(id, ws)
    this.save(ws)

    if (this.initializeWorkspaces) setTimeout(() => this.initializeWorkspace(id, instance.id), 0)
    else this.restartWorkspaceServices(ws, instance)
    return this.toMeta(ws)
  }

  async create(opts?: { name?: string; fromWorkspaceId?: string; kind?: WorkspaceKind | "arch" }): Promise<WorkspaceMeta> {
    let parentId = opts?.fromWorkspaceId ?? null
    let parentWs = parentId ? this.workspaces.get(parentId) : null

    if (parentId && !parentWs) throw new Error(`parent workspace not found: ${parentId}`)

    if (!parentWs) {
      const hadRoot = this.rootWorkspace() != null
      const root = await this.ensureOriginMainWorkspace()
      if (!hadRoot && !opts?.name) return root
      parentId = root.id
      parentWs = this.workspaces.get(root.id) ?? null
    }

    if (!parentId || !parentWs) throw new Error("parent workspace is required")

    const id = this.nextWorkspaceId()
    const parentInst = this.activeInstance(parentWs)
    const instance = await this.createInstance(id, parentInst.materializedRoot, parentInst.index, {
      installNodeModules: !this.initializeWorkspaces,
    })

    const ws: LocalWorkspaceRecord = {
      id,
      type: "local",
      name: opts?.name ?? defaultWorkspaceName(),
      kind: "code",
      parentId,
      createdAt: Date.now(),
      baseInstanceId: instance.id,
      activeInstanceId: instance.id,
      goals: [],
      instances: { [instance.id]: instance },
      ...(this.initializeWorkspaces ? { initialization: this.createInitializationState() } : {}),
    }
    this.workspaces.set(id, ws)
    this.save(ws)

    if (this.initializeWorkspaces) setTimeout(() => this.initializeWorkspace(id, instance.id), 0)
    else this.restartWorkspaceServices(ws, instance)
    return this.toMeta(ws)
  }

  private startStorybooks(inst: WorkspaceInstance): Promise<string[]> {
    const { sourceRoot, storybooks } = this.storybookCapsForInstance(inst)
    if (storybooks.length === 0) return Promise.reject(new Error("storybook is not configured for this project"))
    this.codeService.ensureNodeModules(inst)
    return Promise.all(storybooks.map((storybook) => {
      const wsFrontend = join(inst.materializedRoot, relative(sourceRoot, storybook.frontendDir))
      this.sbManager.prepare(wsFrontend)
      return this.sbManager.ensure(this.storybookServiceId(inst, storybook.frontendDir, sourceRoot), wsFrontend)
    }))
  }

  /** Start (or restart after a failure) the Storybook for a workspace. Idempotent. */
  ensureStorybook(wsId: string): Promise<string> {
    const ws = this.workspaces.get(wsId)
    if (!ws) return Promise.reject(new Error("no such workspace"))
    return this.startStorybooks(this.activeInstance(ws)).then((urls) => urls[0] ?? "")
  }

  ensureRun(wsId: string, targetId: string, opts?: { restart?: boolean }): Promise<string> {
    const ws = this.workspaces.get(wsId)
    if (!ws) return Promise.reject(new Error("no such workspace"))
    const target = (this.caps.runs ?? []).find((candidate) => candidate.id === targetId)
    if (!target) return Promise.reject(new Error("run target not found"))
    const inst = this.activeInstance(ws)
    this.codeService.ensureNodeModules(inst)
    const root = inst.materializedRoot
    return opts?.restart
      ? this.runManager.restart(wsId, root, target)
      : this.runManager.ensure(wsId, root, target)
  }

  delete(id: string): void {
    const ws = this.workspaces.get(id)
    if (!ws) return
    this.deletingWorkspaces.add(id)
    this.workspaceStatuses.set(id, "Stopping agents…")

    // Reparent children to this workspace's parent (keep their commits intact)
    for (const child of this.workspaces.values()) {
      if (child.parentId !== id) continue
      child.parentId = ws.parentId
      this.save(child)
    }

    // Kill any running agents for this workspace's goals
    for (const g of ws.goals) {
      const child = this.runningAgents.get(g.id)
      if (child) { try { child.kill() } catch {} }
      this.runningAgents.delete(g.id)
    }

    // Shutdown workspace storybooks
    this.workspaceStatuses.set(id, "Shutting down storybooks…")
    this.shutdownWorkspaceStorybooks(ws)
    this.runManager.shutdownWorkspace(id)

    // Remove sessions
    this.sessions.deleteByWorkspace(id)

    // Remove materialized instance directories
    this.workspaceStatuses.set(id, "Removing files…")
    for (const inst of Object.values(ws.instances)) {
      rmSync(inst.materializedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    // Remove workspace state
    this.store.deleteWorkspace(id)
    this.workspaces.delete(id)
    this.workspaceStatuses.delete(id)
  }

  resetAll(): void {
    this.abortAll()
    this.sbManager.shutdownAll()
    this.runManager.shutdownAll()
    this.sessions.deleteAll()
    rmSync(this.runsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    mkdirSync(this.runsDir, { recursive: true })
    this.store.deleteAllWorkspaces()
    this.store.deleteAllPolicyEvents()
    this.workspaces.clear()
    this.deletingWorkspaces.clear()
  }

  async addGoal(
    wsId: string,
    goal: AddGoalInput,
    opts?: { fork?: boolean },
  ): Promise<AddGoalResult> {
    let ws = this.workspaces.get(wsId)
    if (!ws) return { error: "workspace not found", status: 404 }

    const g: Goal = {
      ...goal,
      mode: "code",
      status: "pending",
      lifecycle: { stage: "initializing", state: "creating_goal" },
      mergePolicy: DEFAULT_MERGE_POLICY,
      baseInstanceId: null,
      workingInstanceId: null,
      mergedInstanceId: null,
    }
    ws.goals.push(g)
    this.save(ws)
    return { goal: g, workspaceId: ws.id }
  }

  renameGoal(wsId: string, goalId: string, label: string): Goal | null {
    const ws = this.workspaces.get(wsId)
    if (!ws) return null
    const goal = ws.goals.find((g) => g.id === goalId)
    if (!goal) return null
    goal.label = label
    this.save(ws)
    return goal
  }

  async mergeGoal(wsId: string, goalId: string, onEvent: AgentEventCallback): Promise<MergeGoalResult> {
    const ws = this.workspaces.get(wsId)
    if (!ws) { onEvent({ type: "error", message: "no such workspace" }); return { ok: false } }
    const goal = ws.goals.find((g) => g.id === goalId)
    if (!goal) { onEvent({ type: "error", message: "goal not found" }); return { ok: false } }
    if (!isGoalReadyToMerge(goal)) {
      onEvent({ type: "error", message: `goal is ${goalLifecycleLabel(goal.lifecycle)}` })
      return { ok: false }
    }
    const instId = goal.workingInstanceId
    const inst = instId ? ws.instances[instId] : null
    if (!inst) { onEvent({ type: "error", message: "working instance not found" }); return { ok: false } }
    goal.status = "running"
    setGoalLifecycle(goal, { stage: "merging", state: "queued" })
    this.save(ws)

    const completed = await this.acceptCodeGoalResult(ws, goal, inst, onEvent)
    return { ok: true, status: completed ? "completed" : "resumed" }
  }

  async rebaseGoal(wsId: string, goalId: string, onEvent: AgentEventCallback): Promise<{ ok: boolean }> {
    const ws = this.workspaces.get(wsId)
    if (!ws) { onEvent({ type: "error", message: "no such workspace" }); return { ok: false } }
    const goal = ws.goals.find((g) => g.id === goalId)
    if (!goal) { onEvent({ type: "error", message: "goal not found" }); return { ok: false } }
    if (!isGoalReadyToMerge(goal)) {
      onEvent({ type: "error", message: `goal is ${goalLifecycleLabel(goal.lifecycle)}` })
      return { ok: false }
    }
    const instId = goal.workingInstanceId
    const inst = instId ? ws.instances[instId] : null
    if (!inst) { onEvent({ type: "error", message: "working instance not found" }); return { ok: false } }

    const targetWs = ws.parentId ? this.workspaces.get(ws.parentId) ?? ws : ws
    const activeInst = this.activeInstance(targetWs)
    if (inst.id === activeInst.id || goal.baseInstanceId === activeInst.id) {
      onEvent({ type: "status", goalId: goal.id, message: "already up to date" })
      return { ok: true }
    }

    onEvent({ type: "status", goalId: goal.id, message: "rebasing onto latest…" })
    const rebase = await this.codeService.rebaseInstance({
      workspaceId: targetWs.id,
      instance: inst,
      onto: activeInst,
    })

    if (rebase.status === "conflicts" || rebase.status === "error") {
      onEvent({ type: "error", goalId: goal.id, message: `rebase failed: ${rebase.message}` })
      return { ok: false }
    }

    goal.baseInstanceId = activeInst.id
    await this.reindexInstance(ws, inst)
    this.save(ws)
    onEvent({ type: "status", goalId: goal.id, message: "rebased successfully" })
    return { ok: true }
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

  private goalAwaitingMerge(ws: WorkspaceRecord): Goal | undefined {
    return ws.goals.find(isGoalReadyToMerge)
  }

  private activateSingleReadyWorkingInstance(ws: WorkspaceRecord, opts: { restartServices?: boolean } = {}): boolean {
    if (ws.goals.length !== 1) return false
    const goal = ws.goals[0]!
    if (!isGoalReadyToMerge(goal) || !goal.workingInstanceId) return false
    const inst = ws.instances[goal.workingInstanceId]
    if (!inst || ws.activeInstanceId === inst.id) return false
    ws.activeInstanceId = inst.id
    if (opts.restartServices) this.restartWorkspaceServices(ws, inst)
    return true
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
    if (requestedGoal && (requestedGoal.status === "running" || this.runningAgents.has(requestedGoal.id))) {
      this.subscribeGoalEvents(requestedGoal.id, onEvent)
      onEvent({ type: "status", goalId: requestedGoal.id, message: "attached to running agent" })
      return requestedGoal.id
    }

    const awaitingMerge = this.goalAwaitingMerge(ws)
    if (awaitingMerge && requestedGoal?.id !== awaitingMerge.id) {
      onEvent({
        type: "error",
        goalId: awaitingMerge.id,
        message: "workspace has a goal ready to merge",
      })
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
    goal.mode = "code"
    if (ws.initialization?.status === "error") {
      onEvent({ type: "error", goalId: goal.id, message: "workspace initialization failed" })
      return null
    }
    if (ws.initialization?.status === "initializing") {
      this.subscribeGoalEvents(goal.id, onEvent)
      onEvent({
        type: "queued",
        goalId: goal.id,
        message: "goal queued behind workspace initialization",
      })
      return goal.id
    }

    goal.status = "running"
    setGoalLifecycle(goal, { stage: "initializing", state: "creating_instance" })
    this.save(ws)

    this.runGoalAgent(ws, goal, onEvent).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      goal.status = "error"
      this.save(ws)
      onEvent({ type: "error", goalId: goal.id, message: `failed to start agent: ${message}` })
      this.publishGoalEvent(goal.id, { type: "error", goalId: goal.id, message: `failed to start agent: ${message}` }, onEvent)
      this.maybeStartNextQueued(ws.id)
    })
    return goal.id
  }

  private maybeStartNextQueued(wsId: string): void {
    const ws = this.workspaces.get(wsId)
    if (!ws || this.runningGoal(ws) || this.goalAwaitingMerge(ws)) return
    if (ws.initialization?.status === "initializing" || ws.initialization?.status === "error") return
    const goal = selectNextGoal(ws.goals, this.runningAgents)
    if (!goal) return

    goal.status = "running"
    setGoalLifecycle(goal, { stage: "initializing", state: "creating_instance" })
    this.save(ws)
    this.runGoalAgent(ws, goal, () => undefined).catch((e) => {
      goal.status = "error"
      this.save(ws)
      console.error(`[workspace] failed to start queued goal ${goal.id}:`, e)
    })
  }

  private async runGoalAgent(ws: WorkspaceRecord, goal: Goal, onEvent: AgentEventCallback): Promise<void> {
    const collectedEvents: AgentEvent[] = []
    const session = this.sessions.create(goal.id, ws.id)
    let sessionId = session.id
    goal.sessionId = sessionId
    this.save(ws)

    const recordAndEmit = (evt: AgentEvent) => {
      if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) return
      collectedEvents.push(evt)
      try {
        this.sessions.addEvent(sessionId, evt.type, evt)
      } catch (error) {
        if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) return
        throw error
      }

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

    recordAndEmit({ type: "status", goalId: goal.id, message: "preparing workspace instance…" })

    let workingInst: WorkspaceInstance
    try {
      const baseInst = this.activeInstance(ws)
      workingInst = await this.createInstance(ws.id, baseInst.materializedRoot, baseInst.index)
      ws.instances[workingInst.id] = workingInst
      this.goalWorkingInstances.set(goal.id, workingInst.id)
      goal.baseInstanceId = baseInst.id
      goal.workingInstanceId = workingInst.id
      this.save(ws)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      goal.status = "error"
      this.save(ws)
      recordAndEmit({ type: "error", goalId: goal.id, message: `failed to prepare workspace instance: ${message}` })
      this.maybeStartNextQueued(ws.id)
      return
    }

    const dir = workingInst.materializedRoot

    // Build context
    recordAndEmit({ type: "status", goalId: goal.id, message: "building architecture context…" })
    const targets = [goal.component ? `component:${goal.component}` : goal.target]
    let context = ""
    try {
      const { stdout } = await execFileAsync(this.tsx, [resolve(this.logosTsRoot, "src/context.ts"), dir, "40000", ...targets], {
        cwd: this.logosTsRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      })
      context = stdout
    } catch (e) {
      recordAndEmit({ type: "stderr", goalId: goal.id, message: "context build failed: " + String(e) })
    }

    const sandbox = `IMPORTANT: Your working directory is ${dir}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`
    const screenshotPath = this.materializeGoalScreenshot(goal, dir)
    const goalLine = buildGoalLine({ ...goal, screenshotPath })
    const prompt = buildImplPrompt(context, sandbox, goalLine, buildVerifyNote(!!this.caps.tests))

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

    setGoalLifecycle(goal, { stage: "initializing", state: "starting_session" })
    this.save(ws)
    recordAndEmit({ type: "status", goalId: goal.id, message: "starting agent…" })

    const child = this.spawnAgent(
      "claude",
      buildClaudePrintArgs({
        promptArg: prompt,
        outputFormat: "stream-json",
        verbose: true,
        mcpConfigPath,
        enableWebTools: isWebResearchRequest(goal.text),
        ...(isStoryGenerationRequest(goal.text) ? { extraArgs: storyGenerationSystemArgs() } : {}),
      }),
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        // Ownership tag: lets `ps -E` / a sweeper identify strays from dead sessions.
        env: {
          ...cleanEnvForClaude(this.secrets.anthropicApiKey),
          LOGOS_SESSION: basename(this.projectRoot),
          LOGOS_STUDIO_INSTANCE_ID: this.studioInstanceId,
          LOGOS_WS: ws.id,
        },
      },
    )
    this.runningAgents.set(goal.id, child)
    setGoalLifecycle(goal, { stage: "impl", state: "agent_running" })
    this.save(ws)

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
      if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) {
        this.runningAgents.delete(goal.id)
        rmSync(mcpConfigPath, { force: true })
        return
      }

      rmSync(mcpConfigPath, { force: true })
      if (code !== 0) {
        this.runningAgents.delete(goal.id)
        goal.status = "error"
        setGoalLifecycle(goal, { stage: "impl", state: "impl_failed" })
        this.appendAgentSummary(goal, collectedEvents)
        this.save(ws)
        recordAndEmit({ type: "done", code })
        this.maybeStartNextQueued(ws.id)
        return
      }

      setGoalLifecycle(goal, { stage: "impl", state: "agent_finished" })
      this.save(ws)
      await this.captureReviewSnapshots(ws, goal, workingInst, recordAndEmit)
      await this.reindexInstance(ws, workingInst)
      this.runningAgents.delete(goal.id)
      goal.status = "done"
      setGoalLifecycle(goal, { stage: "impl", state: "ready_to_merge" })
      this.activateSingleReadyWorkingInstance(ws, { restartServices: true })
      this.appendAgentSummary(goal, collectedEvents)
      this.save(ws)
      recordAndEmit({ type: "done", code })
      return
    })
  }

  private appendAgentSummary(goal: Goal, events: AgentEvent[]): void {
    const summary = extractAgentSummary(events)
    if (!summary) return
    if (!goal.replies) goal.replies = []
    goal.replies.push({ author: "agent", text: summary, createdAt: Date.now() })
  }

  private async reindexInstance(ws: WorkspaceRecord, inst: WorkspaceInstance): Promise<void> {
    try {
      const reindexArgs = [resolve(this.logosTsRoot, "src/build-index.ts"), inst.materializedRoot, "-"]
      const wsSbUrl = this.sbManager.get(inst.id)
      if (wsSbUrl) reindexArgs.push(wsSbUrl)
      const { stdout } = await execFileAsync(this.tsx, reindexArgs, { cwd: this.logosTsRoot, encoding: "utf8", maxBuffer: INDEX_MAX_BUFFER })
      inst.index = JSON.parse(stdout)
    } catch (e) {
      console.error(`[logos] re-index failed for ${ws.id}:`, e)
    }
  }

  private async captureReviewSnapshots(
    ws: WorkspaceRecord,
    goal: Goal,
    inst: WorkspaceInstance,
    onEvent: AgentEventCallback,
  ): Promise<void> {
    onEvent({ type: "status", goalId: goal.id, message: "capturing review snapshots…" })
    const storySnapshots = await this.runStorySnapshotAcceptance(inst)
    if (!storySnapshots.ok) {
      onEvent({
        type: "status",
        goalId: goal.id,
        message: `review snapshot capture failed; source diff will still be available\n\n${storySnapshots.output}`,
      })
    }
    await this.reindexInstance(ws, inst)
  }

  private storybookDirsForInstance(inst: WorkspaceInstance): { frontendDir: string; configDir?: string } | null {
    const detected = detectProject(inst.materializedRoot)
    const storybook = detected.storybook
    if (!storybook) return null
    return storybook
  }

  private async ensureStorybookForInstance(inst: WorkspaceInstance): Promise<string | null> {
    const existing = this.sbManager.get(inst.id)
    if (existing) return existing
    try {
      const urls = await this.startStorybooks(inst)
      return urls[0] ?? null
    } catch {
      return null
    }
  }

  private async runStorySnapshotAcceptance(inst: WorkspaceInstance): Promise<{ ok: boolean; output: string }> {
    const dirs = this.storybookDirsForInstance(inst)
    if (!dirs) return { ok: true, output: "no Storybook configured" }
    this.sbManager.prepare(dirs.frontendDir)
    const generated = ensureStoryCaptureHarnessForRoot(inst.materializedRoot, dirs)
    if (generated.storyCount === 0) return { ok: true, output: "no stories to snapshot" }
    const missingDeps = missingStorySnapshotDependencies(generated.frontendDir)
    if (missingDeps.length > 0) {
      return {
        ok: false,
        output: [
          `Missing project devDependencies required for Logos story snapshots: ${missingDeps.join(", ")}`,
          `Install them in ${relative(inst.materializedRoot, generated.frontendDir) || "."} before initializing a workspace.`,
          `Example: pnpm add -D ${missingDeps.join(" ")}`,
        ].join("\n"),
      }
    }
    const storybookUrl = await this.ensureStorybookForInstance(inst)
    try {
      const { stdout, stderr } = await execFileAsync(this.tsx, [generated.captureScript], {
        cwd: generated.frontendDir,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_ENV: "test",
          ...(storybookUrl ? { LOGOS_STORYBOOK_URL: storybookUrl } : {}),
        },
      })
      return { ok: true, output: `${stdout}${stderr}`.trim() }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string }
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim() }
    }
  }

  private shutdownWorkspaceStorybooks(ws: WorkspaceRecord, preserveIds = new Set<string>()): void {
    if (!preserveIds.has(ws.id)) this.sbManager.shutdown(ws.id)
    for (const inst of Object.values(ws.instances)) {
      if (!preserveIds.has(inst.id)) this.sbManager.shutdown(inst.id)
      const { sourceRoot, storybooks } = this.storybookCapsForInstance(inst)
      for (const storybook of storybooks) {
        const id = this.storybookServiceId(inst, storybook.frontendDir, sourceRoot)
        if (!preserveIds.has(id)) this.sbManager.shutdown(id)
      }
    }
  }

  private restartWorkspaceServices(ws: WorkspaceRecord, inst: WorkspaceInstance): void {
    const { sourceRoot, storybooks } = this.storybookCapsForInstance(inst)
    const preservedStorybooks = new Set(
      storybooks.map((storybook) => this.storybookServiceId(inst, storybook.frontendDir, sourceRoot)),
    )
    this.shutdownWorkspaceStorybooks(ws, preservedStorybooks)
    this.runManager.shutdownWorkspace(ws.id)
    this.codeService.ensureNodeModules(inst)
    if (storybooks.length > 0) {
      this.startStorybooks(inst).catch((e: any) => {
        console.error(`[workspace] storybook for ${ws.id} failed to restart:`, e.message)
      })
    }
  }

  private async runAcceptanceTests(inst: WorkspaceInstance): Promise<{ ok: boolean; output: string }> {
    if (!this.caps.tests) return { ok: true, output: "no acceptance tests configured" }
    const [cmd, ...args] = this.caps.tests.command
    if (!cmd) return { ok: true, output: "no acceptance tests configured" }
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: inst.materializedRoot,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          LOGOS_VITEST_CACHE_DIR: resolve(inst.materializedRoot, ".logos_cache", "acceptance-tests"),
          NODE_ENV: "test",
        },
      })
      return { ok: true, output: `${stdout}${stderr}`.trim() }
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string }
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim() }
    }
  }

  private buildRebasePrompt(result: Extract<RebaseInstanceResult, { status: "conflicts" }>): string {
    const contextLines = [
      result.context.status && `git status --short:\n${result.context.status}`,
      result.context.unmergedFiles.length > 0 && `Unmerged files:\n${result.context.unmergedFiles.map((file) => `- ${file}`).join("\n")}`,
      result.context.generatedSnapshotFiles.length > 0 && `Generated snapshot conflicts:\n${result.context.generatedSnapshotFiles.map((file) => `- ${file}`).join("\n")}`,
      result.context.conflictedFiles.length > 0 && `Conflict marker counts:\n${result.context.conflictedFiles.map((file) => `- ${file.path}: ${file.conflictMarkers}`).join("\n")}`,
    ].filter(Boolean).join("\n\n")

    return `Your changes need to be rebased onto the latest workspace instance, and the rebase has conflicts.\n\n` +
      `Here is the current rebase state so you do not need to rediscover it with obvious status commands:\n\n` +
      `${contextLines || "(no additional conflict context available)"}\n\n` +
      `Use command-line commands through the UI with \`!\` only for the edits and rebase steps you still need. Useful commands:\n` +
      `${result.suggestedCommands.map((cmd) => `- ${cmd}`).join("\n")}\n\n` +
      `After resolving conflicts, run the configured tests, continue the rebase if needed, and finish again with a brief summary.\n\n` +
      `Rebase output:\n${result.message}`
  }

  private buildTestFailurePrompt(output: string): string {
    const testCommand = this.caps.tests?.command.join(" ") ?? "the configured test command"
    return `Your changes rebased cleanly, but acceptance tests failed after integration.\n\n` +
      `Use command-line commands through the UI with \`!\`. Run \`!${testCommand}\`, fix the failures, rerun tests, and finish again with a brief summary.\n\n` +
      `Test output:\n${output}`
  }

  private async acceptCodeGoalResult(
    ws: WorkspaceRecord,
    goal: Goal,
    workingInst: WorkspaceInstance,
    onEvent: AgentEventCallback,
    opts?: { externalOnEvent?: AgentEventCallback },
  ): Promise<boolean> {
    const targetWs = ws.parentId ? this.workspaces.get(ws.parentId) ?? ws : ws
    return this.codeService.withWorkspaceLock(targetWs.id, async () => {
      const resumeOnEvent = opts?.externalOnEvent ?? onEvent

      if (targetWs.type === "remote") {
        const { remote, branch } = targetWs.tracking
        onEvent({ type: "status", goalId: goal.id, message: `fetching latest ${remote}/${branch}…` })
        try {
          await this.refreshFromRemote(targetWs)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          goal.status = "error"
          setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
          this.save(ws)
          onEvent({ type: "error", goalId: goal.id, message: `failed to fetch ${remote}/${branch}: ${message}` })
          return true
        }
      }

      const activeInst = this.activeInstance(targetWs)
      setGoalLifecycle(goal, { stage: "merging", state: "rebasing" })
      this.save(ws)
      onEvent({
        type: "status",
        goalId: goal.id,
        message: targetWs.type === "remote"
          ? `rebasing workspace instance onto ${targetWs.tracking.remote}/${targetWs.tracking.branch}…`
          : targetWs.id === ws.id
            ? "rebasing workspace instance…"
            : "rebasing workspace instance onto parent…",
      })
      let rebase: RebaseInstanceResult
      try {
        rebase = await this.codeService.rebaseInstance({
          workspaceId: targetWs.id,
          instance: workingInst,
          onto: activeInst,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        goal.status = "error"
        setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
        this.save(ws)
        onEvent({ type: "error", goalId: goal.id, message: `workspace rebase failed: ${message}` })
        return true
      }

      if (rebase.status === "conflicts") {
        setGoalLifecycle(goal, { stage: "merging", state: "merge_blocked" })
        this.save(ws)
        onEvent({ type: "status", goalId: goal.id, message: "rebase conflicts; asking agent to resolve…" })
        if (!this.resumeGoalInInstance(ws, goal, this.buildRebasePrompt(rebase), workingInst, resumeOnEvent, {
          recordUserReply: false,
          lifecycleOnStart: { stage: "merging", state: "resolving_conflicts" },
          continueMergeOnClose: true,
        })) {
          goal.status = "error"
          setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
          this.save(ws)
          onEvent({ type: "error", message: "failed to resume agent for rebase conflicts" })
          return true
        }
        return false
      }

      if (rebase.status === "error") {
        goal.status = "error"
        setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
        this.save(ws)
        onEvent({ type: "error", goalId: goal.id, message: `workspace rebase failed: ${rebase.message}` })
        return true
      }

      if (rebase.message.startsWith("Auto-resolved generated snapshot rebase conflicts")) {
        onEvent({
          type: "status",
          goalId: goal.id,
          message: "auto-resolved generated snapshot conflicts; acceptance tests will regenerate artifacts",
        })
      }
      onEvent({ type: "status", goalId: goal.id, message: "capturing story snapshots…" })
      const storySnapshots = await this.runStorySnapshotAcceptance(workingInst)
      if (!storySnapshots.ok) {
        const attempts = this.acceptanceRepairAttempts.get(goal.id) ?? 0
        if (attempts >= MAX_ACCEPTANCE_REPAIR_ATTEMPTS) {
          goal.status = "error"
          this.save(ws)
          onEvent({
            type: "error",
            goalId: goal.id,
            message: `story snapshot acceptance failed after ${attempts} repair attempt${attempts === 1 ? "" : "s"}; stopping automatic retries\n\n${storySnapshots.output}`,
          })
          return true
        }
        this.acceptanceRepairAttempts.set(goal.id, attempts + 1)
        onEvent({ type: "status", goalId: goal.id, message: "story snapshot acceptance failed; asking agent to fix…" })
        if (!this.resumeGoalInInstance(ws, goal, this.buildTestFailurePrompt(storySnapshots.output), workingInst, resumeOnEvent)) {
          goal.status = "error"
          this.save(ws)
          onEvent({ type: "error", message: "failed to resume agent after story snapshot failure" })
          return true
        }
        return false
      }

      setGoalLifecycle(goal, { stage: "merging", state: "running_tests" })
      this.save(ws)
      onEvent({ type: "status", goalId: goal.id, message: "running acceptance tests…" })
      const tests = await this.runAcceptanceTests(workingInst)
      if (!tests.ok) {
        const attempts = this.acceptanceRepairAttempts.get(goal.id) ?? 0
        if (attempts >= MAX_ACCEPTANCE_REPAIR_ATTEMPTS) {
          goal.status = "error"
          setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
          this.save(ws)
          onEvent({
            type: "error",
            goalId: goal.id,
            message: `acceptance tests still failed after ${attempts} repair attempt${attempts === 1 ? "" : "s"}; stopping automatic retries\n\n${tests.output}`,
          })
          return true
        }
        this.acceptanceRepairAttempts.set(goal.id, attempts + 1)
        setGoalLifecycle(goal, { stage: "merging", state: "repairing_tests" })
        this.save(ws)
        onEvent({ type: "status", goalId: goal.id, message: "acceptance tests failed; asking agent to fix…" })
        if (!this.resumeGoalInInstance(ws, goal, this.buildTestFailurePrompt(tests.output), workingInst, resumeOnEvent, {
          recordUserReply: false,
          lifecycleOnStart: { stage: "merging", state: "repairing_tests" },
          continueMergeOnClose: true,
        })) {
          goal.status = "error"
          setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
          this.save(ws)
          onEvent({ type: "error", message: "failed to resume agent after test failure" })
          return true
        }
        return false
      }

      const committedGeneratedChanges = await this.codeService.commitWorkspaceChanges(workingInst, "Logos acceptance updates")
      if (committedGeneratedChanges) onEvent({ type: "status", goalId: goal.id, message: "committed acceptance test updates" })
      await this.reindexInstance(ws, workingInst)
      setGoalLifecycle(goal, { stage: "merging", state: "promoting_instance" })
      this.save(ws)
      ws.activeInstanceId = workingInst.id
      goal.mergedInstanceId = workingInst.id
      goal.workingInstanceId = null
      this.restartWorkspaceServices(ws, workingInst)
      this.save(ws)
      if (targetWs.id !== ws.id) {
        const promotedInst = await this.createInstance(targetWs.id, workingInst.materializedRoot, workingInst.index)
        targetWs.instances[promotedInst.id] = promotedInst
        await this.reindexInstance(targetWs, promotedInst)
        targetWs.activeInstanceId = promotedInst.id
        this.restartWorkspaceServices(targetWs, promotedInst)
        this.save(targetWs)
        await this.refreshChildWorkspaces(targetWs, ws.id)
        await this.reparentChildWorkspaces(ws, targetWs)
      } else {
        await this.refreshChildWorkspaces(ws, null)
      }

      if (targetWs.type === "remote") {
        const { remote, branch } = targetWs.tracking
        const pushInst = this.activeInstance(targetWs)
        onEvent({ type: "status", goalId: goal.id, message: `pushing to ${remote}/${branch}…` })
        try {
          await this.pushToRemote(targetWs, pushInst, goal.label || goal.text)
          onEvent({ type: "status", goalId: goal.id, message: `pushed to ${remote}/${branch}` })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          goal.status = "error"
          setGoalLifecycle(goal, { stage: "merging", state: "merge_failed" })
          this.save(ws)
          onEvent({ type: "error", goalId: goal.id, message: `push to ${remote}/${branch} failed: ${message}` })
          return true
        }
      }

      goal.status = "done"
      setGoalLifecycle(goal, { stage: "merged", state: "complete" })
      this.goalWorkingInstances.delete(goal.id)
      this.acceptanceRepairAttempts.delete(goal.id)
      this.save(ws)
      onEvent({
        type: "status",
        goalId: goal.id,
        message: targetWs.id === ws.id
          ? "workspace instance accepted"
          : "workspace instance accepted into parent",
      })
      return true
    })
  }

  private async refreshChildWorkspaces(
    parentWs: WorkspaceRecord,
    skipChildId: string | null,
  ): Promise<void> {
    for (const child of this.workspaces.values()) {
      if (child.parentId !== parentWs.id || child.id === skipChildId) continue
      await this.retargetChildWorkspace(child, parentWs)
    }
  }

  private async reparentChildWorkspaces(fromParentWs: WorkspaceRecord, toParentWs: WorkspaceRecord): Promise<void> {
    for (const child of this.workspaces.values()) {
      if (child.parentId !== fromParentWs.id) continue
      await this.retargetChildWorkspace(child, toParentWs, { parentId: toParentWs.id })
    }
  }

  private async retargetChildWorkspace(
    child: WorkspaceRecord,
    parentWs: WorkspaceRecord,
    opts?: { parentId?: string },
  ): Promise<boolean> {
    const parentInst = this.activeInstance(parentWs)
    const activeInst = this.activeInstance(child)
    const baseInst = await this.createInstance(child.id, parentInst.materializedRoot, parentInst.index)
    const candidate = await this.createInstance(child.id, activeInst.materializedRoot, activeInst.index)
    child.instances[baseInst.id] = baseInst
    child.instances[candidate.id] = candidate
    const rebase = await this.codeService.rebaseInstance({
      workspaceId: child.id,
      instance: candidate,
      onto: baseInst,
    })
    if (rebase.status !== "clean") {
      delete child.instances[baseInst.id]
      delete child.instances[candidate.id]
      this.save(child)
      return false
    }

    const previousBaseId = child.baseInstanceId
    const previousActiveId = activeInst.id
    await this.reindexInstance(child, candidate)
    child.baseInstanceId = baseInst.id
    child.activeInstanceId = candidate.id
    if (opts?.parentId) child.parentId = opts.parentId
    for (const goal of child.goals) {
      if (goal.lifecycle.stage === "merged" && goal.lifecycle.state === "complete") continue
      if (goal.baseInstanceId === previousBaseId) goal.baseInstanceId = baseInst.id
      if (goal.workingInstanceId === previousActiveId) {
        goal.workingInstanceId = candidate.id
        this.goalWorkingInstances.set(goal.id, candidate.id)
      }
    }
    this.restartWorkspaceServices(child, candidate)
    this.save(child)
    return true
  }

  private writeMcpConfig(goalId: string, dir: string, suffix: string): string {
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
    const mcpConfigPath = resolve(this.runsDir, `${goalId}-${suffix}.mcp.json`)
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))
    return mcpConfigPath
  }

  private materializeGoalScreenshot(goal: Goal, dir: string): string | null {
    if (!goal.screenshotDataUrl) return null
    const parsed = parsePngDataUrl(goal.screenshotDataUrl)
    if (parsed == null) return null
    const rel = join(".logos", "goal-screenshots", `${goal.id}.png`)
    const abs = resolve(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, parsed)
    return rel.split(sep).join("/")
  }

  private resumeGoalInInstance(
    ws: WorkspaceRecord,
    goal: Goal,
    replyText: string,
    inst: WorkspaceInstance,
    onEvent: AgentEventCallback,
    opts?: { recordUserReply?: boolean; lifecycleOnStart?: GoalLifecycle; continueMergeOnClose?: boolean; treatAsImplementation?: boolean },
  ): boolean {
    if (!goal.sessionId) { onEvent({ type: "error", message: "no session to continue" }); return false }
    if (this.runningAgents.has(goal.id)) { onEvent({ type: "error", message: "goal is already running" }); return false }

    if (opts?.recordUserReply !== false) {
      if (!goal.replies) goal.replies = []
      goal.replies.push({ author: "user", text: replyText, createdAt: Date.now() })
    }
    goal.status = "running"
    setGoalLifecycle(goal, opts?.lifecycleOnStart ?? { stage: "impl", state: "agent_running" })
    this.goalWorkingInstances.set(goal.id, inst.id)
    goal.baseInstanceId ??= this.activeInstance(ws).id
    goal.workingInstanceId = inst.id
    this.save(ws)

    const dir = inst.materializedRoot
    const collectedEvents: AgentEvent[] = []
    let sessionId = goal.sessionId
    const mcpConfigPath = this.writeMcpConfig(goal.id, dir, `cont-${Date.now()}`)

    const recordAndEmit = (evt: AgentEvent) => {
      if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) return
      collectedEvents.push(evt)
      try {
        this.sessions.addEvent(sessionId, evt.type, evt)
      } catch (error) {
        if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) return
        throw error
      }
      onEvent(evt)
      this.publishGoalEvent(goal.id, evt, onEvent)
    }

    onEvent({ type: "status", goalId: goal.id, message: "continuing conversation…" })

    const child = this.spawnAgent(
      "claude",
      buildClaudePrintArgs({
        promptArg: replyText,
        resumeSessionId: sessionId,
        outputFormat: "stream-json",
        verbose: true,
        mcpConfigPath,
        enableWebTools: isWebResearchRequest(goal.text) || isWebResearchRequest(replyText),
        ...(isStoryGenerationRequest(goal.text) ? { extraArgs: storyGenerationSystemArgs() } : {}),
      }),
      {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...cleanEnvForClaude(this.secrets.anthropicApiKey),
          LOGOS_SESSION: basename(this.projectRoot),
          LOGOS_STUDIO_INSTANCE_ID: this.studioInstanceId,
          LOGOS_WS: ws.id,
        },
      },
    )
    this.runningAgents.set(goal.id, child)

    let buf = ""
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        try { recordAndEmit({ type: "event", event: JSON.parse(line) }) } catch { recordAndEmit({ type: "raw", line }) }
      }
    })
    child.stderr?.on("data", (d: Buffer) => recordAndEmit({ type: "stderr", message: d.toString() }))
    child.on("error", (e) => recordAndEmit({ type: "error", message: String(e) }))
    child.on("close", async (code) => {
      this.runningAgents.delete(goal.id)
      rmSync(mcpConfigPath, { force: true })
      if (this.deletingWorkspaces.has(ws.id) || !this.workspaces.has(ws.id)) return

      if (code !== 0) {
        goal.status = "error"
        setGoalLifecycle(goal, goal.lifecycle.stage === "merging"
          ? { stage: "merging", state: "merge_failed" }
          : { stage: "impl", state: "impl_failed" })
        this.appendAgentSummary(goal, collectedEvents)
        this.save(ws)
        recordAndEmit({ type: "done", code })
        this.maybeStartNextQueued(ws.id)
        return
      }

      setGoalLifecycle(goal, { stage: "impl", state: "agent_finished" })
      this.save(ws)
      if (!opts?.continueMergeOnClose) {
        await this.reindexInstance(ws, inst)
        goal.status = "done"
        setGoalLifecycle(goal, { stage: "impl", state: "ready_to_merge" })
        this.activateSingleReadyWorkingInstance(ws, { restartServices: true })
        this.appendAgentSummary(goal, collectedEvents)
        this.save(ws)
        recordAndEmit({ type: "done", code })
        return
      }

      const accepted = await this.acceptCodeGoalResult(ws, goal, inst, recordAndEmit, { externalOnEvent: onEvent })
      if (accepted) {
        this.appendAgentSummary(goal, collectedEvents)
        recordAndEmit({ type: "done", code })
        this.maybeStartNextQueued(ws.id)
      }
    })

    return true
  }

  continueGoal(wsId: string, goalId: string, replyText: string, onEvent: AgentEventCallback): boolean {
    const ws = this.workspaces.get(wsId)
    if (!ws) { onEvent({ type: "error", message: "no such workspace" }); return false }
    const goal = ws.goals.find((g) => g.id === goalId)
    if (!goal) { onEvent({ type: "error", message: "goal not found" }); return false }
    const workingInstanceId = this.goalWorkingInstances.get(goalId)
    const inst = workingInstanceId ? ws.instances[workingInstanceId] : this.activeInstance(ws)
    if (!inst) { onEvent({ type: "error", message: "working instance not found" }); return false }
    return this.resumeGoalInInstance(ws, goal, replyText, inst, onEvent)
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
