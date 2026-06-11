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
import {
  CommentThread,
  CommentComposer,
  popoverShell,
  type SubmitPayload,
} from "../../../logos-ts/studio/src/comment-ui"

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
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  const refresh = useCallback(() => {
    listComments(storyId).then(setComments)
  }, [storyId])
  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setDraft(null)
    setOpenSelector(null)
    setHover(null)
  }, [storyId])

  const inStory = useCallback((el: Element | null): el is Element => {
    return !!(el && rootRef.current?.contains(el) && !el.closest("[data-comment-ui]"))
  }, [])

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

  const saveDraft = async (p: SubmitPayload) => {
    if (!draft) return
    const selector = draft.selector
    await addComment({
      storyId,
      component,
      selector,
      label: draft.label,
      text: p.text,
      author,
      mode: p.mode,
    })
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
        {enabled && altDown && hover && (
          <div style={highlightStyle(hover.rect)}>
            <span style={highlightLabelStyle}>{hover.label}</span>
          </div>
        )}

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

        {enabled &&
          root &&
          openSelector &&
          (() => {
            const el = resolve(root, openSelector)
            const list = groups.get(openSelector)
            if (!el || !list) return null
            const rect = el.getBoundingClientRect()
            return (
              <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
                <CommentThread
                  label={list[0]?.label ?? openSelector}
                  comments={list}
                  onAdd={async (p) => {
                    await addComment({
                      storyId,
                      component,
                      selector: openSelector,
                      label: list[0]?.label ?? openSelector,
                      text: p.text,
                      author,
                      mode: p.mode,
                    })
                    refresh()
                  }}
                  onRemove={async (id) => {
                    await removeComment(id)
                    refresh()
                  }}
                  onClose={() => setOpenSelector(null)}
                />
              </div>
            )
          })()}

        {enabled && draft && (
          <div style={{ ...popoverShell, ...popoverPos(draft.rect), position: "absolute", pointerEvents: "auto" }}>
            <CommentComposer
              label={draft.label}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
            />
          </div>
        )}

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

// --- Pin ---------------------------------------------------------------------

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

function popoverPos(rect: DOMRect): React.CSSProperties {
  return {
    left: Math.min(rect.right + 12, window.innerWidth - 280),
    top: Math.min(Math.max(rect.top, 8), window.innerHeight - 200),
  }
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
