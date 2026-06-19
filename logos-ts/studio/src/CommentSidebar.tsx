import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { Goal, GoalReply } from "./types"

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

export function CommentSidebar({
  goal,
  running,
  onNavigate,
  onReply,
  onResizeStart,
}: {
  goal: Goal | null
  running: boolean
  onNavigate: (goal: Goal) => void
  onReply: (goalId: string, text: string) => void
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const [reply, setReply] = useState("")
  const status = running ? "running" : goal?.status ?? "idle"
  const canReply = goal != null
    && !running
    && goal.sessionId != null
    && goal.sessionId.length > 0
    && (goal.status === "done" || goal.status === "error")

  useEffect(() => {
    setReply("")
  }, [goal?.id])

  const submitReply = () => {
    if (!goal || !canReply) return
    const text = reply.trim()
    if (!text) return
    onReply(goal.id, text)
    setReply("")
  }

  return (
    <aside className="comment-sidebar">
      <div className="comment-resize" title="Resize thread panel" onPointerDown={onResizeStart} />
      <div className="cs-header">
        <span className="cs-title">Thread</span>
      </div>

      {goal == null ? (
        <div className="cs-empty">
          Select a goal from a workspace.
        </div>
      ) : (
        <>
          <div className="cs-thread-head">
            <div className="cs-card-header">
              <span className={`cs-status-icon ${statusClass(status)}`}>
                {status === "running" ? <span className="ag-spin">{statusIcon(status)}</span> : statusIcon(status)}
              </span>
              <span className="cs-target">{goal.label}</span>
              <span className={`cs-badge ${statusClass(status)}`}>{status}</span>
            </div>
            <button className="cs-target-link" onClick={() => onNavigate(goal)}>
              Show target
            </button>
          </div>

          <div className="cs-list">
            <div className="cs-message cs-message-user">
              <div className="cs-message-meta">
                <span>you</span>
                <span>{formatTime(goal.createdAt)}</span>
              </div>
              <div className="cs-comment-text">{goal.text}</div>
            </div>

            {goal.replies?.map((r, i) => <Reply key={i} r={r} />)}
          </div>

          <div className="cs-composer">
            <textarea
              value={reply}
              disabled={!canReply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitReply()
              }}
              placeholder={canReply ? "Continue the thread..." : "Thread can continue after an agent session finishes."}
            />
            <button type="button" disabled={!canReply || reply.trim().length === 0} onClick={submitReply}>
              Send
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
