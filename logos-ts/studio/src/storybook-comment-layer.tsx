import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CommentComposer,
  CommentThread,
  CommentToolbar,
  Highlight,
  Pin,
  overlayStyle,
  popoverPos,
  popoverShell,
  type SubmitPayload,
} from "./comment-ui"

export interface StoryComment {
  id: string
  storyId: string
  selector: string
  label: string
  text: string
  author: string
  createdAt: number
  component?: string
  mode?: string
  fork?: boolean
  status?: string
}

interface HoverTarget {
  rect: DOMRect
  label: string
}

interface Draft {
  rect: DOMRect
  selector: string
  label: string
}

function portableStoryIdentity(): { storyId: string; component?: string } | null {
  const story = (window as typeof window & {
    __LOGOS_PORTABLE_STORY?: { storyId: string; storyTitle: string }
  }).__LOGOS_PORTABLE_STORY
  if (!story) return null
  const component = story.storyTitle.split(" / ")[0]
  return {
    storyId: story.storyId,
    ...(component ? { component } : {}),
  }
}

function postStoryComment(comment: Omit<StoryComment, "id" | "createdAt">): void {
  try {
    const message = { type: "logos:story-comment", ...comment }
    window.parent?.postMessage(message, "*")
    if (window.top && window.top !== window.parent) window.top.postMessage(message, "*")
  } catch {}
}

function onGoalsFromStudio(
  cb: (goals: StoryComment[], workspaceKind: "code" | "arch") => void,
): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === "logos:story-goals") {
      cb(e.data.goals as StoryComment[], e.data.workspaceKind === "arch" ? "arch" : "code")
    }
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}

function cssPath(el: Element, root: Element): string {
  if (el === root) return ":scope"
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    let part = node.tagName.toLowerCase()
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
    if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
    parts.unshift(part)
    node = parent === root ? null : parent
    if (parent === root) break
  }
  return parts.length ? ":scope > " + parts.join(" > ") : ":scope"
}

function resolveSelector(root: Element, selector: string): Element | null {
  try {
    return selector === ":scope" ? root : root.querySelector(selector)
  } catch {
    return null
  }
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32)
  return text ? `${tag} "${text}"` : `<${tag}>`
}

export function StorybookCommentLayer({
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
  const identity = portableStoryIdentity()
  const effectiveStoryId = identity?.storyId ?? storyId
  const effectiveComponent = identity?.component ?? component

  useEffect(() => {
    return onGoalsFromStudio((goals, kind) => {
      setWorkspaceKind(kind)
      setComments(goals.filter((g) => g.storyId === effectiveStoryId))
    })
  }, [effectiveStoryId])

  useEffect(() => {
    setDraft(null)
    setOpenSelector(null)
    setHover(null)
  }, [effectiveStoryId])

  const inStory = useCallback((el: Element | null): el is Element => (
    !!(el && rootRef.current?.contains(el) && !el.closest("[data-comment-ui]"))
  ), [])

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
      setHover({ rect: target.getBoundingClientRect(), label: describeElement(target) })
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
        label: describeElement(target),
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
    postStoryComment({
      storyId: effectiveStoryId,
      ...(effectiveComponent != null ? { component: effectiveComponent } : {}),
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

  return (
    <>
      <div ref={rootRef} data-comment-root>
        {children}
      </div>

      <div data-comment-ui style={overlayStyle}>
        {enabled && altDown && hover && <Highlight rect={hover.rect} label={hover.label} />}

        {enabled && root && Array.from(groups.entries()).map(([selector, list]) => {
          const el = resolveSelector(root, selector)
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

        {enabled && root && openSelector && (() => {
          const el = resolveSelector(root, openSelector)
          const list = groups.get(openSelector)
          if (!el || !list) return null
          const rect = el.getBoundingClientRect()
          return (
            <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
              <CommentThread
                label={list[0]?.label ?? openSelector}
                comments={list}
                onAdd={(p) => sendComment(openSelector, list[0]?.label ?? openSelector, p)}
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
          total={comments.length}
          altDown={altDown}
        />
      </div>
    </>
  )
}

export { StorybookCommentLayer as CommentLayer }
