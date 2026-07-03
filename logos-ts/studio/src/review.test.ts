import { describe, expect, it } from "vitest"
import {
  snapshotChanges,
  extractSnapshotHtml,
  formatSnapshot,
  selectGoalReviewBaseIndex,
  selectReviewBaseIndex,
  selectWorkspaceReviewBaseIndex,
  selectWorkspaceReviewIndex,
} from "./review"
import type { FileEntry, StudioIndex, Workspace } from "./types"

function indexWithCapture(
  snapshot: string | null,
  overrides: { component?: string; exportName?: string; screenshotHash?: string | null } = {}
): StudioIndex {
  const component = overrides.component ?? "JobRow"
  const exportName = overrides.exportName ?? "Default"
  const file: FileEntry = {
    file: `components/${component}.tsx`,
    code: "",
    items: [],
    component: {
      name: component,
      signature: `${component}()`,
      componentCode: "",
      propsFields: [],
      stories: [{
        id: `${component.toLowerCase()}--${exportName.toLowerCase()}`,
        exportName,
        snapshot,
        ...("screenshotHash" in overrides ? { screenshotHash: overrides.screenshotHash } : {}),
      }],
    },
  }
  return { root: "/test", files: [file] }
}

describe("snapshotChanges", () => {
  it("returns only snapshots whose captured output changed", () => {
    const base = indexWithCapture("<div>before</div>")
    const workspace = indexWithCapture("<div>after</div>")

    expect(snapshotChanges(base, workspace)).toEqual([
      expect.objectContaining({
        component: "JobRow",
        exportName: "Default",
        status: "changed",
        beforeSnapshot: "<div>before</div>",
        afterSnapshot: "<div>after</div>",
      }),
    ])
  })

  it("does not report identical snapshots", () => {
    const base = indexWithCapture("<div>same</div>")
    expect(snapshotChanges(base, base)).toEqual([])
  })



  it("does not report changes when screenshotHash matches despite snapshot HTML differing", () => {
    const base = indexWithCapture(
      '<html><head><style>.a{color:red}</style></head><body><div>same</div></body></html>',
      { screenshotHash: "abc123" },
    )
    const workspace = indexWithCapture(
      '<html><head><style>.a{color:red}.b{color:blue}</style></head><body><div>same</div></body></html>',
      { screenshotHash: "abc123" },
    )
    expect(snapshotChanges(base, workspace)).toEqual([])
  })

  it("reports changes when screenshotHash differs", () => {
    const base = indexWithCapture("<div>before</div>", { screenshotHash: "hash-a" })
    const workspace = indexWithCapture("<div>after</div>", { screenshotHash: "hash-b" })
    expect(snapshotChanges(base, workspace)).toEqual([
      expect.objectContaining({ status: "changed" }),
    ])
  })

  it("falls back to snapshot comparison when screenshotHash is absent", () => {
    const base = indexWithCapture("<div>before</div>")
    const workspace = indexWithCapture("<div>after</div>")
    expect(snapshotChanges(base, workspace)).toEqual([
      expect.objectContaining({ status: "changed" }),
    ])
  })

  it("reports added and removed snapshots", () => {
    const empty: StudioIndex = { root: "/test", files: [] }
    const snapshot = indexWithCapture("<div>snapshot</div>")

    expect(snapshotChanges(empty, snapshot)[0]?.status).toBe("added")
    expect(snapshotChanges(snapshot, empty)[0]?.status).toBe("removed")
  })
})

describe("selectReviewBaseIndex", () => {
  it("uses the project index when no parent workspace baseline is loaded", () => {
    const project = indexWithCapture("<div>project</div>")

    expect(selectReviewBaseIndex(project, null)).toBe(project)
  })

  it("uses the parent workspace index when a workspace was forked from another workspace", () => {
    const project = indexWithCapture("<div>project</div>")
    const parent = indexWithCapture("<div>parent</div>")

    expect(selectReviewBaseIndex(project, parent)).toBe(parent)
  })
})

describe("selectWorkspaceReviewBaseIndex", () => {
  it("uses the active workspace index as the review baseline for root workspaces", () => {
    const project = indexWithCapture("<div>project</div>")
    const active = indexWithCapture("<div>active</div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: null,
      createdAt: 1,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-active",
      goals: [],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {},
    }

    expect(selectWorkspaceReviewBaseIndex(project, workspace)).toBe(active)
  })

  it("uses the workspace base instance as the review baseline for child workspaces", () => {
    const project = indexWithCapture("<div>project</div>")
    const base = indexWithCapture("<div>Senior Engineer</div>")
    const active = indexWithCapture("<div><strong>Senior Engineer</strong></div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: "parent",
      createdAt: 1,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-active",
      goals: [],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {
        "inst-base": {
          id: "inst-base",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/base",
          mutability: "immutable",
          createdAt: 1,
          index: base,
        },
        "inst-active": {
          id: "inst-active",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/active",
          mutability: "writable",
          createdAt: 2,
          index: active,
        },
      },
    }

    const reviewBase = selectWorkspaceReviewBaseIndex(project, workspace)

    expect(reviewBase).toBe(base)
    expect(snapshotChanges(reviewBase, workspace.index)).toEqual([
      expect.objectContaining({
        component: "JobRow",
        exportName: "Default",
        status: "changed",
        beforeSnapshot: "<div>Senior Engineer</div>",
        afterSnapshot: "<div><strong>Senior Engineer</strong></div>",
      }),
    ])
  })

  it("falls back to the project index when the base instance is unavailable", () => {
    const project = indexWithCapture("<div>project</div>")
    const active = indexWithCapture("<div>active</div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: "parent",
      createdAt: 1,
      baseInstanceId: "missing",
      activeInstanceId: "inst-active",
      goals: [],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {},
    }

    expect(selectWorkspaceReviewBaseIndex(project, workspace)).toBe(project)
  })
})

