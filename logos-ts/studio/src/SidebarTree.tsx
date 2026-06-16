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
  showFunctions?: boolean
  showClasses?: boolean
  showComponents?: boolean
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
    ? it.tests.length + it.methods.reduce((n, m) => n + m.tests.length, 0)
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

function buildData(
  files: FileEntry[],
  diff: Record<string, DiffStatus>,
  comments: Props["comments"],
  failingTests: Set<string> | null,
  showFunctions: boolean,
  showClasses: boolean,
  showComponents: boolean
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
        ? [...it.tests, ...it.methods.flatMap((m) => m.tests)]
        : it.tests
    if (allTests.length === 0) return undefined
    return allTests.some(isTestFailing) ? "fail" : "pass"
  }

  const symNode = (it: FileItem, file: string): SNode => {
    const isClass = it.kind === "class"
    const target = `${isClass ? "cls" : "fn"}:${it.name}`
    let status = diff[target]
    if (!status && isClass && it.methods.some((m) => diff[`method:${it.name}.${m.name}`]))
      status = "changed"
    const testStatus = symTestStatus(it)
    return {
      id: `sym:${file}:${it.name}`,
      name: it.name,
      kind: isClass ? "cls" : "fn",
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
    it.kind === "class" ? showClasses : showFunctions

  const fileNode = (f: FileEntry): SNode | null => {
    const rawName = f.file.split("/").pop() ?? f.file
    const baseName = stripExt(rawName)
    const target = `file:${f.file}`

    const allComponents = componentsOf(f)
    if (allComponents.length > 0) {
      const components = showComponents ? allComponents : []
      const componentNames = new Set(allComponents.map((component) => component.name))
      const componentNode = (comp: ComponentEntry): SNode => {
      const compTarget = `component:${comp.name}`
      const componentStatus = diff[compTarget] ?? (comp.propsName ? diff[`props:${comp.propsName}`] : undefined)
      const storyNodes: SNode[] = comp.stories.map((s) => ({
        id: `story:${s.id}`,
        name: s.exportName,
        kind: "story" as Kind,
        sel: { file: f.file, component: comp.name, view: "story" as View, storyId: s.id },
      }))
      const capturedNodes: SNode[] = comp.captured.map((cap) => {
        const capStatus: "pass" | "fail" | undefined = failingFiles
          ? failingFiles.has(cap.testFile) ? "fail" : "pass"
          : undefined
        const status = diff[`capture:${cap.testFile}::${cap.exportName}`]
        return {
          id: `cap:${comp.name}:${cap.exportName}`,
          name: cap.exportName,
          kind: "captured" as Kind,
          ...(status ? { status } : {}),
          ...(capStatus ? { testStatus: capStatus } : {}),
          sel: { file: f.file, component: comp.name, view: "captured" as View, exportName: cap.exportName },
        }
      })
      const status = combineDiffStatus(componentStatus, rollUpDiffStatus(capturedNodes))
      const compNodeChildren = [...storyNodes, ...capturedNodes]
      const compTestStatus = rollUpTestStatus(capturedNodes)
      return {
        id: `comp:${f.file}:${comp.name}`,
        name: comp.name,
        kind: "comp",
        target: compTarget,
        label: comp.name,
        ...(status ? { status } : {}),
        stories: comp.stories.length,
        comments: cCount(compTarget),
        ...(compTestStatus ? { testStatus: compTestStatus } : {}),
        sel: { file: f.file, component: comp.name, view: "code" },
        ...(compNodeChildren.length ? { children: compNodeChildren } : {}),
      }
      }

      const otherItems = f.items.filter((it) => !componentNames.has(it.name) && itemVisible(it))
      const canInline = components.length === 1 && otherItems.length === 0

      if (canInline) {
        const only = componentNode(components[0]!)
        only.id = `comp:${components[0]!.name}`
        only.comments = (only.comments ?? 0) + cCount(target)
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
        comments: cCount(target),
        fns: otherItems.length + components.length,
        ...(otherItems.length ? { tests: otherItems.reduce((n, it) => n + testsOf(it), 0) } : {}),
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
    return {
      id: `file:${f.file}`,
      name: baseName,
      kind: "file",
      target,
      label: baseName,
      ...(fileStatus ? { status: fileStatus } : {}),
      comments: cCount(target),
      fns: visibleItems.length,
      tests: visibleItems.reduce((n, it) => n + testsOf(it), 0),
      ...(noCompTestStatus ? { testStatus: noCompTestStatus } : {}),
      ...(children.length ? { children } : {}),
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
      out.push({
        id,
        name: n,
        kind: "dir",
        target,
        label: n,
        ...(status ? { status } : {}),
        comments: cCount(target),
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
  if (k === "section") return 22
  if (k === "fn" || k === "cls" || k === "story" || k === "captured") return 20
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
  diff,
  testState,
  showFunctions = true,
  showClasses = true,
  showComponents = true,
}: Props) {
  const results = testState?.results ?? null
  const testsRunning = testState?.status === "running"
  const failingTests = useMemo(() => {
    if (!results || results.total === 0) return null
    const set = new Set<string>()
    for (const f of results.failures) set.add(`${f.file}:${f.test}`)
    return set
  }, [results])
  const { data, openIds } = useMemo(
    () => buildData(files, diff, comments, failingTests, showFunctions, showClasses, showComponents),
    [files, diff, comments, failingTests, showFunctions, showClasses, showComponents]
  )

  const selectedId = selection.symbol
    ? `sym:${selection.file}:${selection.symbol}`
    : selection.view === "story"
      ? `story:${selection.storyId}`
      : selection.view === "captured"
        ? (() => {
            const fe = files.find((f) => f.file === selection.file)
            if (!fe) return null
            const components = componentsOf(fe)
            const component = components.find((c) => c.name === selection.component) ?? components[0]
            return component ? `cap:${component.name}:${selection.exportName}` : null
          })()
        : (() => {
            const fe = files.find((f) => f.file === selection.file)
            if (fe && selection.component) return `comp:${fe.file}:${selection.component}`
            if (fe && componentsOf(fe).length === 1) {
              const component = componentsOf(fe)[0]!
              const others = fe.items.filter((it) => it.name !== component.name)
              if (others.length === 0) return `comp:${component.name}`
            }
            if (fe && componentsOf(fe).length === 0 && fe.items.length === 1) {
              const baseName = (fe.file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "")
              if (fe.items[0]?.name === baseName)
                return `sym:${fe.file}:${fe.items[0]!.name}`
            }
            return `file:${selection.file}`
          })()

  const ctx = useMemo<Ctx>(
    () => ({ selectedId, testsRunning, onComment, onSelect }),
    [selectedId, testsRunning, onComment, onSelect]
  )

  const [ref, size] = useSize()

  return (
    <SidebarCtx.Provider value={ctx}>
      <div className="sidebar-tree" ref={ref}>
        <Tree<SNode>
          key={`${showFunctions ? "fn" : ""}:${showClasses ? "cls" : ""}:${showComponents ? "comp" : ""}:${files.map(f => f.file).join("\0")}`}
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
      </div>
    </SidebarCtx.Provider>
  )
}
