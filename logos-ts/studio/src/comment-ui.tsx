/* eslint-disable no-restricted-syntax */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { iconForLabel } from "./icons"

export interface GoalReply {
  author: "agent" | "user"
  text: string
  createdAt: number
}

export interface CommentItem {
  id: string
  text: string
  author?: string
  createdAt: number
  agentId?: string | null
  agentStatus?: string | null
  sessionId?: string | null
  status?: string | null
  mode?: string
  replies?: GoalReply[]
}

export interface SubmitPayload {
  text: string
  mode: "code" | "arch"
}

export type DraftPayload = SubmitPayload

export interface ReplyPayload {
  goalId: string
  text: string
}

export interface DragOffset {
  x: number
  y: number
}

const FONT = "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace"
type DragHandleProps = React.HTMLAttributes<HTMLDivElement>

// --- Thread: shows existing comments + reply box with mode/fork controls ------

export function CommentThread({
  label,
  comments,
  onAdd,
  onRemove,
  onReply,
  onClose,
  workspaceKind,
  onEditingChange,
  initialDraft,
  onDraftChange,
  dragHandleProps,
}: {
  label: string
  comments: CommentItem[]
  onAdd: (payload: SubmitPayload) => void
  onRemove?: (id: string) => void
  onReply?: ((payload: ReplyPayload) => void) | undefined
  onClose: () => void
  workspaceKind?: "code" | "arch" | undefined
  onEditingChange?: (active: boolean) => void
  initialDraft?: Partial<DraftPayload> | undefined
  onDraftChange?: (payload: DraftPayload) => void
  dragHandleProps?: DragHandleProps | undefined
}) {
  const [text, setText] = useState(initialDraft?.text ?? "")
  const [mode, setMode] = useState<"code" | "arch">(initialDraft?.mode ?? "code")
  const [replyGoalId, setReplyGoalId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const onEditingChangeRef = useRef(onEditingChange)
  const onDraftChangeRef = useRef(onDraftChange)
  onEditingChangeRef.current = onEditingChange
  onDraftChangeRef.current = onDraftChange
  const editingActive = text.trim().length > 0
  useEffect(() => {
    onEditingChangeRef.current?.(editingActive)
    onDraftChangeRef.current?.({ text, mode })
  }, [editingActive, mode, text])
  useEffect(() => () => onEditingChangeRef.current?.(false), [])
  const submit = () => {
    const t = text.trim()
    if (t.length === 0) return
    onAdd({ text: t, mode })
    setText("")
  }

  const submitReply = () => {
    const t = replyText.trim()
    if (t.length === 0 || replyGoalId == null || onReply == null) return
    onReply({ goalId: replyGoalId, text: t })
    setReplyText("")
    setReplyGoalId(null)
  }

  const canReply = (c: CommentItem) =>
    onReply != null
      && (c.agentStatus === "done" || c.status === "done")
      && ((c.agentId != null && c.agentId.length > 0) || (c.sessionId != null && c.sessionId.length > 0))

  return (
    <>
      <Header label={label} onClose={onClose} dragHandleProps={dragHandleProps} />
      {comments.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {comments.map((c) => (
            <div key={c.id}>
              <div style={messageStyle}>
                <div style={messageMetaStyle}>
                  <span style={{ fontWeight: 600, color: "var(--fg, var(--text))" }}>
                    {c.author ?? "you"}
                  </span>
                  <span>{formatTime(c.createdAt)}</span>
                  {onRemove != null && (
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
                {c.agentId != null && c.agentId.length > 0 && (
                  <div style={agentBadgeStyle} title="Agent assigned to this comment">
                    <span>{c.agentId}</span>
                    <span style={agentStatusBadge(c.agentStatus)}>
                      {c.agentStatus ?? "pending"}
                    </span>
                  </div>
                )}
              </div>
              {c.replies?.map((r, i) => (
                <div key={`${c.id}-reply-${i}`} style={{ ...messageStyle, paddingLeft: 20, borderLeft: `2px solid ${r.author === "agent" ? "var(--accent, #2563eb)" : "var(--border)"}` }}>
                  <div style={messageMetaStyle}>
                    <span style={{ fontWeight: 600, color: r.author === "agent" ? "var(--accent, #2563eb)" : "var(--fg, var(--text))" }}>
                      {r.author}
                    </span>
                    <span>{formatTime(r.createdAt)}</span>
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>
                </div>
              ))}
              {canReply(c) && replyGoalId !== c.id && (
                <div style={{ padding: "4px 12px 8px", borderBottom: "1px solid var(--border, var(--border-faint))" }}>
                  <button
                    type="button"
                    onClick={() => setReplyGoalId(c.id)}
                    style={replyBtnStyle}
                  >
                    Reply
                  </button>
                </div>
              )}
              {replyGoalId === c.id && (
                <div style={{ borderBottom: "1px solid var(--border, var(--border-faint))" }}>
                  <textarea
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitReply()
                      if (e.key === "Escape") { setReplyGoalId(null); setReplyText("") }
                    }}
                    placeholder="Continue the conversation…"
                    style={{ ...textareaStyle, borderTop: "none" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 12px 8px", gap: 6 }}>
                    <button type="button" onClick={() => { setReplyGoalId(null); setReplyText("") }} style={cancelBtnStyle}>Cancel</button>
                    <button type="button" onClick={submitReply} style={primaryBtnStyle} disabled={replyText.trim().length === 0}>Send</button>
                  </div>
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
        }}
        placeholder="Reply…"
        style={textareaStyle}
      />
      <ModeBar
        mode={mode}
        setMode={setMode}
        onSubmit={submit}
        disabled={text.trim().length === 0}
        workspaceKind={workspaceKind}
      />
    </>
  )
}

// --- Composer: new-comment box with mode/fork controls ------------------------

export function CommentComposer({
  label,
  onSave,
  onCancel,
  workspaceKind,
  onEditingChange,
  initialDraft,
  onDraftChange,
  dragHandleProps,
}: {
  label: string
  onSave: (payload: SubmitPayload) => void
  onCancel: () => void
  workspaceKind?: "code" | "arch" | undefined
  onEditingChange?: (active: boolean) => void
  initialDraft?: Partial<DraftPayload> | undefined
  onDraftChange?: (payload: DraftPayload) => void
  dragHandleProps?: DragHandleProps | undefined
}) {
  const [text, setText] = useState(initialDraft?.text ?? "")
  const [mode, setMode] = useState<"code" | "arch">(initialDraft?.mode ?? "code")
  const onEditingChangeRef = useRef(onEditingChange)
  const onDraftChangeRef = useRef(onDraftChange)
  onEditingChangeRef.current = onEditingChange
  onDraftChangeRef.current = onDraftChange
  const editingActive = text.trim().length > 0
  useEffect(() => {
    onEditingChangeRef.current?.(editingActive)
    onDraftChangeRef.current?.({ text, mode })
  }, [editingActive, mode, text])
  useEffect(() => () => onEditingChangeRef.current?.(false), [])
  const submit = () => {
    const t = text.trim()
    if (t.length > 0) onSave({ text: t, mode })
  }

  return (
    <>
      <Header label={label} onClose={onCancel} dragHandleProps={dragHandleProps} />
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
        }}
        placeholder="Add a comment…"
        style={textareaStyle}
      />
      <ModeBar
        mode={mode}
        setMode={setMode}
        onSubmit={submit}
        disabled={text.trim().length === 0}
        workspaceKind={workspaceKind}
      />
    </>
  )
}

// --- Header: icon + label + close button -------------------------------------

function Header({
  label,
  onClose,
  dragHandleProps,
}: {
  label: string
  onClose: () => void
  dragHandleProps?: DragHandleProps | undefined
}) {
  const icon = iconForLabel(label)
  return (
    <div
      {...dragHandleProps}
      data-comment-drag-handle={dragHandleProps ? "" : undefined}
      style={{ ...headerStyle, ...dragHandleProps?.style }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: "var(--muted)", display: "flex" }}>{icon}</span>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClose}
        style={closeBtnStyle}
        title="Close"
      >
        ×
      </button>
    </div>
  )
}

// --- Mode bar: segmented code/arch toggle + fork + submit --------------------

function ModeBar({
  mode,
  setMode,
  onSubmit,
  disabled,
  workspaceKind,
}: {
  mode: "code" | "arch"
  setMode: (m: "code" | "arch") => void
  onSubmit: () => void
  disabled: boolean
  workspaceKind?: "code" | "arch" | undefined
}) {
  return (
    <div style={actionsStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={segmentedTrack} onClick={() => setMode(mode === "code" ? "arch" : "code")}>
          <span style={segmentBtn(mode === "code")}>code</span>
          <span style={segmentBtn(mode === "arch")}>arch</span>
        </div>
      </div>
      <button type="button" onClick={onSubmit} style={primaryBtnStyle} disabled={disabled}>
        Create Change
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

export function applyPopoverDragOffset(
  position: React.CSSProperties,
  offset: DragOffset,
): React.CSSProperties {
  return {
    ...position,
    left: typeof position.left === "number" ? position.left + offset.x : position.left,
    top: typeof position.top === "number" ? position.top + offset.y : position.top,
  }
}

export function usePopoverDrag() {
  const [offset, setOffset] = useState<DragOffset>({ x: 0, y: 0 })
  const offsetRef = useRef(offset)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  useEffect(() => () => cleanupRef.current?.(), [])

  const reset = useCallback(() => setOffset({ x: 0, y: 0 }), [])

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLDivElement>>((e) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    const startOffset = offsetRef.current
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor

    e.preventDefault()
    const setPointerCapture = Reflect.get(e.currentTarget, "setPointerCapture")
    if (typeof setPointerCapture === "function") {
      setPointerCapture.call(e.currentTarget, e.pointerId)
    }
    document.body.style.userSelect = "none"
    document.body.style.cursor = "grabbing"

    const onMove = (event: PointerEvent) => {
      setOffset({
        x: startOffset.x + event.clientX - startX,
        y: startOffset.y + event.clientY - startY,
      })
    }
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", cleanup)
      window.removeEventListener("pointercancel", cleanup)
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
      cleanupRef.current = null
    }

    cleanupRef.current?.()
    cleanupRef.current = cleanup
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", cleanup)
    window.addEventListener("pointercancel", cleanup)
  }, [])

  const dragHandleProps = useMemo<DragHandleProps>(() => ({
    title: "Drag comment",
    style: { cursor: "grab", userSelect: "none", touchAction: "none" },
    onPointerDown,
  }), [onPointerDown])

  return { offset, reset, dragHandleProps }
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

const replyBtnStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 11,
  background: "none",
  border: "none",
  color: "var(--accent, #2563eb)",
  cursor: "pointer",
  padding: 0,
}

const cancelBtnStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 12,
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "4px 10px",
  cursor: "pointer",
  color: "var(--muted)",
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
