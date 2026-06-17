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
    parentId: null,
    createdAt: 1000,
    baseArcWsInstanceId: null,
    activeArcWsInstanceId: null,
    goldenArcWsInstanceId: null,
    baseImplWsInstanceId: "impl-1",
    activeImplWsInstanceId: "impl-1",
    goals: [{
      id: "goal-1",
      text: "change it",
      label: "thing",
      target: "file:thing.ts",
      mode: "code",
      createdAt: 1001,
      status: "pending",
    }],
    arcWsInstances: {},
    implWsInstances: {
      "impl-1": {
        id: "impl-1",
        workspaceId: id,
        arcWsInstanceId: null,
        materializedRoot: join(root, "impl-1"),
        mutability: "writable",
        createdAt: 1000,
        index: { files: [] },
        validation: null,
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
