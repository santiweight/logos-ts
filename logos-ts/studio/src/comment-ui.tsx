/* eslint-disable @typescript-eslint/no-confusing-void-expression, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/restrict-template-expressions, no-restricted-syntax */
import React, { useState } from "react"
import { iconForLabel } from "./icons"

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

const FONT = "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace"

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
      <Header label={label} onClose={onClose} />
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
                  <span>{c.agentId}</span>
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
      <Header label={label} onClose={onCancel} />
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

// --- Header: icon + label + close button -------------------------------------

function Header({ label, onClose }: { label: string; onClose: () => void }) {
  const icon = iconForLabel(label)
  return (
    <div style={headerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: "var(--muted)", display: "flex" }}>{icon}</span>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <button type="button" onClick={onClose} style={closeBtnStyle} title="Close">
        ×
      </button>
    </div>
  )
}

// --- Mode bar: segmented code/arch toggle + fork + submit --------------------

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
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={segmentedTrack} onClick={() => setMode(mode === "code" ? "arch" : "code")}>
          <span style={segmentBtn(mode === "code")}>code</span>
          <span style={segmentBtn(mode === "arch")}>arch</span>
        </div>
        <button
          type="button"
          style={forkBtn(fork)}
          onClick={() => setFork(!fork)}
          title="Fork a new workspace for this change"
        >
          ⑂
        </button>
      </div>
      <button type="button" onClick={onSubmit} style={primaryBtnStyle} disabled={disabled}>
        Comment
      </button>
    </div>
  )
}

// --- Popover shell: wraps Thread or Composer with consistent styling ----------

const lightVars = {
  "--bg": "#fff",
  "--panel": "#fff",
  "--fg": "#1a1a1a",
  "--text": "#1a1a1a",
  "--muted": "#888",
  "--border": "#e5e5e5",
  "--border-faint": "#f0f0f0",
  "--accent": "#2563eb",
  "--fg-on-accent": "#fff",
  "--error": "#dc2626",
  "--success": "#16a34a",
} as Record<string, string>

export const popoverShell: React.CSSProperties = {
  width: 300,
  ...lightVars,
  background: "#fff",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
  overflow: "hidden",
  font: FONT,
  color: "#1a1a1a",
}

// --- Styles -------------------------------------------------------------------

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, var(--border-faint))",
  fontSize: 12,
}

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
  color: "var(--muted)",
  padding: "2px 4px",
  borderRadius: 4,
  flexShrink: 0,
}

const messageStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border, var(--border-faint))",
}

const messageMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  color: "var(--muted)",
  marginBottom: 4,
}

const deleteBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--error, #dc2626)",
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
      ? "var(--success, #16a34a)"
      : status === "error"
        ? "var(--error, #dc2626)"
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
  padding: "10px 12px",
  resize: "vertical",
  minHeight: 56,
  font: FONT,
  color: "var(--fg, var(--text))",
  background: "transparent",
  boxSizing: "border-box",
  outline: "none",
}

const actionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  borderTop: "1px solid var(--border, var(--border-faint))",
}

const segmentedTrack: React.CSSProperties = {
  display: "flex",
  background: "var(--border, #e0e0e0)",
  borderRadius: 6,
  padding: 2,
  gap: 1,
  cursor: "pointer",
  userSelect: "none",
}

function segmentBtn(active: boolean): React.CSSProperties {
  return {
    font: "inherit",
    fontSize: 11,
    padding: "3px 10px",
    borderRadius: 4,
    border: "none",
    background: active ? "var(--bg, #fff)" : "transparent",
    color: active ? "var(--fg, var(--text))" : "var(--muted)",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
    transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
  }
}

function forkBtn(active: boolean): React.CSSProperties {
  return {
    font: "inherit",
    fontSize: 13,
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    border: `1px solid ${active ? "var(--accent, #3b82f6)" : "var(--border)"}`,
    background: active ? "var(--accent, #3b82f6)" : "transparent",
    color: active ? "var(--fg-on-accent, #fff)" : "var(--muted)",
    cursor: "pointer",
    padding: 0,
  }
}

const primaryBtnStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  background: "var(--fg, var(--text))",
  color: "var(--bg, var(--panel))",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
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

// === Shared overlay chrome (used by both studio and Storybook) ===============

export const C = {
  fg: "#1a1a1a",
  bg: "#fff",
  accent: "#2563eb",
  border: "#e5e5e5",
  muted: "#888",
  highlight: "rgba(37, 99, 235, 0.12)",
}

export const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2147483000,
  font: FONT,
}

// --- Pin: the numbered marker at the corner of a commented element -----------

const pinStyle: React.CSSProperties = {
  position: "absolute",
  width: 22,
  height: 22,
  borderRadius: "11px 11px 11px 2px",
  border: "none",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
}

export function Pin({
  rect,
  count,
  active,
  onClick,
}: {
  rect: DOMRect
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...pinStyle,
        left: rect.right - 9,
        top: rect.top - 9,
        background: active ? C.fg : C.accent,
        color: C.bg,
        outline: active ? `2px solid ${C.accent}` : "none",
      }}
      title={`${count} comment${count === 1 ? "" : "s"}`}
    >
      {count}
    </button>
  )
}

// --- Highlight: the blue overlay shown when alt-hovering an element ----------

export function Highlight({ rect, label }: { rect: DOMRect; label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        border: `2px solid ${C.accent}`,
        background: C.highlight,
        borderRadius: 4,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: -20,
          left: -2,
          background: C.fg,
          color: C.bg,
          fontSize: 10,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          padding: "2px 6px",
          borderRadius: "4px 4px 0 0",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  )
}

// --- Toolbar: bottom-right toggle + hint shown in the overlay ----------------

function toolbarBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#27272b",
    color: enabled ? "#d4d4d8" : "#85858f",
    border: "1px solid #2e2e34",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    transition: "background 120ms ease, color 120ms ease",
  }
}

const countPill: React.CSSProperties = {
  background: "#4a9eff",
  color: "#fff",
  borderRadius: 9,
  padding: "0 5px",
  fontSize: 10,
  minWidth: 14,
  textAlign: "center",
  fontWeight: 600,
}

const hintBox: React.CSSProperties = {
  background: "#27272b",
  border: "1px solid #2e2e34",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 10,
  color: "#85858f",
  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
}

const kbd: React.CSSProperties = {
  background: "#2e2e34",
  border: "1px solid #3a3a42",
  borderRadius: 3,
  padding: "1px 5px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10,
  color: "#d4d4d8",
}

export function CommentToolbar({
  enabled,
  onToggle,
  total,
  altDown,
}: {
  enabled: boolean
  onToggle: () => void
  total: number
  altDown: boolean
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        right: 14,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {enabled && (
        <span style={hintBox}>
          <kbd style={kbd}>Alt</kbd>
          {altDown ? " + click" : " + hover"}
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        style={toolbarBtnStyle(enabled)}
        title={enabled ? "Comments on — click to disable" : "Comments off"}
      >
        {total > 0 && <span style={countPill}>{total}</span>}
        {enabled ? "Comments" : "Off"}
      </button>
    </div>
  )
}

// --- popoverPos: position a popover near a target rect -----------------------

export function popoverPos(rect: DOMRect): React.CSSProperties {
  return {
    left: Math.min(rect.right + 12, window.innerWidth - 310),
    top: Math.min(Math.max(rect.top, 8), window.innerHeight - 200),
  }
}
