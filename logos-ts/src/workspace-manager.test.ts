import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { execFileSync } from "node:child_process"
import { afterEach, describe, it, expect, vi } from "vitest"
import { buildElementContext, buildGoalLine, selectNextGoal } from "./prompt.js"
import { WorkspaceManager, type AddGoalResult, type Goal } from "./workspace-manager.js"
import { LogosRuntimeStore } from "./runtime-store.js"

const LOGOS_TS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TSX = resolve(LOGOS_TS_ROOT, "node_modules/.bin/tsx")
const tempDirs: string[] = []

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

function goal(id: string, mode: Goal["mode"], status: Goal["status"] = "pending"): Goal {
  const lifecycle: Goal["lifecycle"] = status === "pending"
    ? { stage: "initializing", state: "creating_goal" }
    : status === "running"
      ? { stage: "impl", state: "agent_running" }
      : status === "done"
        ? { stage: "merged", state: "complete" }
        : { stage: "impl", state: "impl_failed" }
  return {
    id,
    text: "change it",
    label: "thing",
    target: "file:thing.ts",
    mode,
    createdAt: 1000,
    status,
    lifecycle,
    mergePolicy: { autoMerge: true },
  }
}

class FakeAgentProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  cwd = ""
  args: string[] = []

  kill(): boolean {
    this.killed = true
    return true
  }
}

function createSessions() {
  const events: { sessionId: string; type: string; payload: unknown }[] = []
  return {
    events,
    create: (goalId: string, workspaceId: string) => ({ id: `session-${goalId}`, goalId, workspaceId }),
    addEvent: (sessionId: string, type: string, payload: unknown) => { events.push({ sessionId, type, payload }) },
    setClaudeId: () => undefined,
    deleteByWorkspace: () => undefined,
    deleteAll: () => undefined,
  }
}

function createManager(opts?: {
  spawned?: FakeAgentProcess[]
  sessions?: ReturnType<typeof createSessions>
  sbManager?: Record<string, unknown>
  setupProject?: (projectRoot: string) => void
  caps?: Record<string, unknown> | ((projectRoot: string) => Record<string, unknown>)
  initializeWorkspaces?: boolean
  cacheNodeModules?: boolean
  tsx?: string
}): WorkspaceManager {
  const root = mkdtempSync(join(tmpdir(), "logos-workspace-manager-"))
  tempDirs.push(root)
  const projectRoot = join(root, "project")
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(join(projectRoot, "package.json"), "{}")
  opts?.setupProject?.(projectRoot)
  const sessions = opts?.sessions ?? createSessions()
  const store = new LogosRuntimeStore(join(root, ".logos", "runtime.db"))
  const sbManager = opts?.sbManager ?? { get: () => null, shutdown: () => undefined, prepare: () => undefined, ensure: () => Promise.resolve("") }
  const extraCaps = typeof opts?.caps === "function" ? opts.caps(projectRoot) : (opts?.caps ?? {})

  return new WorkspaceManager({
    store,
    runsDir: join(root, ".agent-runs"),
    logosTsSrc: join(LOGOS_TS_ROOT, "src"),
    logosTsRoot: LOGOS_TS_ROOT,
    projectRoot,
    caps: { root: projectRoot, nodeModulesDirs: [], ...extraCaps },
    sbManager: sbManager as any,
    sessions: sessions as any,
    tsx: opts?.tsx ?? TSX,
    getIndex: async () => ({ root: projectRoot, files: [] }),
    initializeWorkspaces: opts?.initializeWorkspaces ?? false,
    cacheNodeModules: opts?.cacheNodeModules ?? false,
    ...(opts?.spawned
      ? {
          spawnAgent: (_command, args, options) => {
            const child = new FakeAgentProcess()
            child.cwd = String(options.cwd ?? "")
            child.args = args
            opts.spawned!.push(child)
            return child as any
          },
        }
      : {}),
  })
}

async function waitFor(assertion: () => void, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  let lastError: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      assertion()
      return
    } catch (e) {
      lastError = e
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("element context prompt construction", () => {
  it("includes all three fields when present", () => {
    const line = buildGoalLine({
      label: "div · Senior Engineer",
      text: "Make this text bold",
      component: "JobTable",
      storyId: "components-jobtable--default",
      selector: ":scope > table > tbody > tr:nth-of-type(1) > td:nth-of-type(2)",
    })
    expect(line).toContain("component: JobTable")
    expect(line).toContain("story: components-jobtable--default")
    expect(line).toContain("element: :scope > table > tbody > tr:nth-of-type(1)")
    expect(line).toContain("Make this text bold")
    expect(line).toContain("div · Senior Engineer")
  })

  it("omits element context brackets when no fields are set", () => {
    const line = buildGoalLine({ label: "file.ts", text: "refactor this" })
    expect(line).toBe("- (file.ts) refactor this")
    expect(line).not.toContain("[")
  })

  it("handles partial fields (component only)", () => {
    const line = buildGoalLine({ label: "MyComp", text: "fix it", component: "MyComp" })
    expect(line).toBe("- (MyComp [component: MyComp]) fix it")
  })

  it("handles null/undefined fields without crashing", () => {
    const line = buildGoalLine({
      label: "div",
      text: "change color",
      component: null,
      storyId: null,
      selector: ":scope > div",
    })
    expect(line).toBe("- (div [element: :scope > div]) change color")
  })

  it("context string order is component, story, element", () => {
    const ctx = buildElementContext({
      component: "A",
      storyId: "b",
      selector: "c",
    })
    const parts = ctx.split(", ")
    expect(parts[0]).toMatch(/^component:/)
    expect(parts[1]).toMatch(/^story:/)
    expect(parts[2]).toMatch(/^element:/)
  })

  it("includes app run path context when present", () => {
    const line = buildGoalLine({
      label: "Search",
      text: "make this fuzzy",
      component: "DirectoryPage",
      appPath: "/",
      runTargetId: "root-app",
      selector: "body > main > form > input",
    })
    expect(line).toContain("component: DirectoryPage")
    expect(line).toContain("app path: /")
    expect(line).toContain("run target: root-app")
    expect(line).toContain("element: body > main > form > input")
  })
})

describe("selectNextGoal", () => {
  interface MinGoal {
    id: string
    status: "pending" | "running" | "done" | "error"
  }

  it("picks the first pending goal", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    expect(selectNextGoal(goals, new Set())?.id).toBe("g-2")
  })

  it("skips goals already running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
    ]
    expect(selectNextGoal(goals, new Set(["g-1"]))?.id).toBe("g-2")
  })

  it("returns undefined when all pending goals are running", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "done" },
    ]
    expect(selectNextGoal(goals, new Set(["g-1"]))).toBeUndefined()
  })

  it("returns undefined when no pending goals exist", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "done" },
      { id: "g-2", status: "error" },
    ]
    expect(selectNextGoal(goals, new Set())).toBeUndefined()
  })

  it("allows concurrent goals — multiple pending goals can each be selected", () => {
    const goals: MinGoal[] = [
      { id: "g-1", status: "pending" },
      { id: "g-2", status: "pending" },
      { id: "g-3", status: "pending" },
    ]
    const running = new Set<string>()

    const first = selectNextGoal(goals, running)!
    expect(first.id).toBe("g-1")
    running.add(first.id)

    const second = selectNextGoal(goals, running)!
    expect(second.id).toBe("g-2")
    running.add(second.id)

    const third = selectNextGoal(goals, running)!
    expect(third.id).toBe("g-3")
  })
})

