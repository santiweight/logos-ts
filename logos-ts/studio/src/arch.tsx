import { createContext, useContext, useState } from "react"
import { CodeBlock } from "./highlight"
import type { GoalApi, DiffStatus } from "./types"

export const CommentCtx = createContext<GoalApi>({ comments: {}, onComment: () => {} })
// nodeId -> diff status (green=added, blue=changed, red=removed) for the active workspace.
export const DiffCtx = createContext<Record<string, DiffStatus>>({})

// A flat, inline expandable row shared by the backend + component views.
// Normal click expands; alt/ctrl/⌘-click opens a comment popup tagged to it.
export function Row({
  tag,
  tagClass,
  title,
  desc,
  code,
  indent,
  target,
  label,
}: {
  tag: string
  tagClass: string
  title: string
  desc?: string
  code?: string
  indent?: boolean
  target: string
  label: string
}) {
  const { comments, onComment } = useContext(CommentCtx)
  const status = useContext(DiffCtx)[target]
  const [open, setOpen] = useState(false)
  const count = comments[target]?.length ?? 0
  return (
    <div className={`row ${indent ? "indent" : ""} ${status ? `diff-${status}` : ""}`}>
      <div
        className="row-head"
        onClick={(e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) {
            e.preventDefault()
            e.stopPropagation()
            onComment(target, label, e.clientX, e.clientY)
          } else setOpen((o) => !o)
        }}
      >
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className={`tag ${tagClass}`}>{tag}</span>
        <code className="row-title">{title}</code>
        {count > 0 && <span className="cbadge">💬{count}</span>}
      </div>
      {open && (
        <div className="row-body">
          {desc && <div className="row-desc">{desc}</div>}
          {code && <CodeBlock code={code} />}
        </div>
      )}
    </div>
  )
}
