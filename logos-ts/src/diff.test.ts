import { describe, it, expect } from "vitest"

// Inline the diffIndex logic so we can test without studio's React deps.
// This mirrors studio/src/diff.ts exactly.

interface TestRef { name: string; file: string; code: string }
interface StoryNode { id: string; exportName: string; snapshot: string | null }
interface BackendMethod { name: string; signature: string; code: string; tests: TestRef[] }
interface FileFn { kind: "function"; name: string; signature: string; code: string; deps: string[]; tests: TestRef[] }
interface FileClass { kind: "class"; name: string; fields: { name: string; type: string }[]; methods: BackendMethod[]; deps: string[]; tests: TestRef[]; code: string }
type FileItem = FileFn | FileClass
interface FileEntry {
  file: string; code: string; items: FileItem[]
  component?: {
    name: string; signature: string; componentCode: string
    propsName?: string; propsCode?: string
    propsFields: { name: string; type: string }[]
    stories: StoryNode[]
  }
}
interface StudioIndex { root: string; files: FileEntry[] }
type DiffStatus = "added" | "changed" | "removed"

function collectNodes(index: StudioIndex): Map<string, string> {
  const m = new Map<string, string>()
  const SEP = " "
  for (const f of index.files) {
    if (f.component) {
      m.set(`component:${f.component.name}`, f.component.signature + SEP + f.component.componentCode)
      if (f.component.propsName) m.set(`props:${f.component.propsName}`, f.component.propsCode ?? "")
    }
    for (const it of f.items) {
      if (it.kind === "function") {
        m.set(`fn:${it.name}`, it.signature + SEP + it.code)
        for (const t of it.tests) m.set(`test:${t.file}::${t.name}`, t.code)
      } else {
        m.set(`cls:${it.name}`, it.code)
        for (const cm of it.methods) {
          m.set(`method:${it.name}.${cm.name}`, cm.signature + SEP + cm.code)
          for (const t of cm.tests) m.set(`test:${t.file}::${t.name}`, t.code)
        }
        for (const t of it.tests) m.set(`test:${t.file}::${t.name}`, t.code)
      }
    }
  }
  return m
}

function diffIndex(base: StudioIndex, ws: StudioIndex): Record<string, DiffStatus> {
  const b = collectNodes(base)
  const w = collectNodes(ws)
  const out: Record<string, DiffStatus> = {}
  for (const [id, fp] of w) {
    if (!b.has(id)) out[id] = "added"
    else if (b.get(id) !== fp) out[id] = "changed"
  }
  for (const id of b.keys()) if (!w.has(id)) out[id] = "removed"
  return out
}

// ---- helpers ----

function makeFn(name: string, code = `function ${name}() {}`, sig = `${name}(): void`): FileFn {
  return { kind: "function", name, signature: sig, code, deps: [], tests: [] }
}

function makeClass(name: string, methods: BackendMethod[] = [], code = `class ${name} {}`): FileClass {
  return { kind: "class", name, fields: [], methods, deps: [], tests: [], code }
}

function makeMethod(name: string, code = `${name}() {}`, sig = `${name}(): void`): BackendMethod {
  return { name, signature: sig, code, tests: [] }
}

function makeFile(file: string, items: FileItem[] = [], component?: FileEntry["component"]): FileEntry {
  return { file, code: "", items, ...(component != null ? { component } : {}) }
}

function makeIndex(files: FileEntry[]): StudioIndex {
  return { root: "/test", files }
}

function makeComponent(name: string, overrides?: Partial<NonNullable<FileEntry["component"]>>): NonNullable<FileEntry["component"]> {
  return {
    name,
    signature: `${name}: FC`,
    componentCode: `function ${name}() { return null }`,
    propsFields: [],
    stories: [],
    ...overrides,
  }
}

// ---- tests ----

