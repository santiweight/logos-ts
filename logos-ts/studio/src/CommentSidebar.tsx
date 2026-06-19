import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { Goal, GoalLifecycle, GoalReply } from "./types"

function statusIcon(status: string): string {
  switch (status) {
    case "running": return "⟳"
    case "pending": return "○"
    case "done": return "✓"
    case "error": return "✗"
    case "ready_to_merge": return "⇄"
    case "merged": return "✓"
    default: return "●"
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "running": return "cs-running"
    case "pending": return "cs-pending"
    case "done": return "cs-done"
    case "error": return "cs-error"
    case "ready_to_merge": return "cs-ready"
    case "merged": return "cs-done"
    default: return ""
  }
}

function lifecycleFromStatus(status: Goal["status"] | "idle"): GoalLifecycle | null {
  switch (status) {
    case "pending": return { stage: "initializing", state: "creating_goal" }
    case "running": return { stage: "impl", state: "agent_running" }
    case "done": return { stage: "merged", state: "complete" }
    case "error": return { stage: "impl", state: "impl_failed" }
    default: return null
  }
}

function lifecycleLabel(lifecycle: GoalLifecycle | null): string {
  if (!lifecycle) return "Idle"
  if (lifecycle.stage === "impl" && lifecycle.state === "ready_to_merge") return "Ready to merge"
  return lifecycle.stage
}

function lifecycleDetail(lifecycle: GoalLifecycle | null): string {
  return lifecycle?.state.replace(/_/g, " ") ?? ""
}

function displayStatus(goal: Goal | null, running: boolean): string {
  if (!goal) return "idle"
  if (goal.lifecycle?.stage === "impl" && goal.lifecycle.state === "ready_to_merge") return "ready_to_merge"
  if (goal.lifecycle?.stage === "merged") return "merged"
  return running ? "running" : goal.status
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
  onToggleAutoMerge,
  onMerge,
  onResizeStart,
}: {
  goal: Goal | null
  running: boolean
  onNavigate: (goal: Goal) => void
  onReply: (goalId: string, text: string) => void
  onToggleAutoMerge: (goalId: string, autoMerge: boolean) => void
  onMerge: (goalId: string) => void
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const [reply, setReply] = useState("")
  const status = displayStatus(goal, running)
  const lifecycle = goal?.lifecycle ?? lifecycleFromStatus(goal?.status ?? "idle")
  const autoMerge = goal?.mergePolicy?.autoMerge ?? true
  const canMerge = goal != null
    && !running
    && goal.lifecycle?.stage === "impl"
    && goal.lifecycle.state === "ready_to_merge"
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
            <div className="cs-lifecycle">
              <span>{lifecycleLabel(lifecycle)}</span>
              {lifecycleDetail(lifecycle) && <span>{lifecycleDetail(lifecycle)}</span>}
            </div>
            <div className="cs-actions">
              <button
                className={`cs-auto-merge ${autoMerge ? "active" : ""}`}
                type="button"
                aria-pressed={autoMerge}
                title="Auto merge into the parent workspace"
                onClick={() => onToggleAutoMerge(goal.id, !autoMerge)}
              >
                Auto merge
              </button>
              {canMerge && (
                <button
                  className="cs-merge"
                  type="button"
                  onClick={() => onMerge(goal.id)}
                >
                  Merge
                </button>
              )}
              <button className="cs-target-link" type="button" onClick={() => onNavigate(goal)}>
                Show target
              </button>
            </div>
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
