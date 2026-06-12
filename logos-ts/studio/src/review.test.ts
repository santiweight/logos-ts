import { describe, expect, it } from "vitest"
import { capturedTestChanges, extractSnapshotHtml, formatCapturedSnapshot } from "./review"
import type { FileEntry, StudioIndex } from "./types"

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

describe("snapshot rendering", () => {
  it("extracts HTML from a Vitest snapshot", () => {
    const snapshot = [
      "// Vitest Snapshot v1",
      "",
      "exports[`captured: JobRow/Default 1`] = `\"<div class=\\\"row\\\">Hello</div>\"`;",
    ].join("\n")

    expect(extractSnapshotHtml(snapshot)).toBe('<div class="row">Hello</div>')
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