describe("diffIndex", () => {
  it("returns empty when base and workspace are identical", () => {
    const idx = makeIndex([makeFile("a.ts", [makeFn("foo")])])
    expect(diffIndex(idx, idx)).toEqual({})
  })

  it("detects an added function", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo"), makeFn("bar")])])
    const d = diffIndex(base, ws)
    expect(d["fn:bar"]).toBe("added")
    expect(d["fn:foo"]).toBeUndefined()
  })

  it("detects a removed function", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo"), makeFn("bar")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo")])])
    const d = diffIndex(base, ws)
    expect(d["fn:bar"]).toBe("removed")
    expect(d["fn:foo"]).toBeUndefined()
  })

  it("detects a changed function (code differs)", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo", "function foo() { return 1 }")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo", "function foo() { return 2 }")])])
    const d = diffIndex(base, ws)
    expect(d["fn:foo"]).toBe("changed")
  })

  it("detects a changed function (signature differs)", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo", "function foo() {}", "foo(): void")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo", "function foo() {}", "foo(): number")])])
    const d = diffIndex(base, ws)
    expect(d["fn:foo"]).toBe("changed")
  })

  it("detects an added class", () => {
    const base = makeIndex([makeFile("a.ts")])
    const ws = makeIndex([makeFile("a.ts", [makeClass("Widget")])])
    const d = diffIndex(base, ws)
    expect(d["cls:Widget"]).toBe("added")
  })

  it("detects a removed class", () => {
    const base = makeIndex([makeFile("a.ts", [makeClass("Widget")])])
    const ws = makeIndex([makeFile("a.ts")])
    const d = diffIndex(base, ws)
    expect(d["cls:Widget"]).toBe("removed")
  })

  it("detects a changed class method", () => {
    const m1 = makeMethod("render", "render() { return null }")
    const m2 = makeMethod("render", "render() { return <div/> }")
    const base = makeIndex([makeFile("a.ts", [makeClass("Widget", [m1])])])
    const ws = makeIndex([makeFile("a.ts", [makeClass("Widget", [m2])])])
    const d = diffIndex(base, ws)
    expect(d["method:Widget.render"]).toBe("changed")
  })

  it("detects an added class method", () => {
    const base = makeIndex([makeFile("a.ts", [makeClass("Widget", [makeMethod("render")])])])
    const ws = makeIndex([makeFile("a.ts", [makeClass("Widget", [makeMethod("render"), makeMethod("update")])])])
    const d = diffIndex(base, ws)
    expect(d["method:Widget.update"]).toBe("added")
  })

  it("detects an added component", () => {
    const base = makeIndex([makeFile("Button.tsx")])
    const ws = makeIndex([makeFile("Button.tsx", [], makeComponent("Button"))])
    const d = diffIndex(base, ws)
    expect(d["component:Button"]).toBe("added")
  })

  it("detects a changed component", () => {
    const base = makeIndex([makeFile("Button.tsx", [], makeComponent("Button", { componentCode: "v1" }))])
    const ws = makeIndex([makeFile("Button.tsx", [], makeComponent("Button", { componentCode: "v2" }))])
    const d = diffIndex(base, ws)
    expect(d["component:Button"]).toBe("changed")
  })

  it("detects changed props", () => {
    const base = makeIndex([makeFile("Button.tsx", [], makeComponent("Button", { propsName: "ButtonProps", propsCode: "type ButtonProps = { label: string }" }))])
    const ws = makeIndex([makeFile("Button.tsx", [], makeComponent("Button", { propsName: "ButtonProps", propsCode: "type ButtonProps = { label: string; disabled: boolean }" }))])
    const d = diffIndex(base, ws)
    expect(d["props:ButtonProps"]).toBe("changed")
  })

  it("detects added file with new functions", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo")]), makeFile("b.ts", [makeFn("bar"), makeFn("baz")])])
    const d = diffIndex(base, ws)
    expect(d["fn:bar"]).toBe("added")
    expect(d["fn:baz"]).toBe("added")
    expect(d["fn:foo"]).toBeUndefined()
  })

  it("detects removed file — all its symbols marked removed", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo")]), makeFile("b.ts", [makeFn("bar")])])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo")])])
    const d = diffIndex(base, ws)
    expect(d["fn:bar"]).toBe("removed")
  })

  it("function moved to a different file is neither added nor removed (same name+code)", () => {
    const fn = makeFn("helper", "function helper() { return 42 }")
    const base = makeIndex([makeFile("old.ts", [fn])])
    const ws = makeIndex([makeFile("new.ts", [fn])])
    const d = diffIndex(base, ws)
    expect(d["fn:helper"]).toBeUndefined()
  })

  it("handles test refs: added test detected", () => {
    const fnBase = makeFn("foo")
    const fnWs: FileFn = { ...makeFn("foo"), tests: [{ name: "foo works", file: "foo.test.ts", code: "it('foo works', ...)" }] }
    const base = makeIndex([makeFile("a.ts", [fnBase])])
    const ws = makeIndex([makeFile("a.ts", [fnWs])])
    const d = diffIndex(base, ws)
    expect(d["test:foo.test.ts::foo works"]).toBe("added")
  })

  it("handles simultaneous adds, changes, and removes", () => {
    const base = makeIndex([
      makeFile("a.ts", [makeFn("keep"), makeFn("change", "v1"), makeFn("remove")]),
    ])
    const ws = makeIndex([
      makeFile("a.ts", [makeFn("keep"), makeFn("change", "v2"), makeFn("added")]),
    ])
    const d = diffIndex(base, ws)
    expect(d["fn:keep"]).toBeUndefined()
    expect(d["fn:change"]).toBe("changed")
    expect(d["fn:remove"]).toBe("removed")
    expect(d["fn:added"]).toBe("added")
  })

  it("empty base vs populated workspace — everything is added", () => {
    const base = makeIndex([])
    const ws = makeIndex([makeFile("a.ts", [makeFn("foo"), makeClass("Bar")])])
    const d = diffIndex(base, ws)
    expect(d["fn:foo"]).toBe("added")
    expect(d["cls:Bar"]).toBe("added")
  })

  it("populated base vs empty workspace — everything is removed", () => {
    const base = makeIndex([makeFile("a.ts", [makeFn("foo"), makeClass("Bar")])])
    const ws = makeIndex([])
    const d = diffIndex(base, ws)
    expect(d["fn:foo"]).toBe("removed")
    expect(d["cls:Bar"]).toBe("removed")
  })
})
