import { describe, expect, it } from "vitest"
import { architectureDiffIndex, diffIndex } from "./diff"
import type { FileEntry, StudioIndex } from "./types"

function index(code: string): StudioIndex {
  return {
    root: "/test",
    files: [{
      file: "src/example.ts",
      code,
      items: [],
    }],
  }
}

function componentIndex(storyCode: string): StudioIndex {
  return {
    root: "/test",
    files: [{
      file: "src/Button.tsx",
      code: "export function Button() { return null }",
      items: [],
      component: {
        name: "Button",
        signature: "Button()",
        componentCode: "export function Button() { return null }",
        propsFields: [],
        stories: [{
          id: "button--default",
          exportName: "Default",
          storyFile: "src/Button.stories.tsx",
          storyCode,
          snapshot: null,
        }],
      },
    }],
  }
}

function functionIndex(item: FileEntry["items"][number]): StudioIndex {
  return {
    root: "/test",
    files: [{
      file: "src/job-filters.ts",
      code: "",
      items: [item],
    }],
  }
}

describe("diffIndex", () => {
  it("marks changed files directly", () => {
    expect(diffIndex(index("export const value = 1"), index("export const value = 2"))).toMatchObject({
      "file:src/example.ts": "changed",
    })
  })

  it("marks story-only edits as changed", () => {
    expect(diffIndex(
      componentIndex("export const Default = { args: { count: 1 } }"),
      componentIndex("export const Default = { args: { count: 2 } }"),
    )).toMatchObject({
      "story-file:src/Button.stories.tsx": "changed",
    })
  })

  it("does not mark body-only implementation edits as architecture diffs", () => {
    const base = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job, filters: Filters): boolean",
      code: "return true",
      deps: [],
      tests: [],
    })
    const workspace = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job, filters: Filters): boolean",
      code: "return filters.query.length > 0",
      deps: [],
      tests: [],
    })

    expect(diffIndex(base, workspace)).toMatchObject({
      "fn:jobMatchesFilters": "changed",
    })
    expect(architectureDiffIndex(base, workspace)).toEqual({})
  })

  it("marks attached acceptance tests as architecture diffs", () => {
    const base = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job, filters: Filters): boolean",
      code: "return true",
      deps: [],
      tests: [],
    })
    const workspace = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job, filters: Filters): boolean",
      code: "return true",
      deps: [],
      tests: [{
        name: "single-word typo tolerance",
        file: "src/job-filters.test.ts",
        code: "test('single-word typo tolerance', () => {})",
      }],
    })

    expect(architectureDiffIndex(base, workspace)).toMatchObject({
      "file:src/job-filters.ts": "changed",
      "fn:jobMatchesFilters": "changed",
      "test:src/job-filters.test.ts::single-word typo tolerance": "added",
    })
  })

  it("marks signature changes as architecture diffs", () => {
    const base = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job): boolean",
      code: "return true",
      deps: [],
      tests: [],
    })
    const workspace = functionIndex({
      kind: "function",
      name: "jobMatchesFilters",
      signature: "jobMatchesFilters(job: Job, filters: Filters): boolean",
      code: "return true",
      deps: [],
      tests: [],
    })

    expect(architectureDiffIndex(base, workspace)).toMatchObject({
      "file:src/job-filters.ts": "changed",
      "fn:jobMatchesFilters": "changed",
    })
  })
})
