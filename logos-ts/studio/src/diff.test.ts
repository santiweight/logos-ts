import { describe, expect, it } from "vitest"
import { diffIndex } from "./diff"
import type { StudioIndex } from "./types"

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
})
