import { describe, expect, it } from "vitest"
import {
  capturedTestChanges,
  extractSnapshotHtml,
  formatCapturedSnapshot,
  selectReviewBaseIndex,
  selectWorkspaceReviewBaseIndex,
} from "./review"
import type { FileEntry, StudioIndex, Workspace } from "./types"

function indexWithCapture(
  snapshot: string | null,
  overrides: { component?: string; exportName?: string; testFile?: string } = {}
): StudioIndex {
  const component = overrides.component ?? "JobRow"
  const exportName = overrides.exportName ?? "Default"
  const testFile = overrides.testFile ?? `components/${component}.${exportName}.captured.test.tsx`
  const file: FileEntry = {
    file: `components/${component}.tsx`,
    code: "",
    items: [],
    component: {
      name: component,
      signature: `${component}()`,
      componentCode: "",
      propsFields: [],
      stories: [{ id: `${component.toLowerCase()}--${exportName.toLowerCase()}`, exportName }],
      captured: [{ exportName, testFile, snapshot, previousSnapshot: null }],
    },
  }
  return { root: "/test", files: [file] }
}

describe("capturedTestChanges", () => {
  it("returns only snapshots whose captured output changed", () => {
    const base = indexWithCapture("<div>before</div>")
    const workspace = indexWithCapture("<div>after</div>")

    expect(capturedTestChanges(base, workspace)).toEqual([
      expect.objectContaining({
        component: "JobRow",
        exportName: "Default",
        status: "changed",
        beforeSnapshot: "<div>before</div>",
        afterSnapshot: "<div>after</div>",
      }),
    ])
  })

  it("does not report identical captures", () => {
    const base = indexWithCapture("<div>same</div>")
    expect(capturedTestChanges(base, base)).toEqual([])
  })

  it("reports added and removed captured tests", () => {
    const empty: StudioIndex = { root: "/test", files: [] }
    const captured = indexWithCapture("<div>captured</div>")

    expect(capturedTestChanges(empty, captured)[0]?.status).toBe("added")
    expect(capturedTestChanges(captured, empty)[0]?.status).toBe("removed")
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
  it("uses the workspace base instance as the review baseline", () => {
    const project = indexWithCapture("<div>project</div>")
    const base = indexWithCapture("<div>Senior Engineer</div>")
    const active = indexWithCapture("<div><strong>Senior Engineer</strong></div>")
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
    expect(capturedTestChanges(reviewBase, workspace.index)).toEqual([
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
      parentId: null,
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

  it("formats captured HTML into structural lines", () => {
    expect(formatCapturedSnapshot("<div><strong>Before</strong><span>After</span></div>")).toBe([
      "<div>",
      "  <strong>Before</strong>",
      "  <span>After</span>",
      "</div>",
    ].join("\n"))
  })
})
