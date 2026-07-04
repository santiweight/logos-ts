/* eslint-disable no-restricted-syntax, @typescript-eslint/no-unnecessary-type-assertion */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ICONS } from "./icons"
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist"
import type {
  ComponentEntry,
  Goal,
  DiffStatus,
  FileEntry,
  FileItem,
  RunState,
  RunTarget,
  Selection,
  TestState,
  View,
} from "./types"

type Kind = "dir" | "file" | "fn" | "cls" | "type" | "comp" | "story" | "code" | "section" | "run"

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
  runStatus?: RunState["status"] | "stopped"
  runStale?: boolean
  runTargetId?: string
  sel?: Selection
}

interface Props {
  files: FileEntry[]
  selection: Selection
  onSelect: (sel: Selection) => void
  comments: Record<string, Goal[] | undefined>
  onComment: (target: string, label: string, x: number, y: number) => void
  onWriteStories?: (target: string, label: string) => void
  onDelete?: (path: string) => void
  diff: Record<string, DiffStatus>
  testState: TestState | null
  runTargets?: RunTarget[]
  runStates?: Record<string, RunState | undefined>
  onRun?: (targetId: string, restart?: boolean) => void
  onStop?: (targetId: string) => void
  showFunctions?: boolean
  showClasses?: boolean
  showComponents?: boolean
  showTypes?: boolean
}

interface ContextMenu {
  kind: Kind
  target: string
  label: string
  file?: string
  x: number
  y: number
}

interface Ctx {
  selectedId: string | null
  testsRunning: boolean
  onComment: Props["onComment"]
  onNodeContextMenu: (menu: ContextMenu) => void
  onSelect: Props["onSelect"]
  onRun: NonNullable<Props["onRun"]>
  onStop: NonNullable<Props["onStop"]>
}
const SidebarCtx = createContext<Ctx>({
  selectedId: null,
  testsRunning: false,
  onComment: () => {},
  onNodeContextMenu: () => {},
  onSelect: () => {},
  onRun: () => {},
  onStop: () => {},
})

const testsOf = (it: FileItem): number =>
  it.kind === "class"
    ? it.tests.length + it.methods.reduce((n, m) => n + m.tests.length, 0)
    : it.kind === "type" ? 0
    : it.tests.length

const componentsOf = (file: FileEntry): ComponentEntry[] =>
  file.components?.length ? file.components : file.component ? [file.component] : []

function rollUpTestStatus(children: SNode[] | undefined): "pass" | "fail" | undefined {
  if (!children) return undefined
  let hasTested = false
  for (const c of children) {
    if (c.testStatus === "fail") return "fail"
    if (c.testStatus === "pass") hasTested = true
  }
  return hasTested ? "pass" : undefined
}

function combineDiffStatus(
  current: DiffStatus | undefined,
  next: DiffStatus | undefined
): DiffStatus | undefined {
  if (!current) return next
  if (!next || current === next) return current
  return "changed"
}

function rollUpDiffStatus(children: SNode[] | undefined): DiffStatus | undefined {
  if (!children) return undefined
  let status: DiffStatus | undefined
  for (const child of children) status = combineDiffStatus(status, child.status)
  return status
}

