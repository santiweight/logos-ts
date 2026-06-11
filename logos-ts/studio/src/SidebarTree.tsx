import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist"
import type {
  BackendFile,
  BackendItem,
  BackendSel,
  Comment,
  ComponentEntry,
  DiffStatus,
  Selection,
  View,
} from "./types"

// ---- one flat node type for the whole sidebar (components + backend) ----
type Kind = "section" | "dir" | "file" | "fn" | "cls" | "comp" | "story" | "captured"

interface SNode {
  id: string
  name: string
  kind: Kind
  children?: SNode[]
  // diff + comment routing
  target?: string // stable tag shared with comments/diff, e.g. "fn:parseJob"
  label?: string // comment-popup label
  status?: DiffStatus
  comments?: number
  // badges
  tests?: number
  fns?: number
  stories?: number
  // selection routing
  sel?:
    | { type: "component"; value: Selection }
    | { type: "backend"; value: BackendSel }
}

interface Props {
  components: ComponentEntry[]
  backend: BackendFile[]
  active: "component" | "backend"
  selection: Selection
  backendSel: BackendSel | null
  onSelectComponent: (sel: Selection) => void
  onSelectBackend: (sel: BackendSel) => void
  comments: Record<string, Comment[] | undefined>
  onComment: (target: string, label: string, x: number, y: number) => void
  diff: Record<string, DiffStatus>
}

// Context lets the (static) arborist node renderer reach the live callbacks
// + the currently-selected id without re-creating the renderer each render.
interface Ctx {
  selectedId: string | null
  onComment: Props["onComment"]
  onSelectComponent: Props["onSelectComponent"]
  onSelectBackend: Props["onSelectBackend"]
}
const SidebarCtx = createContext<Ctx>({
  selectedId: null,
  onComment: () => {},
  onSelectComponent: () => {},
  onSelectBackend: () => {},
})

const testsOf = (it: BackendItem): number =>
  it.kind === "class"
    ? it.tests.length + it.methods.reduce((n, m) => n + m.tests.length, 0)
    : it.tests.length

// ---- build the nested data + the set of ids open by default ----
function buildData(
  components: ComponentEntry[],
  backend: BackendFile[],
  diff: Record<string, DiffStatus>,
  comments: Props["comments"]
): { data: SNode[]; openIds: Record<string, boolean> } {
  const openIds: Record<string, boolean> = { "sec:components": true, "sec:backend": true }
  const cCount = (target: string) => comments[target]?.length ?? 0

  // COMPONENTS
  const compNodes: SNode[] = components.map((c) => {
    const status = diff[`component:${c.name}`] ?? (c.propsName ? diff[`props:${c.propsName}`] : undefined)
    const stories: SNode[] = c.stories.map((s) => ({
      id: `story:${s.id}`,
      name: s.exportName,
      kind: "story",
      sel: { type: "component", value: { comp: c.name, view: "story" as View, storyId: s.id } },
    }))
    const captured: SNode[] = c.captured.map((cap) => ({
      id: `cap:${c.name}:${cap.exportName}`,
      name: cap.exportName,
      kind: "captured",
      sel: {
        type: "component",
        value: { comp: c.name, view: "captured" as View, exportName: cap.exportName },
      },
    }))
    const kids = [...stories, ...captured]
    return {
      id: `comp:${c.name}`,
      name: c.name,
      kind: "comp",
      status,
      stories: c.stories.length,
      sel: { type: "component", value: { comp: c.name, view: "code" as View } },
      children: kids.length ? kids : undefined,
    }
  })

  // BACKEND — group files into a directory tree, then map to SNodes
  interface Dir {
    dirs: Map<string, Dir>
    files: BackendFile[]
  }
  const root: Dir = { dirs: new Map(), files: [] }
  for (const f of backend) {
    const parts = f.file.replace(/^backend\//, "").split("/")
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i]
      if (!cur.dirs.has(d)) cur.dirs.set(d, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(d)!
    }
    cur.files.push(f)
  }

  const symNode = (it: BackendItem): SNode => {
    const isClass = it.kind === "class"
    const target = `${isClass ? "cls" : "fn"}:${it.name}`
    let status = diff[target]
    if (!status && isClass && it.methods.some((m) => diff[`method:${it.name}.${m.name}`]))
      status = "changed"
    return {
      id: `sym:${it.name}`,
      name: it.name,
      kind: isClass ? "cls" : "fn",
      target,
      label: `${isClass ? "⬚" : "ƒ"} ${it.name}`,
      status,
      tests: testsOf(it),
      comments: cCount(target),
      sel: { type: "backend", value: { symbol: it.name } },
    }
  }

  const fileNode = (f: BackendFile): SNode => {
    const name = f.file.split("/").pop() ?? f.file
    const target = `file:${f.file}`
    const items = f.items.slice().sort((a, b) => a.name.localeCompare(b.name))
    return {
      id: `file:${f.file}`,
      name,
      kind: "file",
      target,
      label: `📄 ${name}`,
      comments: cCount(target),
      fns: f.items.length,
      tests: f.items.reduce((n, it) => n + testsOf(it), 0),
      children: items.map(symNode),
    }
  }

  const dirNodes = (dir: Dir, path: string): SNode[] => {
    const out: SNode[] = []
    for (const [n, d] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const p = path ? `${path}/${n}` : n
      const target = `dir:backend/${p}`
      const id = `dir:${p}`
      openIds[id] = true // dirs open by default — files are the skeleton, fns hide inside
      out.push({
        id,
        name: n,
        kind: "dir",
        target,
        label: n,
        comments: cCount(target),
        children: dirNodes(d, p),
      })
    }
    for (const f of dir.files.slice().sort((a, b) => a.file.localeCompare(b.file))) out.push(fileNode(f))
    return out
  }

  const data: SNode[] = [
    { id: "sec:components", name: "COMPONENTS", kind: "section", children: compNodes },
    { id: "sec:backend", name: "BACKEND", kind: "section", children: dirNodes(root, "") },
  ]
  return { data, openIds }
}

