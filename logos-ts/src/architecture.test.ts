import { describe, expect, it } from "vitest"
import { Project, ts } from "ts-morph"
import { extractArchitecture } from "./architecture.js"

function source(text: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  })
  return project.createSourceFile("sample.ts", text)
}

describe("extractArchitecture", () => {
  it("ignores local function-valued variables inside implementation bodies", () => {
    const arch = extractArchitecture(source(`
      export const topLevel = () => "top"
      export let mutableTopLevel = () => "mutable"
      export var legacyTopLevel = function () { return "legacy" }

      export function outer() {
        const localArrow = () => "local"
        const localFunction = function () { return "nested" }
        return localArrow() + localFunction()
      }
    `))

    expect(arch.items.map((item) => item.name)).toEqual(["outer", "topLevel"])
  })
})
