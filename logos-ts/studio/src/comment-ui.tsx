import React, { useState } from "react"

export interface CommentItem {
  id: string
  text: string
  author?: string
  createdAt: number
  agentId?: string | null
  agentStatus?: string | null
  mode?: string
}

export interface SubmitPayload {
  text: string
  mode: "code" | "arch"
  fork: boolean
}

// --- Thread: shows existing comments + reply box with mode/fork controls ------

export function CommentThread({
  label,
  comments,
  onAdd,
  onRemove,
  onClose,
}: {
  label: string
  comments: CommentItem[]
  onAdd: (payload: SubmitPayload) => void
  onRemove?: (id: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"code" | "arch">("code")
  const [fork, setFork] = useState(false)
  const submit = () => {
    const t = text.trim()
    if (!t) return
    onAdd({ text: t, mode, fork })
    setText("")
  }

  return (
    <>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <button type="button" onClick={onClose} style={closeBtnStyle} title="Close">
          ×
        </button>
      </div>
      {comments.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: "auto" }}>
          {comments.map((c) => (
            <div key={c.id} style={messageStyle}>
              <div style={messageMetaStyle}>
                <span style={{ fontWeight: 600, color: "var(--fg, var(--text))" }}>
                  {c.author ?? "you"}
                </span>
                <span>{formatTime(c.createdAt)}</span>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(c.id)}
                    style={deleteBtnStyle}
                    title="Delete"
                  >
                    delete
                  </button>
                )}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
              {c.agentId && (
                <div style={agentBadgeStyle} title="Agent assigned to this comment">
                  <span style={{ fontFamily: "monospace" }}>{c.agentId}</span>
                  <span style={agentStatusBadge(c.agentStatus)}>
                    {c.agentStatus ?? "pending"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
          if (e.key === "Escape") onClose()
        }}
        placeholder="Reply…"
        style={textareaStyle}
      />
      <ModeBar mode={mode} setMode={setMode} fork={fork} setFork={setFork} onSubmit={submit} disabled={!text.trim()} />
    </>
  )
}

// --- Composer: new-comment box with mode/fork controls ------------------------

export function CommentComposer({
  label,
  onSave,
  onCancel,
}: {
  label: string
  onSave: (payload: SubmitPayload) => void
  onCancel: () => void
}) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<"code" | "arch">("code")
  const [fork, setFork] = useState(false)
  const submit = () => {
    const t = text.trim()
    if (t) onSave({ text: t, mode, fork })
  }

  return (
    <>
      <div style={headerStyle}>
        <span style={{ color: "var(--muted)" }}>
          New comment on{" "}
          <span style={{ color: "var(--fg, var(--text))", fontWeight: 600 }}>{label}</span>
        </span>
        <button type="button" onClick={onCancel} style={closeBtnStyle} title="Cancel">
          ×
        </button>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
          if (e.key === "Escape") onCancel()
        }}
        placeholder="Add a comment…"
        style={textareaStyle}
      />
      <ModeBar mode={mode} setMode={setMode} fork={fork} setFork={setFork} onSubmit={submit} disabled={!text.trim()} />
    </>
  )
}

// --- Mode bar: code/arch pills + fork toggle + submit button -----------------

function ModeBar({
  mode,
  setMode,
  fork,
  setFork,
  onSubmit,
  disabled,
}: {
  mode: "code" | "arch"
  setMode: (m: "code" | "arch") => void
  fork: boolean
  setFork: (f: boolean) => void
  onSubmit: () => void
  disabled: boolean
}) {
  return (
    <div style={actionsStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          style={pillBtn(mode === "code")}
          onClick={() => setMode("code")}
          title="Agent edits code directly"
        >
          code
        </button>
        <button
          type="button"
          style={pillBtn(mode === "arch")}
          onClick={() => setMode("arch")}
          title="Agent restructures architecture (signatures only)"
        >
          arch
        </button>
        <button
          type="button"
          style={{ ...pillBtn(fork), marginLeft: 6 }}
          onClick={() => setFork(!fork)}
          title="Fork a new workspace for this change"
        >
          ⑂ fork
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>⌘/Ctrl+Enter</span>
        <button type="button" onClick={onSubmit} style={primaryBtnStyle} disabled={disabled}>
          Comment
        </button>
      </div>
    </div>
  )
}

// --- Popover shell: wraps Thread or Composer with consistent styling ----------

export const popoverShell: React.CSSProperties = {
  width: 280,
  background: "var(--bg, var(--panel))",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.35)",
  overflow: "hidden",
  font: "13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: "var(--fg, var(--text))",
}

// --- Styles -------------------------------------------------------------------

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--border, var(--border-faint))",
  fontSize: 12,
}

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  color: "var(--muted)",
  padding: 0,
}

const messageStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border, var(--border-faint))",
}

const messageMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  color: "var(--muted)",
  marginBottom: 3,
}

const deleteBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--error, #f87171)",
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
}

const agentBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 6,
  fontSize: 10,
  color: "var(--muted)",
}

function agentStatusBadge(status?: string | null): React.CSSProperties {
  const color =
    status === "done"
      ? "var(--success, #4ade80)"
      : status === "error"
        ? "var(--error, #f87171)"
        : "var(--muted)"
  return {
    border: `1px solid ${color}`,
    color,
    borderRadius: 3,
    padding: "0 5px",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  }
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  borderTop: "1px solid var(--border, var(--border-faint))",
  padding: "8px 10px",
  resize: "vertical",
  minHeight: 52,
  font: "inherit",
  color: "var(--fg, var(--text))",
  background: "var(--bg, var(--panel))",
  boxSizing: "border-box",
  outline: "none",
}

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderTop: "1px solid var(--border, var(--border-faint))",
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    font: "inherit",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    border: `1px solid ${active ? "var(--accent, #3b82f6)" : "var(--border)"}`,
    background: active ? "var(--accent, #3b82f6)" : "transparent",
    color: active ? "var(--fg-on-accent, #06121f)" : "var(--fg, var(--text))",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
  }
}

const primaryBtnStyle: React.CSSProperties = {
  background: "var(--fg, var(--text))",
  color: "var(--bg, var(--panel))",
  border: "none",
  borderRadius: 4,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