export function buildData(
  files: FileEntry[],
  diff: Record<string, DiffStatus>,
  comments: Props["comments"],
  failingTests: Set<string> | null,
  runTargetsOrShowFunctions: RunTarget[] | boolean,
  runStatesOrShowClasses: Record<string, RunState | undefined> | boolean,
  showFunctionsOrShowComponents: boolean,
  showClasses = true,
  showComponents = true,
  showTypes = true
): { data: SNode[]; openIds: Record<string, boolean> } {
  const runTargets = Array.isArray(runTargetsOrShowFunctions) ? runTargetsOrShowFunctions : []
  const runStates = Array.isArray(runTargetsOrShowFunctions)
    ? runStatesOrShowClasses as Record<string, RunState | undefined>
    : {}
  const showFunctions = Array.isArray(runTargetsOrShowFunctions)
    ? showFunctionsOrShowComponents
    : runTargetsOrShowFunctions
  const resolvedShowClasses = Array.isArray(runTargetsOrShowFunctions)
    ? showClasses
    : runStatesOrShowClasses as boolean
  const resolvedShowComponents = Array.isArray(runTargetsOrShowFunctions)
    ? showComponents
    : showFunctionsOrShowComponents
  const openIds: Record<string, boolean> = {}
  const allGoals = Object.values(comments).flat().filter(Boolean) as Goal[]
  const storyComments = new Map<string, number>()
  for (const g of allGoals) {
    if (g.storyId) storyComments.set(g.storyId, (storyComments.get(g.storyId) ?? 0) + 1)
  }
  const cCount = (target: string) => comments[target]?.length ?? 0
  const storyCount = (storyId: string) => storyComments.get(storyId) ?? 0

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
    if (it.kind === "type") return undefined
    const allTests =
      it.kind === "class"
        ? [...it.tests, ...it.methods.flatMap((m) => m.tests)]
        : it.tests
    if (allTests.length === 0) return undefined
    return allTests.some(isTestFailing) ? "fail" : "pass"
  }

  const symNode = (it: FileItem, file: string): SNode => {
    const isClass = it.kind === "class"
    const isType = it.kind === "type"
    const target = `${isClass ? "cls" : isType ? "type" : "fn"}:${it.name}`
    let status = diff[target]
    if (!status && isClass && it.methods.some((m) => diff[`method:${it.name}.${m.name}`]))
      status = "changed"
    const testStatus = symTestStatus(it)
    return {
      id: `sym:${file}:${it.name}`,
      name: it.name,
      kind: isClass ? "cls" : isType ? "type" : "fn",
      target,
      label: it.name,
      ...(status ? { status } : {}),
      tests: testsOf(it),
      ...(testStatus ? { testStatus } : {}),
      comments: cCount(target),
      sel: { file, symbol: it.name, view: "code" },
    }
  }

  const stripExt = (n: string) => n.replace(/\.(tsx?|jsx?)$/, "")
  const itemVisible = (it: FileItem): boolean =>
    it.kind === "class" ? resolvedShowClasses : it.kind === "type" ? showTypes : showFunctions

  const fileNode = (f: FileEntry): SNode | null => {
    const rawName = f.file.split("/").pop() ?? f.file
    const baseName = stripExt(rawName)
    const target = `file:${f.file}`

    const allComponents = componentsOf(f)
    if (allComponents.length > 0) {
      const components = resolvedShowComponents ? allComponents : []
      const componentNames = new Set(allComponents.map((component) => component.name))
      const componentNode = (comp: ComponentEntry): SNode => {
      const compTarget = `component:${comp.name}`
      const componentStatus = diff[compTarget] ?? (comp.propsName ? diff[`props:${comp.propsName}`] : undefined)
      const storyNodes: SNode[] = comp.stories.map((s) => {
        const sc = storyCount(s.id)
        return {
          id: `story:${s.id}`,
          name: s.exportName,
          kind: "story" as Kind,
          ...(sc ? { comments: sc } : {}),
          sel: { file: f.file, component: comp.name, view: "story" as View, storyId: s.id },
        }
      })
      const children = storyNodes
      const totalComments = rollUpComments(storyNodes)
      const defaultSel = comp.stories.length > 0
        ? { file: f.file, component: comp.name, view: "story" as View, storyId: comp.stories[0]!.id }
        : { file: f.file, component: comp.name, view: "code" as View }
      return {
        id: `comp:${f.file}:${comp.name}`,
        name: comp.name,
        kind: "comp",
        target: compTarget,
        label: comp.name,
        ...(componentStatus ? { status: componentStatus } : {}),
        stories: comp.stories.length,
        comments: totalComments,
        sel: defaultSel,
        children,
      }
      }

      const otherItems = f.items.filter((it) => !componentNames.has(it.name) && itemVisible(it))
      const canInline = components.length === 1 && otherItems.length === 0

      if (canInline) {
        const only = componentNode(components[0]!)
        only.id = `comp:${components[0]!.name}`
        return only
      }

      const children: SNode[] = []
      for (const comp of components) children.push(componentNode(comp))
      if (children.length === 0 && otherItems.length === 0) return null
      openIds[`file:${f.file}`] = true

      const items = otherItems.slice().sort((a, b) => a.name.localeCompare(b.name))
      for (const it of items) children.push(symNode(it, f.file))

      const fileTestStatus = rollUpTestStatus(children)
      const fileStatus = combineDiffStatus(diff[target], rollUpDiffStatus(children))
      return {
        id: `file:${f.file}`,
        name: baseName,
        kind: "file",
        target,
        label: baseName,
        ...(fileStatus ? { status: fileStatus } : {}),
        comments: rollUpComments(children),
        fns: f.items.length + components.length,
        tests: f.items.reduce((n, it) => n + testsOf(it), 0),
        ...(fileTestStatus ? { testStatus: fileTestStatus } : {}),
        ...(children.length ? { children } : {}),
        sel: { file: f.file, view: "code" },
      }
    }

    const visibleItems = f.items.filter(itemVisible)
    if (visibleItems.length === 0) return null

    // No component — check if single item matches file name
    if (visibleItems.length === 1 && visibleItems[0]?.name === baseName) {
      const it = visibleItems[0]!
      const sym = symNode(it, f.file)
      const status = combineDiffStatus(sym.status, diff[target])
      if (status) sym.status = status
      sym.comments = (sym.comments ?? 0) + cCount(target)
      return sym
    }

    const children: SNode[] = []
    const items = visibleItems.slice().sort((a, b) => a.name.localeCompare(b.name))
    for (const it of items) children.push(symNode(it, f.file))

    const noCompTestStatus = rollUpTestStatus(children)
    const fileStatus = combineDiffStatus(diff[target], rollUpDiffStatus(children))
    const fileComments = rollUpComments(children)
    return {
      id: `file:${f.file}`,
      name: baseName,
      kind: "file",
      target,
      label: baseName,
      ...(fileStatus ? { status: fileStatus } : {}),
      comments: fileComments,
      fns: f.items.length,
      tests: f.items.reduce((n, it) => n + testsOf(it), 0),
      ...(noCompTestStatus ? { testStatus: noCompTestStatus } : {}),
      ...(children.length ? { children } : {}),
      sel: { file: f.file, view: "code" },
    }
  }

  function rollUpComments(children: SNode[]): number {
    let n = 0
    for (const c of children) n += (c.comments ?? 0)
    return n
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
      const d = parts[i]!
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
      if (children.length === 0) continue
      const testStatus = rollUpTestStatus(children)
      const status = rollUpDiffStatus(children)
      const dirComments = rollUpComments(children)
      out.push({
        id,
        name: n,
        kind: "dir",
        target,
        label: n,
        ...(status ? { status } : {}),
        comments: dirComments,
        ...(testStatus ? { testStatus } : {}),
        children,
      })
    }
    for (const f of dir.files.slice().sort((a, b) => a.file.localeCompare(b.file))) {
      const node = fileNode(f)
      if (node) out.push(node)
    }
    return out
  }

  const runNodes: SNode[] = runTargets.map((target) => {
    const state = runStates[target.id]
    return {
      id: `run:${target.id}`,
      name: target.label,
      kind: "run",
      runTargetId: target.id,
      runStatus: state?.status ?? "stopped",
      runStale: state?.stale ?? false,
      sel: { file: "", view: "run", runTargetId: target.id },
    }
  })

  return { data: [...runNodes, ...dirNodes(root, "")], openIds }
}

