import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  postComment,
  onGoalsFromStudio,
  cssPath,
  describe,
  resolve,
  type StoryComment,
} from "./comment-store"
import {
  CommentThread,
  CommentComposer,
  CommentToolbar,
  Highlight,
  Pin,
  overlayStyle,
  popoverPos,
  popoverShell,
  type SubmitPayload,
} from "@logos-studio/comment-ui"

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
  const [workspaceKind, setWorkspaceKind] = useState<"code" | "arch">("code")
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  // Receive goals from the studio parent frame
  useEffect(() => {
    return onGoalsFromStudio((goals, kind) => {
      setWorkspaceKind(kind)
      setComments(goals.filter((g) => g.storyId === storyId))
    })
  }, [storyId])

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
      const sel = c.selector
      if (!sel) continue
      const arr = map.get(sel) ?? []
      arr.push(c)
      map.set(sel, arr)
    }
    return map
  }, [comments])

  const root = rootRef.current

  const sendComment = (selector: string, label: string, p: SubmitPayload) => {
    postComment({
      storyId,
      component,
      selector,
      label,
      text: p.text,
      author: "you",
      mode: p.mode,
      fork: p.fork,
    })
  }

  const saveDraft = (p: SubmitPayload) => {
    if (!draft) return
    sendComment(draft.selector, draft.label, p)
    setDraft(null)
    setOpenSelector(draft.selector)
  }

  const total = comments.length

  return (
    <>
      <div ref={rootRef} data-comment-root>
        {children}
      </div>

      <div data-comment-ui style={overlayStyle}>
        {enabled && altDown && hover && (
          <Highlight rect={hover.rect} label={hover.label} />
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
                  onAdd={(p) => {
                    sendComment(openSelector, list[0]?.label ?? openSelector, p)
                  }}
                  workspaceKind={workspaceKind}
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
              workspaceKind={workspaceKind}
            />
          </div>
        )}

        <CommentToolbar
          enabled={enabled}
          onToggle={() => setEnabled((v) => !v)}
          total={total}
          altDown={altDown}
        />
      </div>
    </>
  )
}
