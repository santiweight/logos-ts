import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ICONS } from "./icons"
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist"
import type {
  Goal,
  DiffStatus,
  FileEntry,
  FileItem,
  Selection,
  TestState,
  View,
} from "./types"

type Kind = "dir" | "file" | "fn" | "cls" | "comp" | "story" | "captured" | "section"

interface SNode {
  id: string
  name: string
  kind: Kind
  children?: SNode[]
  target?: string
  label?: string
  status?: DiffStatus
  comments?: number
  tests?: number
  testStatus?: "pass" | "fail"
  fns?: number
  stories?: number
  sel?: Selection
}

interface Props {
  files: FileEntry[]
  selection: Selection
  onSelect: (sel: Selection) => void
  comments: Record<string, Goal[] | undefined>
  onComment: (target: string, label: string, x: number, y: number) => void
  diff: Record<string, DiffStatus>
  testState: TestState | null
}

interface Ctx {
  selectedId: string | null
  testsRunning: boolean
  onComment: Props["onComment"]
  onSelect: Props["onSelect"]
}
const SidebarCtx = createContext<Ctx>({
  selectedId: null,
  testsRunning: false,
  onComment: () => {},
  onSelect: () => {},
})

const testsOf = (it: FileItem): number =>
  it.kind === "class"
    ? it.tests.length + (it.methods ?? []).reduce((n, m) => n + m.tests.length, 0)
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