const GLYPH: Record<Kind, ReactNode> = {
  dir: ICONS.dir,
  file: ICONS.file,
  fn: ICONS.fn,
  cls: ICONS.cls,
  type: "T",
  comp: ICONS.comp,
  story: ICONS.story,
  code: ICONS.fn,
  section: "§",
  run: "▶",
}

function Node({ node, style }: NodeRendererProps<SNode>) {
  const d = node.data
  const { selectedId, testsRunning, onComment, onNodeContextMenu, onSelect, onRun, onStop } = useContext(SidebarCtx)
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
    if (d.kind === "run" && d.runTargetId && d.runStatus !== "ready" && d.runStatus !== "starting") {
      onRun(d.runTargetId)
    }
    if (!node.isLeaf) node.toggle()
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (d.kind === "run" || d.kind === "section" || !d.target) return
    e.preventDefault()
    e.stopPropagation()
    if (d.sel) onSelect(d.sel)
    onNodeContextMenu({ kind: d.kind, target: d.target, label: d.label ?? d.name, ...(d.sel?.file ? { file: d.sel.file } : {}), x: e.clientX, y: e.clientY })
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
      onContextMenu={onContextMenu}
      title={d.kind !== "run" && d.kind !== "section" && d.target ? "Right-click for actions" : undefined}
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
      </span>
      {d.kind === "file" && d.fns ? <span className="fns">{d.fns}</span> : null}
      {d.kind === "comp" && d.stories ? <span className="count">{d.stories}</span> : null}
      {d.comments && (node.isLeaf || !node.isOpen) ? (
        <span className="cbadge" title={`${d.comments} comment${d.comments === 1 ? "" : "s"}`}>
          <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
            <path d="M1 1.5C1 1.22 1.22 1 1.5 1h15c.28 0 .5.22.5.5v10c0 .28-.22.5-.5.5H5l-3.5 3V1.5Z" fill="var(--accent)" opacity="0.85" stroke="var(--accent)" strokeWidth="1"/>
          </svg>
          <span className="cbadge-count">{d.comments}</span>
        </span>
      ) : null}
      {!showDot && d.tests ? <span className="count ok">✓{d.tests}</span> : null}
      {d.kind === "run" && d.runStale ? (
        <span className="stale-badge" title="Source changed since last build">⚠</span>
      ) : null}
      {d.kind === "run" && d.runTargetId && (d.runStatus === "ready" || d.runStatus === "starting") ? (
        <button
          className="run-tree-btn stop"
          title="Stop"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onStop(d.runTargetId!)
          }}
        >
          ⏹
        </button>
      ) : null}
      {d.kind === "run" && d.runTargetId ? (
        <button
          className={`run-tree-btn ${d.runStatus ?? "stopped"}`}
          title={d.runStatus === "ready" ? "Restart" : "Play"}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRun(d.runTargetId!, d.runStatus === "ready")
          }}
        >
          {d.runStatus === "starting" ? "⟳" : d.runStatus === "ready" ? "↻" : "▶"}
        </button>
      ) : null}
    </div>
  )
}

