import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { LogosRuntimeStore, type StoredWorkspaceRecord } from "./runtime-store.js"

let root: string
let store: LogosRuntimeStore

function workspace(id = "ws-1"): StoredWorkspaceRecord {
  return {
    id,
    name: "workspace",
    kind: "code",
    type: "local",
    parentId: null,
    createdAt: 1000,
    baseInstanceId: "inst-1",
    activeInstanceId: "inst-1",
    goals: [{
      id: "goal-1",
      text: "change it",
      label: "thing",
      target: "file:thing.ts",
      mode: "code",
      createdAt: 1001,
      status: "pending",
      lifecycle: { stage: "initializing", state: "creating_goal" },
      mergePolicy: { autoMerge: true },
    }],
    instances: {
      "inst-1": {
        id: "inst-1",
        workspaceId: id,
        materializedRoot: join(root, "inst-1"),
        mutability: "writable",
        createdAt: 1000,
        index: { files: [] },
      },
    },
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "logos-runtime-store-"))
  store = new LogosRuntimeStore(join(root, ".logos", "runtime.db"))
})

afterEach(() => {
  store.close()
  rmSync(root, { recursive: true, force: true })
})

describe("LogosRuntimeStore", () => {
  it("enables SQLite connection hardening pragmas", () => {
    expect((store.database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1)
    expect((store.database.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout).toBe(5000)
  })

  it("persists storybook startup state", () => {
    const ws = workspace()
    store.saveWorkspace(ws)

    store.saveStorybookState({
      id: ws.id,
      status: "starting",
      startedAt: 1000,
      updatedAt: 1001,
      logs: ["booting", "http://localhost:6006"],
    })

    expect(store.listStorybookStates()[ws.id]).toEqual({
      id: ws.id,
      status: "starting",
      startedAt: 1000,
      updatedAt: 1001,
      logs: ["booting", "http://localhost:6006"],
    })
  })

  it("persists explicit goal lifecycle and merge metadata", () => {
    const ws = workspace()
    ws.goals[0] = {
      ...ws.goals[0]!,
      status: "done",
      lifecycle: { stage: "impl", state: "ready_to_merge" },
      mergePolicy: { autoMerge: false },
      baseInstanceId: "inst-1",
      workingInstanceId: "inst-review",
      mergedInstanceId: null,
    }
    store.saveWorkspace(ws)

    expect(store.loadWorkspace(ws.id)?.goals[0]).toMatchObject({
      id: "goal-1",
      status: "done",
      lifecycle: { stage: "impl", state: "ready_to_merge" },
      mergePolicy: { autoMerge: false },
      baseInstanceId: "inst-1",
      workingInstanceId: "inst-review",
      mergedInstanceId: null,
    })
  })

  it("persists goal screenshot data", () => {
    const ws = workspace()
    ws.goals[0] = {
      ...ws.goals[0]!,
      screenshotDataUrl: "data:image/png;base64,ZmFrZQ==",
    }
    store.saveWorkspace(ws)

    expect(store.loadWorkspace(ws.id)?.goals[0]?.screenshotDataUrl).toBe("data:image/png;base64,ZmFrZQ==")
  })

  it("persists workspace initialization state", () => {
    const ws = workspace()
    ws.initialization = {
      status: "initializing",
      updatedAt: 1002,
      steps: [
        { id: "materialize", label: "Materialize workspace", status: "done" },
        { id: "install_dependencies", label: "Install dependencies", status: "done" },
        { id: "story_snapshots", label: "Capture story snapshots", status: "running" },
        { id: "commit_baseline", label: "Commit snapshot baseline", status: "pending" },
        { id: "index", label: "Index workspace", status: "pending" },
      ],
    }
    store.saveWorkspace(ws)

    expect(store.loadWorkspace(ws.id)?.initialization).toEqual(ws.initialization)
  })

  it("cascades workspace-owned runtime rows on workspace delete", () => {
    const ws = workspace()
    store.saveWorkspace(ws)
    store.addPolicyEvent({
      type: "goal_rejected",
      workspaceId: ws.id,
      goalId: "goal-1",
      message: "rejected",
    })
    store.saveStorybooks({
      [ws.id]: {
        id: ws.id,
        pid: process.pid,
        port: 6006,
        url: "http://localhost:6006",
        cwd: root,
        startedAt: 1000,
      },
    })
    store.saveStorybookState({
      id: ws.id,
      status: "ready",
      startedAt: 1000,
      updatedAt: 1001,
      logs: ["ready"],
    })

    store.deleteWorkspace(ws.id)

    expect(store.loadWorkspace(ws.id)).toBeNull()
    expect(store.listPolicyEvents()).toEqual([])
    expect(store.listStorybooks()).toEqual({})
    expect(store.listStorybookStates()).toEqual({})
  })
})
