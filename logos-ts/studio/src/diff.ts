import type { StudioIndex, DiffStatus } from "./types"

function collectNodes(index: StudioIndex): Map<string, string> {
  const m = new Map<string, string>()
  const SEP = " "
  for (const f of index.files) {
    m.set(`file:${f.file}`, f.code)
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

export function diffIndex(base: StudioIndex, ws: StudioIndex): Record<string, DiffStatus> {
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
