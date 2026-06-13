import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, describe, it, expect } from "vitest"
import { buildElementContext, buildGoalLine, selectNextGoal } from "./prompt.js"
import { WorkspaceManager, type AddGoalResult, type Goal } from "./workspace-manager.js"

const LOGOS_TS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TSX = resolve(LOGOS_TS_ROOT, "node_modules/.bin/tsx")
const tempDirs: string[] = []

function goal(id: string, mode: Goal["mode"], status: Goal["status"] = "pending"): Goal {
  return {
    id,
    text: "change it",
    label: "thing",
    target: "file:thing.ts",
    mode,
    createdAt: 1000,
    status,
  }
}

class FakeAgentProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false

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

function createManager(opts?: { spawned?: FakeAgentProcess[] }): WorkspaceManager {
  const root = mkdtempSync(join(tmpdir(), "logos-workspace-manager-"))
  tempDirs.push(root)
  const projectRoot = join(root, "project")
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(join(projectRoot, "package.json"), "{}")
  const sessions = createSessions()

  return new WorkspaceManager({
    wsDir: join(root, ".workspaces"),
    runsDir: join(root, ".agent-runs"),
    logosTsSrc: join(LOGOS_TS_ROOT, "src"),
    logosTsRoot: LOGOS_TS_ROOT,
    projectRoot,
    caps: { root: projectRoot, nodeModulesDirs: [] },
    sbManager: { get: () => null, shutdown: () => undefined } as any,
    sessions: sessions as any,
    tsx: TSX,
    getIndex: async () => ({ root: projectRoot, files: [] }),
    ...(opts?.spawned
      ? {
          spawnAgent: () => {
            const child = new FakeAgentProcess()
            opts.spawned!.push(child)
            return child as any
          },
        }
      : {}),
  })
}

async function waitFor(assertion: () => void, timeoutMs = 5000): Promise<void> {
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

  it("queues a requested pending goal while another goal owns the workspace", async () => {
    const mgr = createManager()
    const code = await mgr.create({ kind: "code" })
    const running = expectGoal(await mgr.addGoal(code.id, goal("running", "code"))).goal
    const pending = expectGoal(await mgr.addGoal(code.id, goal("pending", "code"))).goal
    running.status = "running"

    const events: { type: string; message?: unknown; goalId?: unknown; runningGoalId?: unknown }[] = []
    const result = mgr.processById(code.id, pending.id, (event) => events.push(event))

    expect(result).toBe(pending.id)
    expect(mgr.goalsForWorkspace(code.id).map((g) => [g.id, g.status])).toEqual([
      ["running", "running"],
      ["pending", "pending"],
    ])
    expect(events).toEqual([
      {
        type: "queued",
        goalId: "pending",
        runningGoalId: "running",
        message: "goal queued behind running agent",
      },
    ])
  })

  it("streams a queued requested goal when it starts after the active agent finishes", async () => {
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
    expect(secondEvents).toEqual([
      {
        type: "queued",
        goalId: "second",
        runningGoalId: "first",
        message: "goal queued behind running agent",
      },
    ])

    spawned[0]!.emit("close", 0)
    await waitFor(() => expect(spawned).toHaveLength(2))
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
  })

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

  it("migrates saved workspaces without an explicit kind to code workspaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-workspace-manager-"))
    tempDirs.push(root)
    const projectRoot = join(root, "project")
    const wsDir = join(root, ".workspaces")
    const legacyFork = join(root, "legacy-fork")
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(wsDir, { recursive: true })
    mkdirSync(legacyFork, { recursive: true })
    writeFileSync(join(projectRoot, "package.json"), "{}")
    writeFileSync(join(wsDir, "legacy.json"), JSON.stringify({
      id: "legacy",
      name: "legacy",
      parentId: null,
      createdAt: 1000,
      forkDir: legacyFork,
      goals: [],
      index: {},
    }))

    const mgr = new WorkspaceManager({
      wsDir,
      runsDir: join(root, ".agent-runs"),
      logosTsSrc: join(LOGOS_TS_ROOT, "src"),
      logosTsRoot: LOGOS_TS_ROOT,
      projectRoot,
      caps: { root: projectRoot, nodeModulesDirs: [] },
      sbManager: { get: () => null, shutdown: () => undefined } as any,
      sessions: { deleteByWorkspace: () => undefined } as any,
      tsx: TSX,
      getIndex: async () => ({ root: projectRoot, files: [] }),
    })

    expect(mgr.get("legacy")).toMatchObject({
      id: "legacy",
      kind: "code",
      forkDir: legacyFork,
      activeInstanceId: "inst-legacy-active",
      baseInstanceId: "inst-legacy-active",
    })
    expect(mgr.list()).toHaveLength(1)
  })
})
