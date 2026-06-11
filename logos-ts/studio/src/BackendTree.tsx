import { useState } from "react"
import type { BackendFile, BackendItem, BackendSel, CommentApi, DiffStatus } from "./types"

interface Props {
  backend: BackendFile[]
  active: boolean
  selection: BackendSel | null
  onSelect: (sel: BackendSel) => void
  comments: CommentApi["comments"]
  onComment: CommentApi["onComment"]
  diff: Record<string, DiffStatus>
}

interface Dir {
  dirs: Map<string, Dir>
  files: BackendFile[]
}

function buildTree(backend: BackendFile[]): Dir {
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
  return root
}

export function BackendTree({ backend, active, selection, onSelect, comments, onComment, diff }: Props) {
  // default: everything expanded; track what the user collapses
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  const isOpen = (key: string) => !collapsed.has(key)

  const Symbol = ({ it, depth }: { it: BackendItem; depth: number }) => {
    const isClass = it.kind === "class"
    const target = `${isClass ? "cls" : "fn"}:${it.name}`
    const sel = active && selection?.symbol === it.name
    const total =
      isClass ? it.tests.length + it.methods.reduce((n, m) => n + m.tests.length, 0) : it.tests.length
    let status = diff[target]
    if (!status && isClass && it.methods.some((m) => diff[`method:${it.name}.${m.name}`])) status = "changed"
    const cCount = comments[target]?.length ?? 0
    return (
      <div
        className={`node ${isClass ? "cls" : "fn"} ${sel ? "active" : ""} ${status ? `diff-${status}` : ""}`}
        style={{ paddingLeft: depth * 12 + 12 }}
        onClick={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) {
            e.preventDefault()
            onComment(target, `${isClass ? "⬚" : "ƒ"} ${it.name}`, e.clientX, e.clientY)
          } else onSelect({ symbol: it.name })
        }}
      >
        <span className="glyph">{isClass ? "⬚" : "ƒ"}</span>
        <span className="label">{it.name}</span>
        {cCount > 0 && <span className="cbadge">💬{cCount}</span>}
        {total > 0 && <span className="count ok">✓{total}</span>}
      </div>
    )
  }

  const FileNode = ({ file, depth }: { file: BackendFile; depth: number }) => {
    const key = `file:${file.file}`
    const open = isOpen(key)
    const name = file.file.split("/").pop() ?? file.file
    const cCount = comments[key]?.length ?? 0
    return (
      <div>
        <div
          className="node file"
          style={{ paddingLeft: depth * 12 + 12 }}
          onClick={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) {
              e.preventDefault()
              onComment(key, `📄 ${name}`, e.clientX, e.clientY)
            } else toggle(key)
          }}
        >
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="glyph">📄</span>
          <span className="label">{name}</span>
          {cCount > 0 && <span className="cbadge">💬{cCount}</span>}
        </div>
        {open &&
          file.items
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((it) => <Symbol key={it.name} it={it} depth={depth + 1} />)}
      </div>
    )
  }

  const DirNode = ({ dir, name, path, depth }: { dir: Dir; name: string; path: string; depth: number }) => {
    const key = `dir:${path}`
    const target = `dir:backend/${path}`
    const open = isOpen(key)
    const cCount = comments[target]?.length ?? 0
    return (
      <div>
        <div
          className="node dir"
          style={{ paddingLeft: depth * 12 + 12 }}
          onClick={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) {
              e.preventDefault()
              onComment(target, `📁 ${name}/`, e.clientX, e.clientY)
            } else toggle(key)
          }}
        >
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="glyph">📁</span>
          <span className="label">{name}/</span>
          {cCount > 0 && <span className="cbadge">💬{cCount}</span>}
        </div>
        {open && <DirBody dir={dir} path={path} depth={depth + 1} />}
      </div>
    )
  }

  const DirBody = ({ dir, path, depth }: { dir: Dir; path: string; depth: number }) => (
    <>
      {[...dir.dirs.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, d]) => (
          <DirNode key={n} dir={d} name={n} path={`${path}/${n}`} depth={depth} />
        ))}
      {dir.files
        .slice()
        .sort((a, b) => a.file.localeCompare(b.file))
        .map((f) => (
          <FileNode key={f.file} file={f} depth={depth} />
        ))}
    </>
  )

  const tree = buildTree(backend)
  return (
    <nav className="tree">
      <div className="tree-title">BACKEND</div>
      <DirBody dir={tree} path="" depth={0} />
    </nav>
  )
}
