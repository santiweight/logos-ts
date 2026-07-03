import { describe, expect, it } from "vitest"
import { buildStorybookRenderKey, createStoryCommentEventDedupe, resolveAgentPanelGoalId, resolveSidebarFilters, reviewChangeCount, runCommentPopupFromEvent, selectActiveStorybookRuntime, selectActiveWorkspaceView, selectedStorybookRoot, shouldShowProjectStartupScreen, sidebarFilterScope, storyPopoverFromEvent, workspaceReadyForDisplay } from "./App"
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
    type: "local",
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

describe("shouldShowProjectStartupScreen", () => {
  it("only shows the startup screen while a project load or reset is active", () => {
    expect(shouldShowProjectStartupScreen(false, "boot")).toBe(true)
    expect(shouldShowProjectStartupScreen(false, "idle")).toBe(false)
    expect(shouldShowProjectStartupScreen(true, "boot")).toBe(false)
    expect(shouldShowProjectStartupScreen(true, "reset")).toBe(true)
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

describe("storyPopoverFromEvent", () => {
  it("rejects non-object data", () => {
    const event = new MessageEvent("message", { data: "not-an-object" })
    expect(storyPopoverFromEvent(event)).toBeNull()
  })

  it("rejects messages with wrong type", () => {
    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-comment",
        rect: { right: 100, top: 50 },
        viewport: { width: 640, height: 400 },
      },
    })
    expect(storyPopoverFromEvent(event)).toBeNull()
  })

  it("rejects messages missing rect object", () => {
    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        viewport: { width: 640, height: 400 },
      },
    })
    expect(storyPopoverFromEvent(event)).toBeNull()
  })

  it("rejects messages missing viewport object", () => {
    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        rect: { right: 100, top: 50 },
      },
    })
    expect(storyPopoverFromEvent(event)).toBeNull()
  })

  it("rejects messages with missing required numeric fields", () => {
    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        rect: { top: 50 }, // missing right
        viewport: { width: 640, height: 400 },
      },
    })
    expect(storyPopoverFromEvent(event)).toBeNull()

    const event2 = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        rect: { right: 100 }, // missing top
        viewport: { width: 640, height: 400 },
      },
    })
    expect(storyPopoverFromEvent(event2)).toBeNull()

    const event3 = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        rect: { right: 100, top: 50 },
        viewport: { height: 400 }, // missing width
      },
    })
    expect(storyPopoverFromEvent(event3)).toBeNull()
  })

  it("translates iframe coordinates to studio coordinates with default target", () => {
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
        type: "logos:story-popover-show",
        rect: { right: 120, top: 80 },
        viewport: { width: 1280, height: 800 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    expect(popup).toMatchObject({
      target: "app:/",
      label: "Comment",
      x: 172, // 100 + 120 * (640/1280) + 12 = 100 + 60 + 12 = 172
      y: 90, // 50 + 80 * (400/800) = 50 + 40 = 90
      storyId: undefined,
      selector: undefined,
      component: undefined,
      htmlContext: undefined,
      screenshotDataUrl: undefined,
    })

    iframe.remove()
  })

  it("uses component as target when present", () => {
    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    iframe.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        component: "ButtonCard",
        label: "CustomLabel",
        rect: { right: 100, top: 50 },
        viewport: { width: 800, height: 600 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    expect(popup).toMatchObject({
      target: "component:ButtonCard",
      label: "CustomLabel",
      component: "ButtonCard",
    })

    iframe.remove()
  })

  it("uses story id as target when component is missing", () => {
    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    iframe.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        storyId: "buttoncard--primary",
        rect: { right: 100, top: 50 },
        viewport: { width: 800, height: 600 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    expect(popup).toMatchObject({
      target: "story:buttoncard--primary",
      label: "buttoncard--primary",
      storyId: "buttoncard--primary",
    })

    iframe.remove()
  })

  it("clamps coordinates to viewport bounds", () => {
    // Mock window.innerWidth and innerHeight
    Object.defineProperty(window, "innerWidth", { value: 1000, writable: true, configurable: true })
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true, configurable: true })

    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    iframe.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        component: "LargeCard",
        rect: { right: 2000, top: 2000 }, // Very far right and down
        viewport: { width: 800, height: 600 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    // x should be clamped to window.innerWidth - 310 = 690
    expect(popup?.x).toBeLessThanOrEqual(690)
    // y should be clamped to window.innerHeight - 200 = 400
    expect(popup?.y).toBeLessThanOrEqual(400)
    // y should be at least 8
    expect(popup?.y).toBeGreaterThanOrEqual(8)

    iframe.remove()
  })

  it("handles scaling when iframe size differs from viewport", () => {
    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    document.body.appendChild(iframe)
    iframe.getBoundingClientRect = () => ({
      left: 50,
      top: 100,
      right: 450,
      bottom: 300,
      width: 400, // half the viewport width
      height: 200, // half the viewport height
      x: 50,
      y: 100,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        component: "ScaledComponent",
        rect: { right: 400, top: 200 }, // coords in iframe space
        viewport: { width: 800, height: 400 }, // original viewport
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    // Scale factors: scaleX = 400/800 = 0.5, scaleY = 200/400 = 0.5
    // x = 50 + 400 * 0.5 + 12 = 50 + 200 + 12 = 262
    // y = 100 + 200 * 0.5 = 100 + 100 = 200
    expect(popup).toMatchObject({
      target: "component:ScaledComponent",
      x: 262,
      y: 200,
    })

    iframe.remove()
  })

  it("preserves optional fields", () => {
    const iframe = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe, "contentWindow", { value: sourceWindow })
    iframe.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        component: "DetailedCard",
        selector: ".card-title",
        htmlContext: "Card Title: Sales Report",
        screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        rect: { right: 100, top: 50 },
        viewport: { width: 800, height: 600 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })
    const popup = storyPopoverFromEvent(event, iframe)

    expect(popup).toMatchObject({
      component: "DetailedCard",
      selector: ".card-title",
      htmlContext: "Card Title: Sales Report",
      screenshotDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    })

    iframe.remove()
  })

  it("uses provided frameOverride for iframe resolution", () => {
    const iframe1 = document.createElement("iframe")
    const iframe2 = document.createElement("iframe")
    const sourceWindow = { postMessage: () => {} } as unknown as Window
    Object.defineProperty(iframe1, "contentWindow", { value: sourceWindow })
    Object.defineProperty(iframe2, "contentWindow", { value: sourceWindow })

    iframe1.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    iframe2.getBoundingClientRect = () => ({
      left: 200,
      top: 100,
      right: 1000,
      bottom: 700,
      width: 800,
      height: 600,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    })

    const event = new MessageEvent("message", {
      data: {
        type: "logos:story-popover-show",
        component: "OverriddenFrame",
        rect: { right: 100, top: 50 },
        viewport: { width: 800, height: 600 },
      },
    })
    Object.defineProperty(event, "source", { value: sourceWindow })

    // Using iframe2 as override should give different coordinates
    const popup = storyPopoverFromEvent(event, iframe2)

    // x = 200 + 100 * (800/800) + 12 = 200 + 100 + 12 = 312
    // y = 100 + 50 * (600/600) = 100 + 50 = 150
    expect(popup).toMatchObject({
      x: 312,
      y: 150,
    })

    iframe1.remove()
    iframe2.remove()
  })
})