function buildData(
  files: FileEntry[],
  diff: Record<string, DiffStatus>,
  comments: Props["comments"],
  failingTests: Set<string> | null
): { data: SNode[]; openIds: Record<string, boolean> } {
  const openIds: Record<string, boolean> = {}
  const cCount = (target: string) => comments[target]?.length ?? 0

  const failingFiles = failingTests
    ? new Set([...failingTests].map((k) => k.slice(0, k.indexOf(":"))))
    : null

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

  const symTestStatus = (it: FileItem): "pass" | "fail" | undefined => {
    if (!failingTests) return undefined
    const allTests =
      it.kind === "class"
        ? [...it.tests, ...(it.methods ?? []).flatMap((m) => m.tests)]
        : it.tests
    if (allTests.length === 0) return undefined
    return allTests.some(isTestFailing) ? "fail" : "pass"
  }

  const symNode = (it: FileItem, file: string): SNode => {
    const isClass = it.kind === "class"
    const target = `${isClass ? "cls" : "fn"}:${it.name}`
    let status = diff[target]
    if (!status && isClass && (it.methods ?? []).some((m) => diff[`method:${it.name}.${m.name}`]))
      status = "changed"
    return {
      id: `sym:${file}:${it.name}`,
      name: it.name,
      kind: isClass ? "cls" : "fn",
      target,
      label: it.name,
      status,
      tests: testsOf(it),
      testStatus: symTestStatus(it),
      comments: cCount(target),
      sel: { file, symbol: it.name, view: "code" },
    }
  }

  const fileNode = (f: FileEntry): SNode => {
    const name = f.file.split("/").pop() ?? f.file
    const target = `file:${f.file}`
    const children: SNode[] = []

    if (f.component) {
      const comp = f.component
      const compTarget = `component:${comp.name}`
      const status = diff[compTarget] ?? (comp.propsName ? diff[`props:${comp.propsName}`] : undefined)
      const storyNodes: SNode[] = comp.stories.map((s) => ({
        id: `story:${s.id}`,
        name: s.exportName,
        kind: "story" as Kind,
        sel: { file: f.file, view: "story" as View, storyId: s.id },
      }))
      const capturedNodes: SNode[] = comp.captured.map((cap) => {
        const capStatus: "pass" | "fail" | undefined = failingFiles
          ? failingFiles.has(cap.testFile) ? "fail" : "pass"
          : undefined
        return {
          id: `cap:${comp.name}:${cap.exportName}`,
          name: cap.exportName,
          kind: "captured" as Kind,
          testStatus: capStatus,
          sel: { file: f.file, view: "captured" as View, exportName: cap.exportName },
        }
      })
      const compId = `comp:${comp.name}`
      children.push({
        id: compId,
        name: comp.name,
        kind: "comp",
        status,
        stories: comp.stories.length,
        testStatus: rollUpTestStatus(capturedNodes),
        sel: { file: f.file, view: "code" },
        children: [...storyNodes, ...capturedNodes].length ? [...storyNodes, ...capturedNodes] : undefined,
      })
      openIds[`file:${f.file}`] = true
    }

    const items = f.items.slice().sort((a, b) => a.name.localeCompare(b.name))
    for (const it of items) children.push(symNode(it, f.file))

    return {
      id: `file:${f.file}`,
      name,
      kind: "file",
      target,
      label: name,
      comments: cCount(target),
      fns: f.items.length + (f.component ? 1 : 0),
      tests: f.items.reduce((n, it) => n + testsOf(it), 0),
      testStatus: rollUpTestStatus(children),
      children: children.length ? children : undefined,
      sel: { file: f.file, view: "code" },
    }
  }

  // Group files into a directory tree
  interface Dir {
    dirs: Map<string, Dir>
    files: FileEntry[]
  }
  const root: Dir = { dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.file.split("/")
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i]
      if (!cur.dirs.has(d)) cur.dirs.set(d, { dirs: new Map(), files: [] })
      cur = cur.dirs.get(d)!
    }
    cur.files.push(f)
  }

  const dirNodes = (dir: Dir, path: string): SNode[] => {
    const out: SNode[] = []
    for (const [n, d] of [...dir.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const p = path ? `${path}/${n}` : n
      const target = `dir:${p}`
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

  return { data: dirNodes(root, ""), openIds }
}

const GLYPH: Record<Kind, ReactNode> = {
  dir: ICONS.dir,
  file: ICONS.file,
  fn: ICONS.fn,
  cls: ICONS.cls,
  comp: ICONS.comp,
  story: ICONS.story,
  captured: ICONS.captured,
  section: "§",
}

function Node({ node, style }: NodeRendererProps<SNode>) {
  const d = node.data
  const { selectedId, testsRunning, onComment, onSelect } = useContext(SidebarCtx)
  const isActive = selectedId === d.id
  const showDot = d.testStatus && (node.isLeaf || !node.isOpen)

  const onClick = (e: React.MouseEvent) => {
    if ((e.altKey || e.metaKey || e.ctrlKey) && d.target) {
      e.preventDefault()
      e.stopPropagation()
      onComment(d.target, d.label ?? d.name, e.clientX, e.clientY)
      return
    }
    if (d.sel) onSelect(d.sel)
    if (!node.isLeaf) node.toggle()
  }

  const guides = []
  for (let i = 1; i < node.level; i++) {
    guides.push(<span key={i} className="indent-guide" style={{ left: i * 12 + 3 }} />)
  }

  return (
    <div
      className={`anode ${d.kind} ${isActive ? "active" : ""} ${d.status ? `diff-${d.status}` : ""}`}
      style={style}
      onClick={onClick}
    >
      {guides}
      {showDot ? (
        <span className={`test-dot ${d.testStatus}${testsRunning ? " stale" : ""}`}>●</span>
      ) : (
        <span className="glyph-slot" />
      )}
      {<span className="glyph">{GLYPH[d.kind]}</span>}
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
  if (k === "section") return 18
  if (k === "fn" || k === "cls" || k === "story" || k === "captured") return 16
  return 18
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
  files,
  selection,
  onSelect,
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
    () => buildData(files, diff, comments, failingTests),
    [files, diff, comments, failingTests]
  )

  const selectedId = selection.symbol
    ? `sym:${selection.file}:${selection.symbol}`
    : selection.view === "story"
      ? `story:${selection.storyId}`
      : selection.view === "captured"
        ? (() => {
            const fe = files.find((f) => f.file === selection.file)
            return fe?.component ? `cap:${fe.component.name}:${selection.exportName}` : null
          })()
        : `file:${selection.file}`

  const ctx = useMemo<Ctx>(
    () => ({ selectedId, testsRunning, onComment, onSelect }),
    [selectedId, testsRunning, onComment, onSelect]
  )

  const [ref, size] = useSize()

  return (
    <SidebarCtx.Provider value={ctx}>
      <div className="sidebar-search">
        <input
          className="sidebar-search-input"
          placeholder="Filter files & symbols…"
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
          key={files.length}
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
