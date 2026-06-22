import type { StudioIndex, DiffStatus } from "./types"

const componentsOf = (file: StudioIndex["files"][number]) =>
  file.components?.length ? file.components : file.component ? [file.component] : []

function collectNodes(index: StudioIndex): Map<string, string> {
  const m = new Map<string, string>()
  const SEP = " "
  for (const f of index.files) {
    m.set(`file:${f.file}`, f.code)
    for (const component of componentsOf(f)) {
      m.set(`component:${component.name}`, component.signature + SEP + component.componentCode)
      if (component.propsName) m.set(`props:${component.propsName}`, component.propsCode ?? "")
      for (const story of component.stories) {
        if (story.storyCode == null) continue
        const id = `story-file:${story.storyFile ?? component.name}`
        if (!m.has(id)) m.set(id, story.storyCode)
      }
    }
    for (const it of f.items) {
      if (it.kind === "function") {
        m.set(`fn:${it.name}`, it.signature + SEP + it.code)
        for (const t of it.tests) m.set(`test:${t.file}::${t.name}`, t.code)
      } else if (it.kind === "type") {
        m.set(`type:${it.name}`, it.signature + SEP + it.code)
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

function testFingerprint(test: { name: string; description?: string; code: string }): string {
  return JSON.stringify({
    name: test.name,
    description: test.description ?? "",
    code: test.code,
  })
}

function collectArchitectureNodes(index: StudioIndex): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of index.files) {
    const fileParts: string[] = []
    for (const it of f.items) {
      if (it.kind === "function") {
        const tests = it.tests.map(testFingerprint)
        m.set(`fn:${it.name}`, JSON.stringify({ signature: it.signature, tests }))
        fileParts.push(`fn:${it.name}:${it.signature}:${tests.join("\n")}`)
        for (const t of it.tests) m.set(`test:${t.file}::${t.name}`, testFingerprint(t))
      } else if (it.kind === "type") {
        m.set(`type:${it.name}`, it.signature)
        fileParts.push(`type:${it.name}:${it.signature}`)
      } else {
        const fields = it.fields.map((field) => `${field.name}:${field.type}`)
        const classTests = it.tests.map(testFingerprint)
        const methods = it.methods.map((method) => {
          const tests = method.tests.map(testFingerprint)
          m.set(`method:${it.name}.${method.name}`, JSON.stringify({ signature: method.signature, tests }))
          for (const t of method.tests) m.set(`test:${t.file}::${t.name}`, testFingerprint(t))
          return `${method.name}:${method.signature}:${tests.join("\n")}`
        })
        m.set(`cls:${it.name}`, JSON.stringify({ fields, methods, tests: classTests }))
        fileParts.push(`cls:${it.name}:${fields.join("\n")}:${methods.join("\n")}:${classTests.join("\n")}`)
        for (const t of it.tests) m.set(`test:${t.file}::${t.name}`, testFingerprint(t))
      }
    }
    for (const component of componentsOf(f)) {
      const props = component.propsFields.map((field) => `${field.name}:${field.type}`)
      const stories = component.stories
        .filter((story) => story.storyFile != null)
        .map((story) => `${story.exportName}:${story.storyFile}`)
      m.set(`component:${component.name}`, JSON.stringify({
        signature: component.signature,
        propsName: component.propsName ?? "",
        props,
        stories,
      }))
      if (component.propsName) m.set(`props:${component.propsName}`, JSON.stringify(props))
      fileParts.push(`component:${component.name}:${component.signature}:${props.join("\n")}:${stories.join("\n")}`)
    }
    if (fileParts.length > 0) m.set(`file:${f.file}`, fileParts.join("\n"))
  }
  return m
}

function diffNodes(base: Map<string, string>, ws: Map<string, string>): Record<string, DiffStatus> {
  const out: Record<string, DiffStatus> = {}
  for (const [id, fp] of ws) {
    if (!base.has(id)) out[id] = "added"
    else if (base.get(id) !== fp) out[id] = "changed"
  }
  for (const id of base.keys()) if (!ws.has(id)) out[id] = "removed"
  return out
}

export function diffIndex(base: StudioIndex, ws: StudioIndex): Record<string, DiffStatus> {
  return diffNodes(collectNodes(base), collectNodes(ws))
}

export function architectureDiffIndex(base: StudioIndex, ws: StudioIndex): Record<string, DiffStatus> {
  return diffNodes(collectArchitectureNodes(base), collectArchitectureNodes(ws))
}