const svgIcon = (d: string) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }}>
    <path d={d} />
  </svg>
)

const GLYPH: Record<Kind, ReactNode> = {
  section: "",
  dir: svgIcon("M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"),
  file: svgIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"),
  fn: "ƒ",
  cls: "⬚",
  comp: "",
  story: "◆",
  captured: "✓",
}

function Node({ node, style }: NodeRendererProps<SNode>) {
  const d = node.data
  const { selectedId, onComment, onSelectComponent, onSelectBackend } = useContext(SidebarCtx)
  const isActive = selectedId === d.id

  const onClick = (e: React.MouseEvent) => {
    if ((e.altKey || e.metaKey || e.ctrlKey) && d.target) {
      e.preventDefault()
      e.stopPropagation()
      onComment(d.target, d.label ?? d.name, e.clientX, e.clientY)
      return
    }
    if (d.sel?.type === "component") onSelectComponent(d.sel.value)
    else if (d.sel?.type === "backend") onSelectBackend(d.sel.value)
    if (!node.isLeaf) node.toggle()
  }

  return (
    <div
      className={`anode ${d.kind} ${isActive ? "active" : ""} ${d.status ? `diff-${d.status}` : ""}`}
      style={style}
      onClick={onClick}
    >
      <span className="caret">{node.isLeaf ? "" : node.isOpen ? "▾" : "▸"}</span>
      {d.kind !== "section" && <span className="glyph">{GLYPH[d.kind]}</span>}
      <span className="label">
        {d.name}
        {d.kind === "captured" && <em> ⟨captured⟩</em>}
      </span>
      {d.kind === "file" && d.fns ? <span className="fns">{d.fns}ƒ</span> : null}
      {d.kind === "comp" && d.stories ? <span className="count">{d.stories}</span> : null}
      {d.comments ? <span className="cbadge">💬{d.comments}</span> : null}
      {d.tests ? <span className="count ok">✓{d.tests}</span> : null}
    </div>
  )
}

const rowHeight = (node: NodeApi<SNode>) => {
  const k = node.data.kind
  if (k === "section") return 24
  if (k === "fn" || k === "cls" || k === "story" || k === "captured") return 19
  return 23
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

export function SidebarTree({
  components,
  backend,
  active,
  selection,
  backendSel,
  onSelectComponent,
  onSelectBackend,
  comments,
  onComment,
  diff,
}: Props) {
  const [term, setTerm] = useState("")
  const { data, openIds } = useMemo(
    () => buildData(components, backend, diff, comments),
    [components, backend, diff, comments]
  )

  const selectedId =
    active === "backend"
      ? backendSel
        ? `sym:${backendSel.symbol}`
        : null
      : selection.view === "code"
        ? `comp:${selection.comp}`
        : selection.view === "story"
          ? `story:${selection.storyId}`
          : selection.view === "captured"
            ? `cap:${selection.comp}:${selection.exportName}`
            : null

  const ctx = useMemo<Ctx>(
    () => ({ selectedId, onComment, onSelectComponent, onSelectBackend }),
    [selectedId, onComment, onSelectComponent, onSelectBackend]
  )

  const [ref, size] = useSize()

  return (
    <SidebarCtx.Provider value={ctx}>
      <div className="sidebar-search">
        <input
          className="sidebar-search-input"
          placeholder="Filter components & symbols…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {term && (
          <button className="sidebar-search-clear" onClick={() => setTerm("")} title="Clear">
            ✕
          </button>
        )}
      </div>
      <div className="sidebar-tree" ref={ref}>
        <Tree<SNode>
          data={data}
          idAccessor="id"
          openByDefault={false}
          initialOpenState={openIds}
          width={size.width}
          height={size.height}
          indent={12}
          rowHeight={rowHeight}
          overscanCount={8}
          disableDrag
          disableDrop
          disableEdit
          searchTerm={term}
          searchMatch={(node, t) => node.data.name.toLowerCase().includes(t.toLowerCase())}
        >
          {Node}
        </Tree>
      </div>
    </SidebarCtx.Provider>
  )
}