const rowHeight = (node: NodeApi<SNode>) => {
  const k = node.data.kind
  if (k === "section") return 22
  if (k === "fn" || k === "cls" || k === "story" || k === "code") return 20
  return 22
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
  onWriteStories,
  onDelete,
  diff,
  testState,
  runTargets = [],
  runStates = {},
  onRun = () => {},
  onStop = () => {},
  showFunctions = true,
  showClasses = true,
  showComponents = true,
  showTypes = true,
}: Props) {
  const [nodeMenu, setNodeMenu] = useState<ContextMenu | null>(null)
  const canWriteStories = onWriteStories != null
  const results = testState?.results ?? null
  const testsRunning = testState?.status === "running"
  const failingTests = useMemo(() => {
    if (!results || results.total === 0) return null
    const set = new Set<string>()
    for (const f of results.failures) set.add(`${f.file}:${f.test}`)
    return set
  }, [results])
  const { data, openIds } = useMemo(
    () => buildData(files, diff, comments, failingTests, runTargets, runStates, showFunctions, showClasses, showComponents, showTypes),
    [files, diff, comments, failingTests, runTargets, runStates, showFunctions, showClasses, showComponents, showTypes]
  )

  const selectedId = selection.view === "run" && selection.runTargetId
    ? `run:${selection.runTargetId}`
    : selection.symbol
    ? `sym:${selection.file}:${selection.symbol}`
    : selection.view === "story"
      ? `story:${selection.storyId}`
      : (() => {
          const fe = files.find((f) => f.file === selection.file)
          if (fe && selection.component) return `comp:${fe.file}:${selection.component}`
          if (fe && componentsOf(fe).length === 1) {
            const component = componentsOf(fe)[0]!
            const others = fe.items.filter((it) => it.name !== component.name)
            if (others.length === 0) {
              return `comp:${component.name}`
            }
          }
          if (fe && componentsOf(fe).length === 0 && fe.items.length === 1) {
            const baseName = (fe.file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "")
            if (fe.items[0]?.name === baseName)
              return `sym:${fe.file}:${fe.items[0]!.name}`
          }
          return `file:${selection.file}`
        })()

  const ctx = useMemo<Ctx>(
    () => ({
      selectedId,
      testsRunning,
      onComment,
      onNodeContextMenu: (menu) => setNodeMenu(menu),
      onSelect,
      onRun,
      onStop,
    }),
    [selectedId, testsRunning, onComment, onSelect, onRun, onStop]
  )

  const [ref, size] = useSize()
  useEffect(() => {
    if (!nodeMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNodeMenu(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [nodeMenu])

  return (
    <SidebarCtx.Provider value={ctx}>
      <div className="sidebar-tree" ref={ref} onClick={() => setNodeMenu(null)}>
        <Tree<SNode>
          key={`${showFunctions ? "fn" : ""}:${showClasses ? "cls" : ""}:${showComponents ? "comp" : ""}:${showTypes ? "type" : ""}:${runTargets.map(t => `${t.id}:${runStates[t.id]?.status ?? "stopped"}`).join("\0")}:${files.map(f => f.file).join("\0")}`}
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
        >
          {Node}
        </Tree>
        {nodeMenu && (
          <div
            className="sidebar-context-menu"
            style={{
              left: Math.min(nodeMenu.x, window.innerWidth - 180),
              top: Math.min(nodeMenu.y, window.innerHeight - 80),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {nodeMenu.kind === "comp" && canWriteStories && (
              <button
                type="button"
                onClick={() => {
                  onWriteStories?.(nodeMenu.target, nodeMenu.label)
                  setNodeMenu(null)
                }}
              >
                Generate stories
              </button>
            )}
            {onDelete && (nodeMenu.kind === "dir" || nodeMenu.kind === "file" || nodeMenu.file) && (
              <button
                type="button"
                className="destructive"
                onClick={() => {
                  const path = nodeMenu.kind === "dir" || nodeMenu.kind === "file"
                    ? nodeMenu.target.replace(/^(dir|file):/, "")
                    : nodeMenu.file!
                  if (confirm(`Delete "${nodeMenu.label}"?`)) onDelete(path)
                  setNodeMenu(null)
                }}
              >
                Delete {nodeMenu.kind === "dir" ? "folder" : nodeMenu.kind === "file" ? "file" : "file"}
              </button>
            )}
          </div>
        )}
      </div>
    </SidebarCtx.Provider>
  )
}