describe("WorkspaceManager workspace kinds", () => {
  it("creates code workspaces by default and architecture workspaces when requested", async () => {
    const mgr = createManager()

    const code = await mgr.create()
    const arch = await mgr.create({ kind: "arch" })

    expect(code.kind).toBe("code")
    expect(arch.kind).toBe("arch")
    expect(mgr.get(code.id)?.kind).toBe("code")
    expect(mgr.get(arch.id)?.kind).toBe("arch")
  })

  it("tracks asynchronous workspace initialization", async () => {
    const mgr = createManager({ initializeWorkspaces: true })
    const code = await mgr.create({ kind: "code" })

    expect(mgr.get(code.id)?.initialization?.steps.map((step) => step.id)).toEqual([
      "materialize",
      "story_snapshots",
      "commit_baseline",
      "index",
    ])
    await waitFor(() => expect(mgr.get(code.id)?.initialization?.status).toBe("ready"))
  })

  it("returns a workspace before slow snapshot initialization completes", async () => {
    const mgr = createManager({ initializeWorkspaces: true })
    let snapshotsStarted!: () => void
    let releaseSnapshots!: () => void
    const snapshotsStartedPromise = new Promise<void>((resolve) => { snapshotsStarted = resolve })
    const releaseSnapshotsPromise = new Promise<void>((resolve) => { releaseSnapshots = resolve })
    ;(mgr as any).runStorySnapshotAcceptance = async () => {
      snapshotsStarted()
      await releaseSnapshotsPromise
      return { ok: true, output: "snapshots done" }
    }

    const code = await Promise.race([
      mgr.create({ kind: "code" }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ])

    expect(code).not.toBeNull()
    if (!code) throw new Error("workspace creation waited for snapshot initialization")
    await snapshotsStartedPromise
    expect(mgr.get(code.id)?.initialization?.status).toBe("initializing")
    expect(mgr.get(code.id)?.initialization?.steps.find((step) => step.id === "story_snapshots")?.status).toBe("running")

    releaseSnapshots()
    await waitFor(() => expect(mgr.get(code.id)?.initialization?.status).toBe("ready"))
  })

  it("forks from the parent workspace files, not the original project snapshot", async () => {
    const mgr = createManager()
    const parent = await mgr.create({ kind: "code" })
    const parentState = mgr.get(parent.id)
    if (!parentState) throw new Error("missing parent workspace")
    writeFileSync(join(parentState.forkDir, "parent-only.txt"), "from parent")

    const child = await mgr.create({ fromWorkspaceId: parent.id, kind: "code" })
    const childState = mgr.get(child.id)
    if (!childState) throw new Error("missing child workspace")

    expect(readFileSync(join(childState.forkDir, "parent-only.txt"), "utf8")).toBe("from parent")
  })

  it("forks dependency folders from the parent workspace instance", async () => {
    const mgr = createManager({
      cacheNodeModules: true,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "package.json"), JSON.stringify({
          name: `dependency-fork-${Date.now()}`,
          version: "1.0.0",
          dependencies: { storybook: "file:./local-storybook" },
        }))
        mkdirSync(join(projectRoot, "local-storybook", "bin"), { recursive: true })
        writeFileSync(join(projectRoot, "local-storybook", "package.json"), JSON.stringify({
          name: "storybook",
          version: "1.0.0",
          bin: { storybook: "bin/index.js" },
        }))
        writeFileSync(join(projectRoot, "local-storybook", "bin", "index.js"), "storybook bin")
      },
    })
    const parent = await mgr.create({ kind: "code" })
    const parentState = mgr.get(parent.id)
    if (!parentState) throw new Error("missing parent workspace")

    const child = await mgr.create({ fromWorkspaceId: parent.id, kind: "code" })
    const childState = mgr.get(child.id)
    if (!childState) throw new Error("missing child workspace")

    expect(readFileSync(join(childState.forkDir, "node_modules", ".bin", "storybook"), "utf8")).toBe("storybook bin")
  })

  function expectGoal(result: AddGoalResult): { goal: Goal; workspaceId: string } {
    if ("error" in result) throw new Error(result.error)
    return result
  }

  it("keeps code goals in code workspaces and forks arch goals from code workspaces", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })

    const codeResult = expectGoal(await mgr.addGoal(code.id, goal("code-goal", "code")))
    const archResult = expectGoal(await mgr.addGoal(code.id, goal("arch-goal", "arch")))

    expect(codeResult.goal.id).toBe("code-goal")
    expect(codeResult.workspaceId).toBe(code.id)
    expect(archResult.goal.id).toBe("arch-goal")
    expect(archResult.workspaceId).not.toBe(code.id)
    expect(mgr.get(archResult.workspaceId)?.kind).toBe("arch")
    expect(mgr.get(archResult.workspaceId)?.parentId).toBe(code.id)
  })

  it("records a policy event when an architecture goal is redirected", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })

    const archResult = expectGoal(await mgr.addGoal(code.id, goal("arch-goal", "arch")))
    const events = mgr.listPolicyEvents({ workspaceId: code.id })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seq: 0,
      type: "arch_goal_redirected",
      workspaceId: code.id,
      goalId: "arch-goal",
      message: "architecture goal placed in a dedicated architecture workspace",
      details: {
        sourceWorkspaceId: code.id,
        sourceWorkspaceKind: "code",
        targetWorkspaceId: archResult.workspaceId,
        targetWorkspaceKind: "arch",
        forkRequested: false,
      },
    })
  })

  it("keeps arch goals in an existing arch workspace unless fork is requested", async () => {
    const mgr = createManager()
    const arch = await mgr.create({ kind: "arch" })

    const first = expectGoal(await mgr.addGoal(arch.id, goal("first", "arch")))
    const second = expectGoal(await mgr.addGoal(arch.id, goal("second", "arch")))
    const forked = expectGoal(await mgr.addGoal(arch.id, goal("forked", "arch"), { fork: true }))

    expect(first.workspaceId).toBe(arch.id)
    expect(second.workspaceId).toBe(arch.id)
    expect(forked.workspaceId).not.toBe(arch.id)
    expect(mgr.get(forked.workspaceId)?.kind).toBe("arch")
    expect(mgr.get(forked.workspaceId)?.parentId).toBe(arch.id)
  })

  it("allows multiple code goals in a code workspace", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })

    expect(expectGoal(await mgr.addGoal(code.id, goal("first", "code"))).goal.id).toBe("first")
    expect(expectGoal(await mgr.addGoal(code.id, goal("second", "code"))).goal.id).toBe("second")
  })

  it("prepares the Storybook bridge when creating a snapshot-ready workspace baseline", async () => {
    const prepared: string[] = []
    let projectRoot = ""
    const mgr = createManager({
      setupProject(root) {
        projectRoot = root
        mkdirSync(join(root, ".storybook"), { recursive: true })
        writeFileSync(join(root, ".storybook", "preview.ts"), "export default {}\n")
      },
      caps: (root) => ({
        storybook: { frontendDir: root, configDir: join(root, ".storybook") },
      }),
      sbManager: {
        get: () => null,
        shutdown: () => undefined,
        ensure: () => Promise.resolve(""),
        prepare: (frontendDir: string) => {
          prepared.push(frontendDir)
          mkdirSync(join(frontendDir, ".storybook", ".logos"), { recursive: true })
          writeFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "export const withLogosComments = (Story: any) => Story\n")
        },
      },
    })

    await mgr.create({ kind: "code" })

    expect(prepared).toHaveLength(1)
    expect(prepared[0]).not.toBe(projectRoot)
    expect(prepared[0]).toContain(".agent-runs")
    expect(existsSync(join(prepared[0]!, ".storybook", ".logos", "CommentLayer.tsx"))).toBe(true)
  })

  it("starts baseline Storybook keyed by the workspace instance id", async () => {
    const ensured: { id: string; frontendDir: string }[] = []
    const mgr = createManager({
      setupProject(root) {
        mkdirSync(join(root, ".storybook"), { recursive: true })
        writeFileSync(join(root, ".storybook", "preview.ts"), "export default {}\n")
      },
      caps: (root) => ({
        storybook: { frontendDir: root, configDir: join(root, ".storybook") },
      }),
      sbManager: {
        get: () => null,
        shutdown: () => undefined,
        prepare: (frontendDir: string) => {
          mkdirSync(join(frontendDir, ".storybook", ".logos"), { recursive: true })
          writeFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "export const withLogosComments = (Story: any) => Story\n")
        },
        ensure: (id: string, frontendDir: string) => {
          ensured.push({ id, frontendDir })
          return Promise.resolve("")
        },
      },
    })

    const created = await mgr.create({ kind: "code" })

    expect(ensured).toHaveLength(1)
    expect(ensured[0]).toMatchObject({ id: created.activeInstanceId })
    expect(ensured[0]!.id).not.toBe(created.id)
  })

  it("starts forked workspace Storybook keyed by the fork's instance id", async () => {
    const ensured: { id: string; frontendDir: string }[] = []
    const mgr = createManager({
      setupProject(root) {
        mkdirSync(join(root, ".storybook"), { recursive: true })
        writeFileSync(join(root, ".storybook", "preview.ts"), "export default {}\n")
      },
      caps: (root) => ({
        storybook: { frontendDir: root, configDir: join(root, ".storybook") },
      }),
      sbManager: {
        get: () => null,
        shutdown: () => undefined,
        prepare: (frontendDir: string) => {
          mkdirSync(join(frontendDir, ".storybook", ".logos"), { recursive: true })
          writeFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "export const withLogosComments = (Story: any) => Story\n")
        },
        ensure: (id: string, frontendDir: string) => {
          ensured.push({ id, frontendDir })
          return Promise.resolve("")
        },
      },
    })

    const parent = await mgr.create({ kind: "code" })
    const fork = await mgr.create({ fromWorkspaceId: parent.id, kind: "code" })

    expect(ensured.map((call) => call.id)).toEqual([
      parent.activeInstanceId,
      fork.activeInstanceId,
    ])
    expect(ensured.map((call) => call.id)).not.toContain(parent.id)
    expect(ensured.map((call) => call.id)).not.toContain(fork.id)
  }, 60_000)

  it("starts every Storybook in a workspace instance with path-scoped ids", async () => {
    const ensured: { id: string; frontendDir: string }[] = []
    const mgr = createManager({
      setupProject(root) {
        mkdirSync(join(root, "studio", ".storybook"), { recursive: true })
        mkdirSync(join(root, "demos", "hn-jobs", ".storybook"), { recursive: true })
        writeFileSync(join(root, "studio", ".storybook", "preview.ts"), "export default {}\n")
        writeFileSync(join(root, "demos", "hn-jobs", ".storybook", "preview.ts"), "export default {}\n")
      },
      caps: (root) => ({
        storybook: { frontendDir: join(root, "studio"), configDir: join(root, "studio", ".storybook") },
        storybooks: [
          { frontendDir: join(root, "studio"), configDir: join(root, "studio", ".storybook") },
          { frontendDir: join(root, "demos", "hn-jobs"), configDir: join(root, "demos", "hn-jobs", ".storybook") },
        ],
      }),
      sbManager: {
        get: () => null,
        shutdown: () => undefined,
        prepare: (frontendDir: string) => {
          mkdirSync(join(frontendDir, ".storybook", ".logos"), { recursive: true })
          writeFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "export const withLogosComments = (Story: any) => Story\n")
        },
        ensure: (id: string, frontendDir: string) => {
          ensured.push({ id, frontendDir })
          return Promise.resolve("")
        },
      },
    })

    const created = await mgr.create({ kind: "code" })

    expect(ensured.map((call) => call.id).sort()).toEqual([
      `${created.activeInstanceId}:demos/hn-jobs`,
      `${created.activeInstanceId}:studio`,
    ])
  }, 20_000)

  it("shuts down every path-scoped Storybook service when deleting a workspace", async () => {
    const shutdowns: string[] = []
    const mgr = createManager({
      setupProject(root) {
        mkdirSync(join(root, "studio", ".storybook"), { recursive: true })
        mkdirSync(join(root, "demos", "hn-jobs", ".storybook"), { recursive: true })
        writeFileSync(join(root, "studio", ".storybook", "preview.ts"), "export default {}\n")
        writeFileSync(join(root, "demos", "hn-jobs", ".storybook", "preview.ts"), "export default {}\n")
      },
      caps: (root) => ({
        storybook: { frontendDir: join(root, "studio"), configDir: join(root, "studio", ".storybook") },
        storybooks: [
          { frontendDir: join(root, "studio"), configDir: join(root, "studio", ".storybook") },
          { frontendDir: join(root, "demos", "hn-jobs"), configDir: join(root, "demos", "hn-jobs", ".storybook") },
        ],
      }),
      sbManager: {
        get: () => null,
        shutdown: (id: string) => { shutdowns.push(id) },
        prepare: (frontendDir: string) => {
          mkdirSync(join(frontendDir, ".storybook", ".logos"), { recursive: true })
          writeFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "export const withLogosComments = (Story: any) => Story\n")
        },
        ensure: () => Promise.resolve(""),
      },
    })

    const created = await mgr.create({ kind: "code" })
    mgr.delete(created.id)

    expect(shutdowns).toContain(`${created.activeInstanceId}:demos/hn-jobs`)
    expect(shutdowns).toContain(`${created.activeInstanceId}:studio`)
  }, 20_000)

  it("creates an agent session and status event before preparing the working instance", async () => {
    const sessions = createSessions()
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({ sessions, spawned })
    const code = await mgr.create({ kind: "code" })
    expectGoal(await mgr.addGoal(code.id, goal("first", "code")))

    const events: { type: string; message?: unknown; goalId?: unknown }[] = []
    const result = mgr.processNext(code.id, (event) => events.push(event))

    expect(result).toBe("first")
    expect(events[0]).toMatchObject({
      type: "status",
      goalId: "first",
      message: "preparing workspace instance…",
    })
    expect(sessions.events[0]).toMatchObject({
      sessionId: "session-first",
      type: "status",
      payload: expect.objectContaining({ message: "preparing workspace instance…" }),
    })
    expect(mgr.goalsForWorkspace(code.id)[0]?.sessionId).toBe("session-first")

    await waitFor(() => expect(spawned).toHaveLength(1))
    spawned[0]!.emit("close", 0)
    await waitFor(() => expect(mgr.goalsForWorkspace(code.id)[0]?.status).toBe("done"))
  }, 60_000)

  it("stops architecture goals when stripping fails", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "logos-failing-tsx-"))
    tempDirs.push(binDir)
    const failingTsx = join(binDir, "tsx")
    writeFileSync(failingTsx, "#!/bin/sh\nexit 42\n")
    chmodSync(failingTsx, 0o755)

    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({ spawned, tsx: failingTsx })
    const arch = await mgr.create({ kind: "arch" })
    const task = expectGoal(await mgr.addGoal(arch.id, goal("strip-fails", "arch"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processNext(arch.id, (event) => events.push(event))).toBe(task.id)

    await waitFor(() => expect(events.some((event) => String(event.message ?? "").includes("strip failed"))).toBe(true))
    expect(mgr.goalsForWorkspace(arch.id).find((g) => g.id === task.id)?.status).toBe("error")
    expect(spawned).toHaveLength(0)
    expect(events.some((event) => event.message === "building architecture context…")).toBe(false)
  }, 60_000)

  it("does not capture story snapshots before starting the agent working instance", async () => {
    const prepared: string[] = []
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject(root) {
        mkdirSync(join(root, ".storybook"), { recursive: true })
        writeFileSync(join(root, ".storybook", "preview.ts"), "export default {}\n")
        writeFileSync(join(root, "Widget.stories.tsx"), [
          "const meta = { title: 'Widget', component: 'Widget' }",
          "export default meta",
          "export const Default = {}",
        ].join("\n"))
      },
      caps: (root) => ({
        storybook: { frontendDir: root, configDir: join(root, ".storybook") },
      }),
      sbManager: {
        get: () => null,
        shutdown: () => undefined,
        ensure: () => Promise.resolve(""),
        prepare: (frontendDir: string) => prepared.push(frontendDir),
      },
    })
    const code = await mgr.create({ kind: "code" })
    expect(prepared).toHaveLength(1)
    const created = mgr.get(code.id)
    if (!created) throw new Error("missing workspace")
    expect(existsSync(join(created.forkDir, ".logos", "story-snapshots.test.ts"))).toBe(false)
    expectGoal(await mgr.addGoal(code.id, goal("first", "code")))

    const events: { type: string; message?: unknown }[] = []
    expect(mgr.processNext(code.id, (event) => events.push(event))).toBe("first")
    await waitFor(() => expect(spawned).toHaveLength(1))

    expect(prepared).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "status", message: "preparing workspace instance…" })
  }, 60_000)

  it("rejects code goals in architecture workspaces", async () => {
    const mgr = createManager()
    const arch = await mgr.create({ kind: "arch" })

    expect(await mgr.addGoal(arch.id, goal("code-in-arch", "code"))).toEqual({
      error: "code goals cannot be added to architecture workspaces",
      status: 409,
    })
  })

  it("records a policy event when a goal is rejected", async () => {
    const mgr = createManager()
    const arch = await mgr.create({ kind: "arch" })

    await mgr.addGoal(arch.id, goal("code-in-arch", "code"))

    expect(mgr.listPolicyEvents()).toEqual([
      expect.objectContaining({
        seq: 0,
        type: "goal_rejected",
        workspaceId: arch.id,
        goalId: "code-in-arch",
        message: "code goals cannot be added to architecture workspaces",
        details: {
          workspaceKind: "arch",
          goalMode: "code",
        },
      }),
    ])
  })

  it("allows multiple architecture goals to queue in an architecture workspace", async () => {
    const mgr = createManager()
    const arch = await mgr.create({ kind: "arch" })

    expect(expectGoal(await mgr.addGoal(arch.id, goal("first", "arch"))).goal.id).toBe("first")
    expect(expectGoal(await mgr.addGoal(arch.id, goal("second", "arch"))).goal.id).toBe("second")
    expect(mgr.goalsForWorkspace(arch.id).map((g) => g.id)).toEqual(["first", "second"])
  })

  it("continues architecture goals into an implementation pass before completing", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject(root) {
        writeFileSync(join(root, "thing.ts"), "export function thing(): string { return 'old' }\n")
      },
    })
    const arch = await mgr.create({ kind: "arch" })
    expectGoal(await mgr.addGoal(arch.id, goal("arch-change", "arch")))

    const events: { type: string; message?: unknown; goalId?: unknown }[] = []
    expect(mgr.processNext(arch.id, (event) => events.push(event))).toBe("arch-change")
    await waitFor(() => expect(spawned).toHaveLength(1), 60_000)

    spawned[0]!.emit("close", 0)

    await waitFor(() => expect(spawned).toHaveLength(2), 60_000)
    expect(events.some((event) => event.message === "architecture complete; starting implementation…")).toBe(true)
    expect(spawned[1]!.args.join("\n")).toContain("The architecture pass is complete")

    spawned[1]!.emit("close", 0)
    await waitFor(() => expect(mgr.goalsForWorkspace(arch.id)[0]?.status).toBe("done"), 60_000)
    expect(mgr.goalsForWorkspace(arch.id)[0]?.lifecycle).toEqual({ stage: "merged", state: "complete" })
  }, 90_000)

  it("does not start a second architecture agent in the same architecture workspace", async () => {
    const mgr = createManager()
    const arch = await mgr.create({ kind: "arch" })
    const running = expectGoal(await mgr.addGoal(arch.id, goal("running", "arch"))).goal
    running.status = "running"
    expect(expectGoal(await mgr.addGoal(arch.id, goal("pending", "arch"))).goal.id).toBe("pending")

    const events: { type: string; message?: unknown }[] = []
    const result = mgr.processNext(arch.id, (event) => events.push(event))

    expect(result).toBeNull()
    expect(events).toEqual([
      { type: "error", message: "architecture workspace already has a running agent" },
    ])
    expect(mgr.listPolicyEvents({ workspaceId: arch.id })).toEqual([
      expect.objectContaining({
        seq: 0,
        type: "arch_agent_blocked",
        workspaceId: arch.id,
        goalId: "running",
        message: "architecture workspace already has a running agent",
        details: {
          workspaceKind: "arch",
          runningGoalId: "running",
        },
      }),
    ])
  })

  it("fails an architecture goal without starting an agent when strip fails", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      tsx: "/usr/bin/false",
      setupProject: (projectRoot) => {
        mkdirSync(join(projectRoot, "app"), { recursive: true })
        writeFileSync(join(projectRoot, "app", "robots.ts"), `export default function robots() {
  return { rules: { userAgent: "*", allow: "/" } }
}
`)
      },
    })
    const arch = await mgr.create({ kind: "arch" })
    const task = expectGoal(await mgr.addGoal(arch.id, goal("strip-fails", "arch"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processNext(arch.id, (event) => events.push(event))).toBe(task.id)

    await waitFor(() => {
      const current = mgr.goalsForWorkspace(arch.id).find((g) => g.id === task.id)
      expect(current?.status).toBe("error")
      expect(current?.lifecycle).toEqual({ stage: "impl", state: "impl_failed" })
    })
    expect(spawned).toHaveLength(0)
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      goalId: task.id,
      message: expect.stringContaining("strip failed:"),
    }))
  })

  it("starts a requested code goal while another code goal owns the workspace", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({ spawned })
    const code = await mgr.create({ kind: "code" })
    const running = expectGoal(await mgr.addGoal(code.id, goal("running", "code"))).goal
    const pending = expectGoal(await mgr.addGoal(code.id, goal("pending", "code"))).goal
    running.status = "running"

    const events: { type: string; message?: unknown; goalId?: unknown; runningGoalId?: unknown }[] = []
    const result = mgr.processById(code.id, pending.id, (event) => events.push(event))

    expect(result).toBe(pending.id)
    expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
      ["running", "running"],
      ["pending", "running"],
    ])
    await waitFor(() => expect(spawned).toHaveLength(1))
    expect(events.some((event) => event.type === "queued")).toBe(false)
  }, 90_000)

  it("streams requested code goals while they run in parallel instances", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({ spawned })
    const code = await mgr.create({ kind: "code" })
    const first = expectGoal(await mgr.addGoal(code.id, goal("first", "code"))).goal
    const second = expectGoal(await mgr.addGoal(code.id, goal("second", "code"))).goal
    const firstEvents: { type: string; message?: unknown; goalId?: unknown; event?: unknown }[] = []
    const secondEvents: { type: string; message?: unknown; goalId?: unknown; event?: unknown }[] = []

    expect(mgr.processById(code.id, first.id, (event) => firstEvents.push(event))).toBe(first.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
      ["first", "running"],
      ["second", "pending"],
    ])

    expect(mgr.processById(code.id, second.id, (event) => secondEvents.push(event))).toBe(second.id)
    await waitFor(() => expect(spawned).toHaveLength(2))
    expect(spawned[0]!.cwd).not.toBe(spawned[1]!.cwd)
    expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
      ["first", "running"],
      ["second", "running"],
    ])

    spawned[0]!.emit("close", 0)
    await waitFor(() => {
      expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
        ["first", "done"],
        ["second", "running"],
      ])
    })

    spawned[1]!.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "second is running" }] } }) + "\n")
    await waitFor(() => expect(secondEvents.some((event) => event.type === "event")).toBe(true))
    expect(firstEvents.some((event) => event.type === "event")).toBe(false)

    spawned[1]!.emit("close", 0)
    await waitFor(() => {
      expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
        ["first", "done"],
        ["second", "done"],
      ])
    })
  }, 30_000)

  it("resumes a code agent in its conflicted instance when rebase conflicts", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({ spawned })
    const code = await mgr.create({ kind: "code" })
    const state = mgr.get(code.id)
    if (!state) throw new Error("missing workspace")
    writeFileSync(join(state.forkDir, "thing.txt"), "base\n")
    execFileSync("git", ["add", "thing.txt"], { cwd: state.forkDir, encoding: "utf8" })
    execFileSync("git", ["commit", "-m", "base thing"], { cwd: state.forkDir, encoding: "utf8" })

    const first = expectGoal(await mgr.addGoal(code.id, goal("first", "code"))).goal
    const second = expectGoal(await mgr.addGoal(code.id, goal("second", "code"))).goal
    const secondEvents: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(code.id, first.id, () => undefined)).toBe(first.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    expect(mgr.processById(code.id, second.id, (event) => secondEvents.push(event))).toBe(second.id)
    await waitFor(() => expect(spawned).toHaveLength(2))

    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "first\n")
    writeFileSync(join(spawned[1]!.cwd, "thing.txt"), "second\n")

    spawned[0]!.emit("close", 0)
    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === first.id)?.status).toBe("done"))

    spawned[1]!.emit("close", 0)
    await waitFor(() => expect(spawned).toHaveLength(3))

    expect(spawned[2]!.cwd).toBe(spawned[1]!.cwd)
    expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === second.id)?.status).toBe("running")
    expect(secondEvents.some((event) => String(event.message ?? "").includes("rebase conflicts"))).toBe(true)
    const rebasePrompt = spawned[2]!.args.join("\n")
    expect(rebasePrompt).toContain("git status --short")
    expect(rebasePrompt).toContain("Unmerged files")
    expect(rebasePrompt).toContain("thing.txt")
    expect(rebasePrompt).toContain("Conflict marker counts")
  }, 60_000)

  it("accepts a code agent edit without looping on excluded untracked runtime directories", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
      },
    })
    const code = await mgr.create({ kind: "code" })
    const task = expectGoal(await mgr.addGoal(code.id, goal("edit", "code"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(code.id, task.id, (event) => events.push(event))).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "edited\n")
    mkdirSync(join(spawned[0]!.cwd, ".logos_cache"), { recursive: true })
    mkdirSync(join(spawned[0]!.cwd, "frontend", "node_modules"), { recursive: true })
    writeFileSync(join(spawned[0]!.cwd, ".logos_cache", "run.json"), "{}\n")
    writeFileSync(join(spawned[0]!.cwd, "frontend", "node_modules", "dep.txt"), "dep\n")

    spawned[0]!.emit("close", 0)

    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === task.id)?.status).toBe("done"))
    expect(spawned).toHaveLength(1)
    expect(events.some((event) => String(event.message ?? "").includes("rebase needs agent attention"))).toBe(false)
    const state = mgr.get(code.id)
    if (!state) throw new Error("missing workspace")
    expect(readFileSync(join(state.forkDir, "thing.txt"), "utf8")).toBe("edited\n")
  }, 60_000)

  it("pauses a completed code goal for manual merge when auto-merge is disabled", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
      },
    })
    const code = await mgr.create({ kind: "code" })
    const baseInstanceId = code.activeInstanceId
    const task = expectGoal(await mgr.addGoal(code.id, goal("edit", "code"), { autoMerge: false })).goal

    expect(mgr.processById(code.id, task.id, () => undefined)).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "edited\n")

    spawned[0]!.emit("close", 0)

    await waitFor(() => {
      expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === task.id)?.lifecycle).toEqual({ stage: "impl", state: "ready_to_merge" })
    })
    const beforeMerge = mgr.get(code.id)
    if (!beforeMerge) throw new Error("missing workspace")
    const pausedGoal = beforeMerge.goals.find((g) => g.id === task.id)
    expect(pausedGoal?.status).toBe("done")
    expect(pausedGoal?.baseInstanceId).toBe(baseInstanceId)
    expect(pausedGoal?.workingInstanceId).toBeTruthy()
    expect(readFileSync(join(beforeMerge.forkDir, "thing.txt"), "utf8")).toBe("base\n")

    const events: { type: string; message?: unknown; goalId?: unknown }[] = []
    expect(await mgr.mergeGoal(code.id, task.id, (event) => events.push(event))).toEqual({ ok: true, status: "completed" })
    expect(spawned).toHaveLength(1)

    const afterMerge = mgr.get(code.id)
    if (!afterMerge) throw new Error("missing workspace")
    const mergedGoal = afterMerge.goals.find((g) => g.id === task.id)
    expect(mergedGoal?.lifecycle).toEqual({ stage: "merged", state: "complete" })
    expect(mergedGoal?.workingInstanceId).toBeNull()
    expect(mergedGoal?.mergedInstanceId).toBeTruthy()
    expect(readFileSync(join(afterMerge.forkDir, "thing.txt"), "utf8")).toBe("edited\n")
    expect(events.some((event) => String(event.message ?? "").includes("workspace instance accepted"))).toBe(true)
  }, 60_000)

  it("auto-merges child workspace code goals into the parent and refreshes siblings", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
      },
    })
    const parent = await mgr.create({ kind: "code" })
    const childB = await mgr.create({ fromWorkspaceId: parent.id, kind: "code" })
    const childC = await mgr.create({ fromWorkspaceId: parent.id, kind: "code" })
    const childCBefore = mgr.get(childC.id)
    if (!childCBefore) throw new Error("missing child workspace")
    writeFileSync(join(childCBefore.forkDir, "c-only.txt"), "from c\n")

    const task = expectGoal(await mgr.addGoal(childB.id, goal("edit", "code"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(childB.id, task.id, (event) => events.push(event))).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "from b\n")

    spawned[0]!.emit("close", 0)

    await waitFor(() => {
      expect(mgr.goalsForWorkspace(childB.id).find((g) => g.id === task.id)?.lifecycle).toEqual({ stage: "merged", state: "complete" })
    })
    const parentAfter = mgr.get(parent.id)
    const childBAfter = mgr.get(childB.id)
    const childCAfter = mgr.get(childC.id)
    if (!parentAfter || !childBAfter || !childCAfter) throw new Error("missing workspace")

    expect(readFileSync(join(parentAfter.forkDir, "thing.txt"), "utf8")).toBe("from b\n")
    expect(readFileSync(join(childBAfter.forkDir, "thing.txt"), "utf8")).toBe("from b\n")
    expect(readFileSync(join(childCAfter.forkDir, "thing.txt"), "utf8")).toBe("from b\n")
    expect(readFileSync(join(childCAfter.forkDir, "c-only.txt"), "utf8")).toBe("from c\n")
    expect(events.some((event) => String(event.message ?? "").includes("accepted into parent"))).toBe(true)
  }, 15000)

  it("auto-resolves snapshot-only rebase conflicts without resuming the agent", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        mkdirSync(join(projectRoot, "frontend", "__snapshots__"), { recursive: true })
        writeFileSync(join(projectRoot, "frontend", "__snapshots__", "stories.test.tsx.snap"), "base snapshot\n")
      },
    })
    const code = await mgr.create({ kind: "code" })
    const first = expectGoal(await mgr.addGoal(code.id, goal("first", "code"))).goal
    const second = expectGoal(await mgr.addGoal(code.id, goal("second", "code"))).goal
    const secondEvents: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(code.id, first.id, () => undefined)).toBe(first.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    expect(mgr.processById(code.id, second.id, (event) => secondEvents.push(event))).toBe(second.id)
    await waitFor(() => expect(spawned).toHaveLength(2))

    writeFileSync(join(spawned[0]!.cwd, "frontend", "__snapshots__", "stories.test.tsx.snap"), "first snapshot\n")
    writeFileSync(join(spawned[1]!.cwd, "frontend", "__snapshots__", "stories.test.tsx.snap"), "second snapshot\n")

    spawned[0]!.emit("close", 0)
    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === first.id)?.status).toBe("done"))
    spawned[1]!.emit("close", 0)
    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === second.id)?.status).toBe("done"))

    expect(spawned).toHaveLength(2)
    expect(secondEvents.some((event) => String(event.message ?? "").includes("auto-resolved generated snapshot conflicts"))).toBe(true)
  }, 60_000)

  it("commits acceptance-test regenerated artifacts before promotion", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        mkdirSync(join(projectRoot, "frontend", "__snapshots__"), { recursive: true })
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
        writeFileSync(join(projectRoot, "frontend", "__snapshots__", "stories.test.tsx.snap"), "base snapshot\n")
        writeFileSync(join(projectRoot, "regen-test.js"), [
          "const { writeFileSync } = require('node:fs')",
          "writeFileSync('frontend/__snapshots__/stories.test.tsx.snap', 'regenerated snapshot\\n')",
        ].join("\n"))
      },
      caps: { tests: { command: ["node", "regen-test.js"], watchDirs: [] } },
    })
    const code = await mgr.create({ kind: "code" })
    const task = expectGoal(await mgr.addGoal(code.id, goal("edit", "code"))).goal

    expect(mgr.processById(code.id, task.id, () => undefined)).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "edited\n")

    spawned[0]!.emit("close", 0)

    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === task.id)?.status).toBe("done"))
    const state = mgr.get(code.id)
    if (!state) throw new Error("missing workspace")
    expect(readFileSync(join(state.forkDir, "frontend", "__snapshots__", "stories.test.tsx.snap"), "utf8")).toBe("regenerated snapshot\n")
    expect(execFileSync("git", ["log", "--oneline", "-1"], { cwd: state.forkDir, encoding: "utf8" })).toContain("Logos acceptance updates")
    expect(execFileSync("git", ["status", "--short"], { cwd: state.forkDir, encoding: "utf8" })).not.toContain("stories.test.tsx.snap")
  }, 60_000)

  it("resumes a code agent in the same instance when acceptance tests fail", async () => {
    const spawned: FakeAgentProcess[] = []
    const sessions = createSessions()
    const mgr = createManager({
      spawned,
      sessions,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
        writeFileSync(join(projectRoot, "fail-test.js"), "console.error('expected failure'); process.exit(1)\n")
      },
      caps: { tests: { command: ["node", "fail-test.js"], watchDirs: [] } },
    })
    const code = await mgr.create({ kind: "code" })
    const task = expectGoal(await mgr.addGoal(code.id, goal("edit", "code"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(code.id, task.id, (event) => events.push(event))).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "edited\n")

    spawned[0]!.emit("close", 0)

    await waitFor(() => expect(spawned).toHaveLength(2))
    expect(spawned[1]!.cwd).toBe(spawned[0]!.cwd)
    expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === task.id)?.status).toBe("running")
    expect(spawned[1]!.args.join("\n")).toContain("acceptance tests failed")
    expect(events.some((event) => String(event.message ?? "").includes("acceptance tests failed"))).toBe(true)

    spawned[1]!.stdout.write(`${JSON.stringify({ type: "assistant", message: { id: "repair-msg" } })}\n`)
    await waitFor(() => {
      const repairEvents = sessions.events.filter((event) =>
        event.type === "event"
        && (event.payload as { event?: { message?: { id?: string } } }).event?.message?.id === "repair-msg",
      )
      expect(repairEvents).toHaveLength(1)
    })
  }, 60_000)

  it("stops retrying when acceptance tests still fail after a repair attempt", async () => {
    const spawned: FakeAgentProcess[] = []
    const mgr = createManager({
      spawned,
      setupProject: (projectRoot) => {
        writeFileSync(join(projectRoot, "thing.txt"), "base\n")
        writeFileSync(join(projectRoot, "fail-test.js"), "console.error('still failing'); process.exit(1)\n")
      },
      caps: { tests: { command: ["node", "fail-test.js"], watchDirs: [] } },
    })
    const code = await mgr.create({ kind: "code" })
    const task = expectGoal(await mgr.addGoal(code.id, goal("edit", "code"))).goal
    const events: { type: string; message?: unknown; goalId?: unknown }[] = []

    expect(mgr.processById(code.id, task.id, (event) => events.push(event))).toBe(task.id)
    await waitFor(() => expect(spawned).toHaveLength(1))
    writeFileSync(join(spawned[0]!.cwd, "thing.txt"), "edited\n")

    spawned[0]!.emit("close", 0)
    await waitFor(() => expect(spawned).toHaveLength(2))
    spawned[1]!.emit("close", 0)

    await waitFor(() => expect(mgr.goalsForWorkspace(code.id).find((g) => g.id === task.id)?.status).toBe("error"))
    expect(spawned).toHaveLength(2)
    expect(events.some((event) => String(event.message ?? "").includes("acceptance tests still failed"))).toBe(true)
  }, 60_000)

  it("reports a missing requested goal without starting another queued goal", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })
    expect(expectGoal(await mgr.addGoal(code.id, goal("queued", "code"))).goal.id).toBe("queued")

    const events: { type: string; message?: unknown }[] = []
    const result = mgr.processById(code.id, "missing", (event) => events.push(event))

    expect(result).toBeNull()
    expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([["queued", "pending"]])
    expect(events).toEqual([{ type: "error", message: "goal not found" }])
  })

  it("does not process a requested goal that is already finished", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })
    const finished = expectGoal(await mgr.addGoal(code.id, goal("finished", "code"))).goal
    finished.status = "done"

    const events: { type: string; message?: unknown }[] = []
    const result = mgr.processById(code.id, "finished", (event) => events.push(event))

    expect(result).toBeNull()
    expect(events).toEqual([{ type: "error", message: "goal is done" }])
  })

  it("allows architecture agents to run in different architecture workspaces", async () => {
    const mgr = createManager()
    const firstArch = await mgr.create({ kind: "arch" })
    const secondArch = await mgr.create({ kind: "arch" })
    const running = expectGoal(await mgr.addGoal(firstArch.id, goal("running", "arch"))).goal
    running.status = "running"
    expect(expectGoal(await mgr.addGoal(secondArch.id, goal("pending", "arch"))).goal.id).toBe("pending")

    expect(mgr.nextPendingGoal(secondArch.id)?.id).toBe("pending")
  })

  it("persists workspace state in the runtime database", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-workspace-manager-"))
    tempDirs.push(root)
    const projectRoot = join(root, "project")
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(projectRoot, "package.json"), "{}")
    const store = new LogosRuntimeStore(join(root, ".logos", "runtime.db"))

    const mgr = new WorkspaceManager({
      runsDir: join(root, ".agent-runs"),
      store,
      logosTsSrc: join(LOGOS_TS_ROOT, "src"),
      logosTsRoot: LOGOS_TS_ROOT,
      projectRoot,
      caps: { root: projectRoot, nodeModulesDirs: [] },
      sbManager: { get: () => null, shutdown: () => undefined } as any,
      sessions: { deleteByWorkspace: () => undefined } as any,
      tsx: TSX,
      getIndex: async () => ({ root: projectRoot, files: [] }),
      initializeWorkspaces: false,
      cacheNodeModules: false,
    })
    const created = await mgr.create({ kind: "arch", name: "db-backed" })
    expect(existsSync(join(root, ".workspaces"))).toBe(false)

    const restored = new WorkspaceManager({
      runsDir: join(root, ".agent-runs"),
      store,
      logosTsSrc: join(LOGOS_TS_ROOT, "src"),
      logosTsRoot: LOGOS_TS_ROOT,
      projectRoot,
      caps: { root: projectRoot, nodeModulesDirs: [] },
      sbManager: { get: () => null, shutdown: () => undefined } as any,
      sessions: { deleteByWorkspace: () => undefined } as any,
      tsx: TSX,
      getIndex: async () => ({ root: projectRoot, files: [] }),
      initializeWorkspaces: false,
      cacheNodeModules: false,
    })

    expect(restored.get(created.id)).toMatchObject({
      id: created.id,
      name: "db-backed",
      kind: "arch",
      activeInstanceId: created.activeInstanceId,
      baseInstanceId: created.baseInstanceId,
    })
  })

  it("pushes the active workspace as a remote branch", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-workspace-manager-"))
    tempDirs.push(root)
    const gitRoot = join(root, "repo")
    const sourceProjectRoot = join(gitRoot, "hn-jobs")
    const remote = join(root, "remote.git")
    mkdirSync(sourceProjectRoot, { recursive: true })
    writeFileSync(join(sourceProjectRoot, "package.json"), "{}")
    execFileSync("git", ["init"], { cwd: gitRoot, encoding: "utf8" })
    execFileSync("git", ["config", "user.email", "logos@example.com"], { cwd: gitRoot, encoding: "utf8" })
    execFileSync("git", ["config", "user.name", "Logos Test"], { cwd: gitRoot, encoding: "utf8" })
    execFileSync("git", ["add", "."], { cwd: gitRoot, encoding: "utf8" })
    execFileSync("git", ["commit", "-m", "initial"], { cwd: gitRoot, encoding: "utf8" })
    execFileSync("git", ["init", "--bare", remote], { encoding: "utf8" })
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: gitRoot, encoding: "utf8" })

    const store = new LogosRuntimeStore(join(root, ".logos", "runtime.db"))
    const mgr = new WorkspaceManager({
      runsDir: join(root, ".agent-runs"),
      store,
      logosTsSrc: join(LOGOS_TS_ROOT, "src"),
      logosTsRoot: LOGOS_TS_ROOT,
      projectRoot: sourceProjectRoot,
      sourceProjectRoot,
      caps: { root: sourceProjectRoot, nodeModulesDirs: [] },
      sbManager: { get: () => null, shutdown: () => undefined } as any,
      sessions: createSessions() as any,
      tsx: TSX,
      getIndex: async () => ({ root: sourceProjectRoot, files: [] }),
      initializeWorkspaces: false,
      cacheNodeModules: false,
    })
    const workspace = await mgr.create({ name: "Publish Me" })
    const state = mgr.get(workspace.id)
    if (!state) throw new Error("missing workspace")
    mkdirSync(join(state.forkDir, "src"), { recursive: true })
    writeFileSync(join(state.forkDir, "src", "generated.txt"), "from workspace\n")

    const result = mgr.pushAsBranch(workspace.id, "Publish Me")

    expect(result).toMatchObject({ branchName: "logos/publish-me", remote: "origin", changed: true })
    expect(mgr.get(workspace.id)?.publication).toMatchObject({
      branchName: "logos/publish-me",
      remote: "origin",
      commit: result.commit,
      changed: true,
    })
    expect(execFileSync("git", ["--git-dir", remote, "show", "refs/heads/logos/publish-me:hn-jobs/src/generated.txt"], {
      encoding: "utf8",
    })).toBe("from workspace\n")
    expect(existsSync(join(sourceProjectRoot, "src", "generated.txt"))).toBe(false)
  })
})
