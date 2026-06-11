// Vercel-style element-pinned comments for Storybook stories.
//
// Hold Alt (Option on macOS) and the element under the cursor is highlighted;
// Alt+click pins a comment to it. Pins are grouped per anchored element and
// open into a small thread popover. Everything is rendered in a fixed overlay
// that sits above the story but lets pointer events fall through to the story
// (so Alt-hover can read the real elements) except over its own UI.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  addComment,
  cssPath,
  describe,
  listComments,
  removeComment,
  resolve,
  type StoryComment,
} from "./comment-store"

const ACCENT = "var(--accent)"
const BORDER = "var(--border)"
const FG = "var(--fg)"
const MUTED = "var(--muted)"
const BG = "var(--bg)"

interface HoverTarget {
  rect: DOMRect
  label: string
}

interface Draft {
  rect: DOMRect
  selector: string
  label: string
}

export function CommentLayer({
  storyId,
  component,
  children,
}: {
  storyId: string
  component?: string
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(true)
  const [comments, setComments] = useState<StoryComment[]>([])
  const [altDown, setAltDown] = useState(false)
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openSelector, setOpenSelector] = useState<string | null>(null)
  // Bumped on scroll/resize/mutation so pins recompute their positions.
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  const refresh = useCallback(() => {
    listComments(storyId).then(setComments)
  }, [storyId])
  useEffect(() => {
    refresh()
  }, [refresh])

  // Reset transient UI when switching stories.
  useEffect(() => {
    setDraft(null)
    setOpenSelector(null)
    setHover(null)
  }, [storyId])

  const inStory = useCallback((el: Element | null): el is Element => {
    return !!(el && rootRef.current?.contains(el) && !el.closest("[data-comment-ui]"))
  }, [])

  // Track the Alt key.
  useEffect(() => {
    if (!enabled) return
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltDown(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setAltDown(false)
        setHover(null)
      }
    }
    const onBlur = () => {
      setAltDown(false)
      setHover(null)
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [enabled])

  // Highlight the hovered element while Alt is held.
  useEffect(() => {
    if (!enabled || !altDown) return
    const onMove = (e: MouseEvent) => {
      const target = e.target as Element
      if (!inStory(target)) {
        setHover(null)
        return
      }
      setHover({ rect: target.getBoundingClientRect(), label: describe(target) })
    }
    document.addEventListener("mousemove", onMove)
    return () => document.removeEventListener("mousemove", onMove)
  }, [enabled, altDown, inStory])

  // Alt+click pins a comment. Capture phase so we beat link navigation etc.
  useEffect(() => {
    if (!enabled) return
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return
      const target = e.target as Element
      if (!inStory(target) || !rootRef.current) return
      e.preventDefault()
      e.stopPropagation()
      setDraft({
        rect: target.getBoundingClientRect(),
        selector: cssPath(target, rootRef.current),
        label: describe(target),
      })
      setOpenSelector(null)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [enabled, inStory])

  // Reposition pins when the layout shifts.
  useEffect(() => {
    window.addEventListener("scroll", bump, true)
    window.addEventListener("resize", bump)
    const ro = new ResizeObserver(bump)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => {
      window.removeEventListener("scroll", bump, true)
      window.removeEventListener("resize", bump)
      ro.disconnect()
    }
  }, [bump])

  // Group comments by their anchor element.
  const groups = useMemo(() => {
    const map = new Map<string, StoryComment[]>()
    for (const c of comments) {
      const arr = map.get(c.selector) ?? []
      arr.push(c)
      map.set(c.selector, arr)
    }
    return map
  }, [comments])

  const author = "you"
  const root = rootRef.current

  const saveDraft = async (body: string) => {
    if (!draft) return
    const selector = draft.selector
    await addComment({ storyId, component, selector, label: draft.label, body, author })
    setDraft(null)
    refresh()
    setOpenSelector(selector)
  }

  const total = comments.length

  return (
    <>
      <div ref={rootRef} data-comment-root>
        {children}
      </div>

      <div data-comment-ui style={overlayStyle}>
        {/* Alt-hover highlight */}
        {enabled && altDown && hover && (
          <div style={highlightStyle(hover.rect)}>
            <span style={highlightLabelStyle}>{hover.label}</span>
          </div>
        )}

        {/* Pins for each anchored element */}
        {enabled &&
          root &&
          Array.from(groups.entries()).map(([selector, list]) => {
            const el = resolve(root, selector)
            if (!el) return null
            const rect = el.getBoundingClientRect()
            return (
              <Pin
                key={selector}
                rect={rect}
                count={list.length}
                active={openSelector === selector}
                onClick={() => {
                  setOpenSelector((cur) => (cur === selector ? null : selector))
                  setDraft(null)
                }}
              />
            )
          })}

        {/* Thread popover for the open pin */}
        {enabled &&
          root &&
          openSelector &&
          (() => {
            const el = resolve(root, openSelector)
            const list = groups.get(openSelector)
            if (!el || !list) return null
            return (
              <Thread
                rect={el.getBoundingClientRect()}
                comments={list}
                onAdd={async (body) => {
                  await addComment({
                    storyId,
                    component,
                    selector: openSelector,
                    label: list[0]?.label ?? openSelector,
                    body,
                    author,
                  })
                  refresh()
                }}
                onRemove={async (id) => {
                  await removeComment(id)
                  refresh()
                }}
                onClose={() => setOpenSelector(null)}
              />
            )
          })()}

        {/* Composer for a new pin */}
        {enabled && draft && (
          <Composer
            rect={draft.rect}
            label={draft.label}
            onSave={saveDraft}
            onCancel={() => setDraft(null)}
          />
        )}

        {/* Toolbar */}
        <div style={toolbarStyle}>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            style={toolbarBtnStyle(enabled)}
            title={enabled ? "Comments on — click to disable" : "Comments off"}
          >
            💬 {enabled ? "Comments" : "Comments off"}
            {total > 0 && <span style={countPillStyle}>{total}</span>}
          </button>
          {enabled && (
            <span style={hintStyle}>
              <kbd style={kbdStyle}>Alt</kbd>
              {altDown ? " + click an element" : " + hover to comment"}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

// --- Pins & popovers ---------------------------------------------------------

function Pin({
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
        background: active ? FG : ACCENT,
        color: active ? ACCENT : FG,
        outline: active ? `2px solid ${FG}` : "none",
      }}
      title={`${count} comment${count === 1 ? "" : "s"}`}
    >
      {count > 1 ? count : "💬"}
    </button>
  )
}

function Thread({
  rect,
  comments,
  onAdd,
  onRemove,
  onClose,
}: {
  rect: DOMRect
  comments: StoryComment[]
  onAdd: (body: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const [body, setBody] = useState("")
  const submit = () => {
    const text = body.trim()
    if (!text) return
    onAdd(text)
    setBody("")
  }
  return (
    <div style={popoverStyle(rect)}>
      <div style={popoverHeaderStyle}>
        <span style={{ fontWeight: 600 }}>{comments[0]?.label}</span>
        <button type="button" onClick={onClose} style={closeBtnStyle} title="Close">
          ×
        </button>
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {comments.map((c) => (
          <div key={c.id} style={messageStyle}>
            <div style={messageMetaStyle}>
              <span style={{ fontWeight: 600, color: FG }}>{c.author}</span>
              <span>{formatTime(c.createdAt)}</span>
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                style={deleteBtnStyle}
                title="Delete"
              >
                delete
              </button>
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
            {c.agentId && (
              <div style={agentBadgeStyle} title="The agent assigned to implement this comment">
                <span style={{ fontFamily: "monospace" }}>{c.agentId}</span>
                <span style={agentStatusStyle(c.agentStatus)}>{c.agentStatus ?? "pending"}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
          if (e.key === "Escape") onClose()
        }}
        placeholder="Reply…"
        style={textareaStyle}
      />
      <div style={composerActionsStyle}>
        <span style={{ fontSize: 10, color: MUTED }}>⌘/Ctrl+Enter</span>
        <button type="button" onClick={submit} style={primaryBtnStyle} disabled={!body.trim()}>
          Comment
        </button>
      </div>
    </div>
  )
}

function Composer({
  rect,
  label,
  onSave,
  onCancel,
}: {
  rect: DOMRect
  label: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState("")
  const submit = () => {
    const text = body.trim()
    if (text) onSave(text)
  }
  return (
    <div style={popoverStyle(rect)}>
      <div style={popoverHeaderStyle}>
        <span style={{ color: MUTED }}>
          New comment on <span style={{ color: FG, fontWeight: 600 }}>{label}</span>
        </span>
        <button type="button" onClick={onCancel} style={closeBtnStyle} title="Cancel">
          ×
        </button>
      </div>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit()
          if (e.key === "Escape") onCancel()
        }}
        placeholder="Add a comment…"
        style={textareaStyle}
      />
      <div style={composerActionsStyle}>
        <span style={{ fontSize: 10, color: MUTED }}>⌘/Ctrl+Enter</span>
        <button type="button" onClick={submit} style={primaryBtnStyle} disabled={!body.trim()}>
          Comment
        </button>
      </div>
    </div>
  )
}

// --- Styles ------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  zIndex: 2147483000,
  font: "13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

function highlightStyle(rect: DOMRect): React.CSSProperties {
  return {
    position: "absolute",
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    border: `2px solid ${FG}`,
    background: "rgba(255, 248, 168, 0.25)",
    borderRadius: 2,
    pointerEvents: "none",
    boxSizing: "border-box",
  }
}

const highlightLabelStyle: React.CSSProperties = {
  position: "absolute",
  top: -19,
  left: -2,
  background: FG,
  color: ACCENT,
  fontSize: 10,
  fontFamily: "monospace",
  padding: "2px 6px",
  borderRadius: "3px 3px 0 0",
  whiteSpace: "nowrap",
}

const pinStyle: React.CSSProperties = {
  position: "absolute",
  width: 22,
  height: 22,
  borderRadius: "11px 11px 11px 2px",
  border: `1.5px solid ${FG}`,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
}

function popoverStyle(rect: DOMRect): React.CSSProperties {
  const left = Math.min(rect.right + 12, window.innerWidth - 280)
  const top = Math.min(Math.max(rect.top, 8), window.innerHeight - 200)
  return {
    position: "absolute",
    left,
    top,
    width: 260,
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
    pointerEvents: "auto",
    color: FG,
    overflow: "hidden",
  }
}

const popoverHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--border-faint)",
  fontSize: 12,
}

const messageStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--border-faint)",
}

const messageMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 11,
  color: MUTED,
  marginBottom: 3,
}

const agentBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginTop: 6,
  fontSize: 10,
  color: MUTED,
}

function agentStatusStyle(status?: string): React.CSSProperties {
  const color =
    status === "done" ? "var(--success)" : status === "error" ? "var(--error)" : MUTED
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
  borderTop: "1px solid var(--border-faint)",
  padding: "8px 10px",
  resize: "vertical",
  minHeight: 52,
  font: "inherit",
  color: FG,
  background: BG,
  boxSizing: "border-box",
  outline: "none",
}

const composerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderTop: "1px solid var(--border-faint)",
}

const primaryBtnStyle: React.CSSProperties = {
  background: FG,
  color: BG,
  border: "none",
  borderRadius: 4,
  padding: "5px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
}

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  color: MUTED,
  padding: 0,
}

const deleteBtnStyle: React.CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--error)",
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
}

const toolbarStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 14,
  right: 14,
  display: "flex",
  alignItems: "center",
  gap: 10,
  pointerEvents: "auto",
}

function toolbarBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: enabled ? ACCENT : BG,
    color: FG,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
  }
}

const countPillStyle: React.CSSProperties = {
  background: FG,
  color: BG,
  borderRadius: 9,
  padding: "0 6px",
  fontSize: 11,
  minWidth: 16,
  textAlign: "center",
}

const hintStyle: React.CSSProperties = {
  background: BG,
  border: "1px solid var(--border-faint)",
  borderRadius: 6,
  padding: "5px 9px",
  fontSize: 11,
  color: MUTED,
}

const kbdStyle: React.CSSProperties = {
  background: "var(--bg-alt)",
  border: "1px solid var(--border-soft)",
  borderRadius: 3,
  padding: "1px 5px",
  fontFamily: "monospace",
  fontSize: 10,
  color: FG,
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
