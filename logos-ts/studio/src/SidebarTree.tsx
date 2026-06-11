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
  TestState,
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
  testStatus?: "pass" | "fail"
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
  testState: TestState | null
}

// Context lets the (static) arborist node renderer reach the live callbacks
// + the currently-selected id without re-creating the renderer each render.
interface Ctx {
  selectedId: string | null
  testsRunning: boolean
  onComment: Props["onComment"]
  onSelectComponent: Props["onSelectComponent"]
  onSelectBackend: Props["onSelectBackend"]
}
const SidebarCtx = createContext<Ctx>({
  selectedId: null,
  testsRunning: false,
  onComment: () => {},
  onSelectComponent: () => {},
  onSelectBackend: () => {},
})

const testsOf = (it: BackendItem): number =>
  it.kind === "class"
    ? it.tests.length + it.methods.reduce((n, m) => n + m.tests.length, 0)
    : it.tests.length

function rollUpTestStatus(children: SNode[] | undefined): "pass" | "fail" | undefined {
  if (!children) return undefined
  let hasTested = false
  for (const c of children) {
    if (c.testStatus === "fail") return "fail"
    if (c.testStatus === "pass") hasTested = true
  }
  return hasTested ? "pass" : undefined
}

// ---- build the nested data + the set of ids open by default ----
function buildData(
  components: ComponentEntry[],
  backend: BackendFile[],
  diff: Record<string, DiffStatus>,
  comments: Props["comments"],
  failingTests: Set<string> | null
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

  const isTestFailing = (t: { name: string; file: string }): boolean => {
    if (!failingTests) return false
    for (const key of failingTests) {
      const sep = key.indexOf(":")
      const fFile = key.slice(0, sep)
      const fName = key.slice(sep + 1)
      if (fFile === t.file && (fName === t.name || fName.endsWith(` > ${t.name}`) || fName.endsWith(` ${t.name}`)))
        return true
    }
    return false
  }

  const symTestStatus = (it: BackendItem): "pass" | "fail" | undefined => {
    if (!failingTests) return undefined
    const allTests =
      it.kind === "class"
        ? [...it.tests, ...it.methods.flatMap((m) => m.tests)]
        : it.tests
    if (allTests.length === 0) return undefined
    return allTests.some(isTestFailing) ? "fail" : "pass"
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
      label: it.name,
      status,
      tests: testsOf(it),
      testStatus: symTestStatus(it),
      comments: cCount(target),
      sel: { type: "backend", value: { symbol: it.name } },
    }
  }

  const fileNode = (f: BackendFile): SNode => {
    const name = f.file.split("/").pop() ?? f.file
    const target = `file:${f.file}`
    const items = f.items.slice().sort((a, b) => a.name.localeCompare(b.name))
    const children = items.map(symNode)
    return {
      id: `file:${f.file}`,
      name,
      kind: "file",
      target,
      label: name,
      comments: cCount(target),
      fns: f.items.length,
      tests: f.items.reduce((n, it) => n + testsOf(it), 0),
      testStatus: rollUpTestStatus(children),
      children,
    }
  }

  const dirNodes = (dir: Dir, path: string): SNode[] => {
    const out: SNode[] = []
    for (const [n, d] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const p = path ? `${path}/${n}` : n
      const target = `dir:backend/${p}`
      const id = `dir:${p}`
      openIds[id] = true
      const children = dirNodes(d, p)
      out.push({
        id,
        name: n,
        kind: "dir",
        target,
        label: n,
        comments: cCount(target),
        testStatus: rollUpTestStatus(children),
        children,
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

const svgIcon = (...paths: string[]) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "-2px" }}>
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
)

const GLYPH: Record<Kind, ReactNode> = {
  section: "",
  dir: svgIcon("M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"),
  file: svgIcon("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"),
  fn: svgIcon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M9 12c0-3 1.5-5 3-5s3 2 3 5-1.5 5-3 5-3-2-3-5"),
  cls: svgIcon("M3 3h18v18H3z", "M9 3v18", "M3 9h18"),
  comp: "",
  story: svgIcon("M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"),
  captured: svgIcon("M20 6L9 17l-5-5"),
}

function glyph(d: SNode, isOpen: boolean): string {
  if (d.kind === "dir") return isOpen ? "📂" : "📁"
  return GLYPH[d.kind]
}

function Node({ node, style }: NodeRendererProps<SNode>) {
  const d = node.data
  const { selectedId, testsRunning, onComment, onSelectComponent, onSelectBackend } = useContext(SidebarCtx)
  const isActive = selectedId === d.id
  const showDot = d.testStatus && (node.isLeaf || !node.isOpen)

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
      {showDot ? (
        <span className={`test-dot ${d.testStatus}${testsRunning ? " stale" : ""}`}>●</span>
      ) : (
        <span className="glyph-slot" />
      )}
      {d.kind !== "section" && <span className="glyph">{glyph(d, node.isOpen)}</span>}
      <span className="label">
        {d.name}
        {d.kind === "captured" && <em> ⟨captured⟩</em>}
      </span>
      {d.kind === "file" && d.fns ? <span className="fns">{d.fns}</span> : null}
      {d.kind === "comp" && d.stories ? <span className="count">{d.stories}</span> : null}
      {d.comments ? <span className="cbadge">{d.comments}</span> : null}
      {!showDot && d.tests ? <span className="count ok">✓{d.tests}</span> : null}
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
  testState,
}: Props) {
  const [term, setTerm] = useState("")
  const results = testState?.results ?? null
  const testsRunning = testState?.status === "running"
  const failingTests = useMemo(() => {
    if (!results || results.total === 0) return null
    const set = new Set<string>()
    for (const f of results.failures) set.add(`${f.file}:${f.test}`)
    return set
  }, [results])
  const { data, openIds } = useMemo(
    () => buildData(components, backend, diff, comments, failingTests),
    [components, backend, diff, comments, failingTests]
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
    () => ({ selectedId, testsRunning, onComment, onSelectComponent, onSelectBackend }),
    [selectedId, testsRunning, onComment, onSelectComponent, onSelectBackend]
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
