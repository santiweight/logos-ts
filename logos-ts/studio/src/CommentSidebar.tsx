/* eslint-disable no-restricted-syntax */
import type { Goal, GoalReply, Selection } from "./types"

const statusOrder: Record<string, number> = { running: 0, pending: 1, done: 2, error: 3 }

function statusIcon(status: string): string {
  switch (status) {
    case "running": return "⟳"
    case "pending": return "○"
    case "done": return "✓"
    case "error": return "✗"
    default: return "●"
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "running": return "cs-running"
    case "pending": return "cs-pending"
    case "done": return "cs-done"
    case "error": return "cs-error"
    default: return ""
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function Reply({ r }: { r: GoalReply }) {
  return (
    <div className={`cs-reply cs-reply-${r.author}`}>
      <span className="cs-reply-author">{r.author}</span>
      <span className="cs-reply-time">{formatTime(r.createdAt)}</span>
      <div className="cs-reply-text">{r.text}</div>
    </div>
  )
}

function ThreadCard({
  goal,
  running,
  onClick,
}: {
  goal: Goal
  running: boolean
  onClick: () => void
}) {
  const status = running ? "running" : goal.status
  return (
    <div className={`cs-card ${statusClass(status)}`} onClick={onClick}>
      <div className="cs-card-header">
        <span className={`cs-status-icon ${statusClass(status)}`}>
          {status === "running" ? <span className="ag-spin">{statusIcon(status)}</span> : statusIcon(status)}
        </span>
        <span className="cs-target">{goal.label}</span>
        <span className={`cs-badge ${statusClass(status)}`}>{status}</span>
      </div>
      <div className="cs-card-body">
        <div className="cs-comment-text">{goal.text}</div>
        {goal.replies?.map((r, i) => <Reply key={i} r={r} />)}
      </div>
    </div>
  )
}

function symbolTargets(symbol: string): string[] {
  return [`fn:${symbol}`, `type:${symbol}`, `cls:${symbol}`]
}

function goalMatchesSelection(g: Goal, sel: Selection, fileTargets: ReadonlySet<string>): boolean {
  if (sel.storyId != null && sel.storyId.length > 0 && g.storyId === sel.storyId) return true
  if (sel.component != null && sel.component.length > 0 && g.target === `component:${sel.component}`) return true
  if (sel.symbol != null && sel.symbol.length > 0 && symbolTargets(sel.symbol).includes(g.target)) return true
  if (g.target === `file:${sel.file}`) return true
  if (sel.storyId == null && sel.component == null && sel.symbol == null && fileTargets.has(g.target)) return true
  return false
}

export function CommentSidebar({
  goals,
  selection,
  fileTargets,
  runningGoals,
  onNavigate,
  onClose,
}: {
  goals: Goal[]
  selection: Selection
  fileTargets: ReadonlySet<string>
  runningGoals: ReadonlySet<string>
  onNavigate: (goal: Goal) => void
  onClose: () => void
}) {
  const filtered = goals.filter((g) => goalMatchesSelection(g, selection, fileTargets))

  const sorted = [...filtered].sort((a, b) => {
    const sa = runningGoals.has(a.id) ? 0 : (statusOrder[a.status] ?? 4)
    const sb = runningGoals.has(b.id) ? 0 : (statusOrder[b.status] ?? 4)
    if (sa !== sb) return sa - sb
    return b.createdAt - a.createdAt
  })

  const heading = selection.component ?? selection.file.split("/").pop() ?? "Comments"

  return (
    <aside className="comment-sidebar">
      <div className="cs-header">
        <span className="cs-title">{heading} ({filtered.length})</span>
        <button className="cs-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="cs-list">
        {sorted.length === 0 && (
          <div className="cs-empty">No comments on this file.</div>
        )}
        {sorted.map((g) => (
          <ThreadCard
            key={g.id}
            goal={g}
            running={runningGoals.has(g.id)}
            onClick={() => onNavigate(g)}
          />
        ))}
      </div>
    </aside>
  )
}
