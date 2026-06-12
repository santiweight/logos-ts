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

describe("diffIndex", () => {
  it("marks changed files directly", () => {
    expect(diffIndex(index("export const value = 1"), index("export const value = 2"))).toMatchObject({
      "file:src/example.ts": "changed",
    })
  })
})