describe("selectWorkspaceReviewIndex", () => {
  it("uses the active workspace index when there is no pending manual merge", () => {
    const active = indexWithCapture("<div>active</div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: null,
      createdAt: 1,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-active",
      goals: [],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {},
    }

    expect(selectWorkspaceReviewIndex(workspace)).toBe(active)
  })

  it("uses the working instance for ready-to-merge manual goals", () => {
    const active = indexWithCapture("<div>active</div>")
    const base = indexWithCapture("<div>base</div>")
    const working = indexWithCapture("<div>Indexed threads</div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: null,
      createdAt: 1,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-active",
      goals: [{
        id: "goal-1",
        target: "components/JobRow.tsx",
        label: "JobRow",
        text: "rename to Indexed threads",
        mode: "code",
        createdAt: 1,
        status: "done",
        lifecycle: { stage: "impl", state: "ready_to_merge" },
        mergePolicy: { autoMerge: false },
        baseInstanceId: "inst-base",
        workingInstanceId: "inst-working",
        mergedInstanceId: null,
      }],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {
        "inst-base": {
          id: "inst-base",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/base",
          mutability: "writable",
          createdAt: 1,
          index: base,
        },
        "inst-working": {
          id: "inst-working",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/working",
          mutability: "writable",
          createdAt: 2,
          index: working,
        },
      },
    }

    expect(selectGoalReviewBaseIndex(workspace, "goal-1")).toBe(base)
    expect(selectWorkspaceReviewIndex(workspace)).toBe(working)
    expect(snapshotChanges(selectGoalReviewBaseIndex(workspace, "goal-1")!, selectWorkspaceReviewIndex(workspace)!)).toEqual([
      expect.objectContaining({
        status: "changed",
        beforeSnapshot: "<div>base</div>",
        afterSnapshot: "<div>Indexed threads</div>",
      }),
    ])
  })

  it("uses the explicitly selected goal when multiple manual merges are pending", () => {
    const active = indexWithCapture("<div>active</div>")
    const first = indexWithCapture("<div>First pending</div>")
    const selected = indexWithCapture("<div>Hidden</div>")
    const workspace: Workspace = {
      id: "ws-1",
      name: "workspace",
      kind: "code",
      parentId: null,
      createdAt: 1,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-active",
      goals: [
        {
          id: "goal-1",
          target: "component:AdminDashboard",
          label: "First",
          text: "first change",
          mode: "code",
          createdAt: 1,
          status: "done",
          lifecycle: { stage: "impl", state: "ready_to_merge" },
          mergePolicy: { autoMerge: false },
          baseInstanceId: "inst-base",
          workingInstanceId: "inst-first",
          mergedInstanceId: null,
        },
        {
          id: "goal-2",
          target: "component:AdminDashboard",
          label: "Rename Hidden",
          text: "rename to Hidden",
          mode: "code",
          createdAt: 2,
          status: "done",
          lifecycle: { stage: "impl", state: "ready_to_merge" },
          mergePolicy: { autoMerge: false },
          baseInstanceId: "inst-base",
          workingInstanceId: "inst-selected",
          mergedInstanceId: null,
        },
      ],
      forkDir: "/tmp/ws-1",
      index: active,
      instances: {
        "inst-first": {
          id: "inst-first",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/first",
          mutability: "writable",
          createdAt: 2,
          index: first,
        },
        "inst-selected": {
          id: "inst-selected",
          workspaceId: "ws-1",
          materializedRoot: "/tmp/ws-1/selected",
          mutability: "writable",
          createdAt: 3,
          index: selected,
        },
      },
    }

    expect(selectWorkspaceReviewIndex(workspace, "goal-2")).toBe(selected)
  })
})

describe("snapshot rendering", () => {
  it("extracts HTML from a Vitest snapshot", () => {
    const snapshot = [
      "// Vitest Snapshot v1",
      "",
      "exports[`captured: JobRow/Default 1`] = `\"<div class=\\\"row\\\">Hello</div>\"`;",
    ].join("\n")

    expect(extractSnapshotHtml(snapshot)).toBe('<div class="row">Hello</div>')
  })

  it("extracts HTML from Vitest template snapshots with unescaped attribute quotes", () => {
    const snapshot = [
      "// Vitest Snapshot v1",
      "",
      "exports[`captured: JobRow/Default 1`] = `\"<a href=\"https://example.com\" target=\"_blank\">apply</a>\"`;",
    ].join("\n")

    expect(extractSnapshotHtml(snapshot)).toBe('<a href="https://example.com" target="_blank">apply</a>')
  })

  it("extracts HTML from indexed Vitest snapshot payloads", () => {
    expect(extractSnapshotHtml('"<div class=\\"row\\">Hello</div>"')).toBe('<div class="row">Hello</div>')
  })

  it("extracts HTML from indexed template payloads with unescaped attribute quotes", () => {
    expect(extractSnapshotHtml('"<a href="https://example.com" target="_blank">apply</a>"')).toBe(
      '<a href="https://example.com" target="_blank">apply</a>'
    )
  })

  it("does not treat arbitrary indexed snapshot payloads as renderable HTML", () => {
    expect(extractSnapshotHtml('"plain text"')).toBeNull()
  })

  it("formats snapshot HTML into structural lines", () => {
    expect(formatSnapshot("<div><strong>Before</strong><span>After</span></div>")).toBe([
      "<div>",
      "  <strong>Before</strong>",
      "  <span>After</span>",
      "</div>",
    ].join("\n"))
  })
})
