import { useState } from "react"
import type { Comment } from "./types"

interface Props {
  x: number
  y: number
  label: string
  comments: Comment[]
  onAdd: (text: string, mode: "code" | "arch", fork: boolean) => void
  onClose: () => void
}

export function CommentPopup({ x, y, label, comments, onAdd, onClose }: Props) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"code" | "arch">("code")
  const [fork, setFork] = useState(false)
  const submit = () => {
    const t = text.trim()
    if (t) {
      onAdd(t, mode, fork)
      setText("")
    }
  }
  const left = Math.min(x, window.innerWidth - 340)
  const top = Math.min(y, window.innerHeight - 280)

  return (
    <div className="comment-overlay" onClick={onClose}>
      <div className="comment-pop" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <div className="comment-h">
          💬 <span className="comment-target">{label}</span>
        </div>
        <div className="comment-list">
          {comments.length === 0 ? (
            <div className="muted small">No comments yet.</div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="comment-item">
                {c.text}
              </div>
            ))
          )}
        </div>
        <textarea
          autoFocus
          className="comment-input"
          value={text}
          placeholder="Add a comment…  (⌘/Ctrl+Enter)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault()
              submit()
            } else if (e.key === "Escape") {
              onClose()
            }
          }}
        />
        <div className="comment-actions">
          <span className="mode-switch" title="How the agent addresses this change">
            <button className={mode === "code" ? "on" : ""} onClick={() => setMode("code")}>
              code
            </button>
            <button className={mode === "arch" ? "on" : ""} onClick={() => setMode("arch")}>
              arch
            </button>
          </span>
          <button
            className={`fork-toggle ${fork ? "on" : ""}`}
            title="Fork a new workspace for this change instead of applying to the current one"
            onClick={() => setFork((f) => !f)}
          >
            ⑂ fork
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={submit}>
            Comment
          </button>
        </div>
      </div>
    </div>
  )
}
