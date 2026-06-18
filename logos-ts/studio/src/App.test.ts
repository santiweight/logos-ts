import { describe, expect, it } from "vitest"
import { buildStorybookRenderKey } from "./App"
import type { Goal, SbState, WorkspaceMeta } from "./types"

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "goal-1",
    text: "Update the story",
    label: "JobCard",
    target: "component:JobCard",
    mode: "code",
    createdAt: 1000,
    status: "pending",
    ...overrides,
  }
}

function workspace(goals: Goal[], activeInstanceId = "inst-1"): WorkspaceMeta {
  return {
    id: "ws-1",
    name: "Workspace",
    kind: "code",
    parentId: null,
    createdAt: 1000,
    baseInstanceId: "inst-base",
    activeInstanceId,
    goals,
  }
}

const storybookState: SbState = { status: "ready", startedAt: 2000, logs: [] }

describe("buildStorybookRenderKey", () => {
  it("does not change for pending or running goal state", () => {
    const pending = buildStorybookRenderKey(workspace([goal({ status: "pending" })]), storybookState)
    const running = buildStorybookRenderKey(workspace([goal({ status: "running" })]), storybookState)

    expect(running).toBe(pending)
  })

  it("changes when a goal reaches a terminal state", () => {
    const running = buildStorybookRenderKey(workspace([goal({ status: "running" })]), storybookState)
    const done = buildStorybookRenderKey(workspace([goal({ status: "done" })]), storybookState)

    expect(done).not.toBe(running)
    expect(done).toMatch(/^inst-1:2000:1:[a-z0-9]+$/)
  })

  it("changes when a completed goal gains an agent reply", () => {
    const done = buildStorybookRenderKey(workspace([goal({ status: "done" })]), storybookState)
    const replied = buildStorybookRenderKey(workspace([
      goal({
        status: "done",
        replies: [{ author: "agent", text: "Updated.", createdAt: 3000 }],
      }),
    ]), storybookState)

    expect(replied).not.toBe(done)
    expect(replied).toMatch(/^inst-1:2000:1:[a-z0-9]+$/)
  })
})
