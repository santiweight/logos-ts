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
  replies?: { author: "agent" | "user"; text: string; createdAt: number }[]
}

interface HoverTarget {
  rect: DOMRect
  label: string
}

interface Draft {
  selector: string
  label: string
  text?: string
  mode?: "code" | "arch"
  fork?: boolean
  kind?: "new" | "reply"
}

interface StoryDraft extends Draft {
  storyId: string
  component?: string
  text: string
  mode: "code" | "arch"
  fork: boolean
  kind: "new" | "reply"
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
  } catch {}
}

function postCommentEditing(storyId: string, active: boolean): void {
  try {
    const message = { type: "logos:story-comment-editing", storyId, active }
    window.parent?.postMessage(message, "*")
  } catch {}
}

function postCommentDraft(draft: StoryDraft | { storyId: string; active: false }): void {
  try {
    const message = { type: "logos:story-comment-draft", ...draft }
    window.parent?.postMessage(message, "*")
  } catch {}
}

function onGoalsFromStudio(
  cb: (goals: StoryComment[], workspaceKind: "code" | "arch", drafts: StoryDraft[]) => void,
): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === "logos:story-goals") {
      cb(e.data.goals as StoryComment[], e.data.workspaceKind === "arch" ? "arch" : "code", Array.isArray(e.data.drafts) ? e.data.drafts as StoryDraft[] : [])
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

function resolveNearestSelector(root: Element, selector: string): { selector: string; element: Element } {
  const exact = resolveSelector(root, selector)
  if (exact) return { selector, element: exact }
  if (!selector.startsWith(":scope > ")) return { selector: ":scope", element: root }
  const parts = selector.slice(":scope > ".length).split(" > ")
  for (let i = parts.length - 1; i > 0; i--) {
    const parentSelector = ":scope > " + parts.slice(0, i).join(" > ")
    const element = resolveSelector(root, parentSelector)
    if (element) return { selector: parentSelector, element }
  }
  return { selector: ":scope", element: root }
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
    return onGoalsFromStudio((goals, kind, drafts) => {
      setWorkspaceKind(kind)
      setComments(goals.filter((g) => g.storyId === effectiveStoryId))
      const restored = drafts.find((d) => d.storyId === effectiveStoryId && d.text.trim())
      if (restored) {
        if (restored.kind === "reply") {
          setOpenSelector(restored.selector)
          setDraft(null)
        } else {
          setDraft(restored)
          setOpenSelector(null)
        }
      }
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
        selector: cssPath(target, rootRef.current),
        label: describeElement(target),
        kind: "new",
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

  const sendCommentEditing = useCallback((active: boolean) => {
    postCommentEditing(effectiveStoryId, active)
  }, [effectiveStoryId])

  const clearCommentDraft = useCallback(() => {
    postCommentDraft({ storyId: effectiveStoryId, active: false })
    sendCommentEditing(false)
  }, [effectiveStoryId, sendCommentEditing])

  const sendCommentDraft = useCallback((draftUpdate: Draft, p: SubmitPayload) => {
    if (!p.text.trim()) {
      postCommentDraft({ storyId: effectiveStoryId, active: false })
      sendCommentEditing(false)
      return
    }
    postCommentDraft({
      storyId: effectiveStoryId,
      ...(effectiveComponent != null ? { component: effectiveComponent } : {}),
      selector: draftUpdate.selector,
      label: draftUpdate.label,
      text: p.text,
      mode: p.mode,
      fork: p.fork,
      kind: draftUpdate.kind ?? "new",
    })
    sendCommentEditing(true)
  }, [effectiveComponent, effectiveStoryId, sendCommentEditing])

  useEffect(() => clearCommentDraft, [clearCommentDraft])

  const rootLabel = effectiveComponent ?? effectiveStoryId

  const saveDraft = (p: SubmitPayload) => {
    if (!draft) return
    const rootEl = rootRef.current
    if (!rootEl) throw new Error("Cannot attach comment because the story root disappeared.")
    const { selector } = resolveNearestSelector(rootEl, draft.selector)
    const label = selector === draft.selector ? draft.label : rootLabel
    sendComment(selector, label, p)
    clearCommentDraft()
    setDraft(null)
    setOpenSelector(selector)
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
          const list = groups.get(openSelector)
          if (!list) return null
          const nearest = resolveNearestSelector(root, openSelector)
          const selector = nearest.selector
          const label = selector === openSelector ? list[0]?.label ?? openSelector : rootLabel
          const rect = nearest.element.getBoundingClientRect()
          return (
            <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
              <CommentThread
                label={label}
                comments={list}
                onAdd={(p) => {
                  sendComment(selector, label, p)
                  clearCommentDraft()
                  setDraft(null)
                }}
                initialDraft={draft?.kind === "reply" && draft.selector === openSelector ? draft : undefined}
                onDraftChange={(p) => {
                  const replyDraft = { selector: openSelector, label, kind: "reply" as const, ...p }
                  setDraft(replyDraft)
                  sendCommentDraft(replyDraft, p)
                }}
                onEditingChange={sendCommentEditing}
                workspaceKind={workspaceKind}
                onClose={() => { clearCommentDraft(); setOpenSelector(null); setDraft(null) }}
              />
            </div>
          )
        })()}

        {enabled && draft && draft.kind !== "reply" && (
          (() => {
            const rootEl = rootRef.current
            const nearest = rootEl ? resolveNearestSelector(rootEl, draft.selector) : null
            const rect = nearest?.element.getBoundingClientRect() ?? new DOMRect()
            return (
              <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
                <CommentComposer
                  label={draft.label}
                  onSave={saveDraft}
                  onCancel={() => { clearCommentDraft(); setDraft(null) }}
                  initialDraft={draft}
                  onDraftChange={(p) => {
                    const next = { ...draft, ...p, kind: "new" as const }
                    setDraft(next)
                    sendCommentDraft(next, p)
                  }}
                  onEditingChange={sendCommentEditing}
                  workspaceKind={workspaceKind}
                />
              </div>
            )
          })()
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
