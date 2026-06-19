import { describe, expect, it } from "vitest"
import { buildStorybookRenderKey, createStoryCommentEventDedupe, resolveAgentPanelGoalId, reviewChangeCount } from "./App"
import type { FileEntry, Goal, SbState, StudioIndex, WorkspaceMeta } from "./types"

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

function index(files: FileEntry[]): StudioIndex {
  return { root: "/test", files }
}

function componentFile(storyCode: string, snapshot: string | null = null): FileEntry {
  return {
    file: "components/JobRow.tsx",
    code: "export function JobRow() { return null }",
    items: [],
    component: {
      name: "JobRow",
      signature: "JobRow()",
      componentCode: "export function JobRow() { return null }",
      propsFields: [],
      stories: [{
        id: "jobrow--default",
        exportName: "Default",
        storyFile: "components/JobRow.stories.tsx",
        storyCode,
        snapshot,
      }],
    },
  }
}

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

describe("reviewChangeCount", () => {
  it("counts story-only source changes as reviewable", () => {
    expect(reviewChangeCount(
      index([componentFile("function StoryRender() { return <td>{jobCount}</td> }\nexport const Default = {}")]),
      index([componentFile("function StoryRender() { return <td><strong>{jobCount}</strong></td> }\nexport const Default = {}")]),
    )).toBe(1)
  })

  it("counts snapshot-only changes as reviewable", () => {
    expect(reviewChangeCount(
      index([componentFile("export const Default = {}", "<div>before</div>")]),
      index([componentFile("export const Default = {}", "<div>after</div>")]),
    )).toBe(1)
  })
})

describe("resolveAgentPanelGoalId", () => {
  it("prefers the selected goal over the latest agent-run goal", () => {
    expect(resolveAgentPanelGoalId({ type: "goal", id: "goal-2" }, "goal-1")).toBe("goal-2")
  })

  it("falls back to the latest agent-run goal when a workspace is selected", () => {
    expect(resolveAgentPanelGoalId({ type: "workspace", id: "ws-1" }, "goal-1")).toBe("goal-1")
  })

  it("returns no goal when there is neither a selected goal nor an agent-run goal", () => {
    expect(resolveAgentPanelGoalId(null, null)).toBeNull()
  })
})

describe("createStoryCommentEventDedupe", () => {
  it("accepts one story comment per client event id", () => {
    const accept = createStoryCommentEventDedupe()
    const event = {
      type: "logos:story-comment",
      clientEventId: "event-1",
      storyId: "jobcard--default",
      selector: ":scope",
      text: "Make this clearer",
    }

    expect(accept(event)).toBe(true)
    expect(accept({ ...event })).toBe(false)
    expect(accept({ ...event, clientEventId: "event-2" })).toBe(true)
  })

  it("does not reject legacy story comment messages without an event id", () => {
    const accept = createStoryCommentEventDedupe()
    const event = {
      type: "logos:story-comment",
      storyId: "jobcard--default",
      selector: ":scope",
      text: "Make this clearer",
    }

    expect(accept(event)).toBe(true)
    expect(accept(event)).toBe(true)
  })
})
