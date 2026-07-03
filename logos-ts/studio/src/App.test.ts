import { describe, expect, it } from "vitest"
import { buildStorybookRenderKey, createStoryCommentEventDedupe, resolveAgentPanelGoalId, resolveSidebarFilters, reviewChangeCount, runCommentPopupFromEvent, selectActiveStorybookRuntime, selectActiveWorkspaceView, selectedStorybookRoot, sidebarFilterScope, workspaceReadyForDisplay } from "./App"
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

describe("selectActiveStorybookRuntime", () => {
  it("looks up Storybook by the active workspace instance id", () => {
    const ws = workspace([], "inst-active")

    expect(selectActiveStorybookRuntime(ws.id, ws, undefined, {
      "ws-1": "http://127.0.0.1:6006",
      "inst-active": "http://127.0.0.1:6007",
    }, {
      "ws-1": { status: "ready", startedAt: 1000, logs: [] },
      "inst-active": { status: "ready", startedAt: 2000, logs: [] },
    })).toEqual({
      url: "http://127.0.0.1:6007",
      state: { status: "ready", startedAt: 2000, logs: [] },
    })
  })

  it("uses the selected story's Storybook root when a repo has multiple Storybooks", () => {
    const ws = workspace([], "inst-active")

    expect(selectActiveStorybookRuntime(ws.id, ws, "demos/hn-jobs", {
      "inst-active": "http://127.0.0.1:6007",
      "inst-active:demos/hn-jobs": "http://127.0.0.1:6008",
    }, {
      "inst-active": { status: "ready", startedAt: 1000, logs: [] },
      "inst-active:demos/hn-jobs": { status: "ready", startedAt: 2000, logs: [] },
    })).toEqual({
      url: "http://127.0.0.1:6008",
      state: { status: "ready", startedAt: 2000, logs: [] },
    })
  })

  it("finds the Storybook root for the selected story", () => {
    expect(selectedStorybookRoot([
      {
        file: "demos/hn-jobs/app/admin/page.tsx",
        code: "",
        items: [],
        component: {
          name: "AdminDashboard",
          signature: "AdminDashboard()",
          componentCode: "",
          propsFields: [],
          stories: [{ id: "admin-page--default", exportName: "Default", storybookRoot: "demos/hn-jobs", snapshot: null }],
        },
      },
    ], { file: "demos/hn-jobs/app/admin/page.tsx", view: "story", storyId: "admin-page--default" })).toBe("demos/hn-jobs")
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

describe("workspaceReadyForDisplay", () => {
  it("waits until workspace initialization finishes", () => {
    expect(workspaceReadyForDisplay(null)).toBe(false)
    expect(workspaceReadyForDisplay(workspace([]))).toBe(true)
    expect(workspaceReadyForDisplay({
      ...workspace([]),
      initialization: {
        status: "initializing",
        updatedAt: 1000,
        steps: [{ id: "index", label: "Index workspace", status: "running" }],
      },
    })).toBe(false)
    expect(workspaceReadyForDisplay({
      ...workspace([]),
      initialization: {
        status: "ready",
        updatedAt: 1000,
        steps: [{ id: "index", label: "Index workspace", status: "done" }],
      },
    })).toBe(true)
  })
})

describe("selectActiveWorkspaceView", () => {
  it("hides view state from a previous active workspace", () => {
    const previousView = {
      workspaceId: "ws-old",
      index: index([]),
      reviewIndex: index([]),
      baselineIndex: index([]),
    }

    expect(selectActiveWorkspaceView(previousView, "ws-new")).toBeNull()
    expect(selectActiveWorkspaceView(previousView, "ws-old")).toBe(previousView)
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

describe("sidebar filter scoping", () => {
  it("uses a workspace scope when no goal is selected", () => {
    expect(sidebarFilterScope("ws-1", null)).toBe("workspace:ws-1")
  })

  it("uses a workspace and goal scope when a goal is selected", () => {
    expect(sidebarFilterScope("ws-1", "goal-1")).toBe("workspace:ws-1:goal:goal-1")
  })

  it("resolves stored filters for the active scope", () => {
    expect(resolveSidebarFilters({
      "workspace:ws-1": {
        functions: true,
        classes: false,
        components: true,
        types: true,
      },
    }, "workspace:ws-1")).toEqual({
      functions: true,
      classes: false,
      components: true,
      types: true,
    })
  })

  it("falls back to default filters for a new scope", () => {
    expect(resolveSidebarFilters({}, "workspace:ws-1:goal:goal-1")).toEqual({
      functions: false,
      classes: true,
      components: true,
      types: false,
    })
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

describe("runCommentPopupFromEvent", () => {
  it("maps an iframe run comment target into parent viewport coordinates", () => {
    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    document.body.appendChild(iframe)
    iframe.getBoundingClientRect = () => ({
      left: 100,
      top: 50,
      right: 740,
      bottom: 450,
      width: 640,
      height: 400,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:run-comment-target",
        storyId: "run:root-app:/details",
        runTargetId: "root-app",
        appPath: "/details",
        selector: "body > main > span",
        label: "RunSearchPanel",
        component: "RunSearchPanel",
        htmlContext: "selected: <span>Plain target</span>",
        screenshotDataUrl: "data:image/png;base64,ZmFrZQ==",
        rect: { left: 20, top: 30, right: 120, bottom: 70, width: 100, height: 40 },
        viewport: { width: 1280, height: 800 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = runCommentPopupFromEvent(event, iframe)

    expect(popup).toMatchObject({
      target: "component:RunSearchPanel",
      label: "RunSearchPanel",
      storyId: "run:root-app:/details",
      appPath: "/details",
      selector: "body > main > span",
      component: "RunSearchPanel",
      htmlContext: "selected: <span>Plain target</span>",
      runTargetId: "root-app",
      screenshotDataUrl: "data:image/png;base64,ZmFrZQ==",
      x: 110,
      y: 93,
    })

    iframe.remove()
  })
})
