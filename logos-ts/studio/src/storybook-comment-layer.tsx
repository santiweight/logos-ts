import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CommentComposer,
  CommentThread,
  CommentToolbar,
  Highlight,
  Pin,
  applyPopoverDragOffset,
  overlayStyle,
  popoverPos,
  popoverShell,
  usePopoverDrag,
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
  htmlContext?: string
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
  htmlContext?: string
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

interface LogosCommentLayerWindow extends Window {
  __LOGOS_STORY_COMMENT_LAYER_ACTIVE__?: string
}

const LOGOS_STORY_COMMENT_LAYER_ID = `logos-comment-layer-${Math.random().toString(36).slice(2)}`

function claimStoryCommentLayer(): boolean {
  const owner = window as LogosCommentLayerWindow
  if (owner.__LOGOS_STORY_COMMENT_LAYER_ACTIVE__ != null) return false
  owner.__LOGOS_STORY_COMMENT_LAYER_ACTIVE__ = LOGOS_STORY_COMMENT_LAYER_ID
  return true
}

function releaseStoryCommentLayer(): void {
  const owner = window as LogosCommentLayerWindow
  if (owner.__LOGOS_STORY_COMMENT_LAYER_ACTIVE__ === LOGOS_STORY_COMMENT_LAYER_ID) {
    delete owner.__LOGOS_STORY_COMMENT_LAYER_ACTIVE__
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function portableStoryIdentity(): { storyId: string; component?: string } | null {
  const story = (window as typeof window & {
    __LOGOS_PORTABLE_STORY?: { storyId: string; storyTitle: string }
  }).__LOGOS_PORTABLE_STORY
  if (story == null) return null
  const component = story.storyTitle.split(" / ")[0]
  return {
    storyId: story.storyId,
    ...(component != null && component.length > 0 ? { component } : {}),
  }
}

function clientEventId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  return typeof randomUUID === "function"
    ? randomUUID.call(globalThis.crypto)
    : `logos-story-comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function postStoryComment(comment: Omit<StoryComment, "id" | "createdAt">): void {
  try {
    const message = { type: "logos:story-comment", clientEventId: clientEventId(), ...comment }
    window.parent.postMessage(message, "*")
  } catch {}
}

function postCommentEditing(storyId: string, active: boolean): void {
  try {
    const message = { type: "logos:story-comment-editing", storyId, active }
    window.parent.postMessage(message, "*")
  } catch {}
}

function postCommentDraft(draft: StoryDraft | { storyId: string; active: false }): void {
  try {
    const message = { type: "logos:story-comment-draft", ...draft }
    window.parent.postMessage(message, "*")
  } catch {}
}

function onGoalsFromStudio(
  cb: (goals: StoryComment[], workspaceKind: "code" | "arch", drafts: StoryDraft[]) => void,
): () => void {
  const handler = (e: MessageEvent) => {
    const data: unknown = e.data
    if (!isRecord(data) || data["type"] !== "logos:story-goals") return
    cb(
      Array.isArray(data["goals"]) ? data["goals"] as StoryComment[] : [],
      data["workspaceKind"] === "arch" ? "arch" : "code",
      Array.isArray(data["drafts"]) ? data["drafts"] as StoryDraft[] : [],
    )
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
    if (parent == null) break
    let part = node.tagName.toLowerCase()
    const nodeTagName = node.tagName
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === nodeTagName)
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
  if (exact != null) return { selector, element: exact }
  if (!selector.startsWith(":scope > ")) return { selector: ":scope", element: root }
  const parts = selector.slice(":scope > ".length).split(" > ")
  for (let i = parts.length - 1; i > 0; i--) {
    const parentSelector = ":scope > " + parts.slice(0, i).join(" > ")
    const element = resolveSelector(root, parentSelector)
    if (element != null) return { selector: parentSelector, element }
  }
  return { selector: ":scope", element: root }
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 32)
  return text.length > 0 ? `${tag} "${text}"` : `<${tag}>`
}

function describeHtmlContext(el: Element, root: Element): string {
  const parts = [`selected: ${elementContextLine(el)}`]
  const parent = el.parentElement
  if (parent != null && parent !== root) parts.push(`parent: ${elementContextLine(parent)}`)
  return parts.join("\n")
}

function elementContextLine(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const attrs = ["role", "aria-label", "title", "class"]
    .map((name) => {
      const value = el.getAttribute(name)
      return value ? `${name}="${value.trim().slice(0, 64)}"` : null
    })
    .filter(Boolean)
    .join(" ")
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 140)
  return `<${tag}${attrs ? ` ${attrs}` : ""}>${text}</${tag}>`
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
  const [layerActive] = useState(claimStoryCommentLayer)
  const rootRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(true)
  const [comments, setComments] = useState<StoryComment[]>([])
  const [altDown, setAltDown] = useState(false)
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openSelector, setOpenSelector] = useState<string | null>(null)
  const [workspaceKind, setWorkspaceKind] = useState<"code" | "arch">("code")
  const { offset: popoverOffset, reset: resetPopoverOffset, dragHandleProps } = usePopoverDrag()
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])
  const identity = portableStoryIdentity()
  const effectiveStoryId = identity?.storyId ?? storyId
  const effectiveComponent = identity?.component ?? component

  useEffect(() => {
    if (!layerActive) return undefined
    return releaseStoryCommentLayer
  }, [layerActive])

  useEffect(() => {
    if (!layerActive) return undefined
    return onGoalsFromStudio((goals, kind, drafts) => {
      setWorkspaceKind(kind)
      setComments(goals.filter((g) => g.storyId === effectiveStoryId))
      const restored = drafts.find((d): boolean => d.storyId === effectiveStoryId && d.text.trim().length > 0)
      if (restored != null) {
        if (restored.kind === "reply") {
          setOpenSelector(restored.selector)
          setDraft(null)
        } else {
          setDraft(restored)
          setOpenSelector(null)
        }
      }
    })
  }, [effectiveStoryId, layerActive])

  useEffect(() => {
    if (!layerActive) return
    setDraft(null)
    setOpenSelector(null)
    setHover(null)
    resetPopoverOffset()
  }, [effectiveStoryId, layerActive, resetPopoverOffset])

  useEffect(() => {
    if (!layerActive) return
    resetPopoverOffset()
  }, [draft?.selector, draft?.kind, layerActive, openSelector, resetPopoverOffset])

  const inStory = useCallback((el: Element | null): el is Element => {
    if (el == null) return false
    const rootEl = rootRef.current
    return rootEl != null && rootEl.contains(el) && el.closest("[data-comment-ui]") == null
  }, [])

  useEffect(() => {
    if (!layerActive || !enabled) return
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
  }, [enabled, layerActive])

  useEffect(() => {
    if (!layerActive || !enabled || !altDown) return
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
  }, [enabled, altDown, inStory, layerActive])

  useEffect(() => {
    if (!layerActive || !enabled) return
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return
      const target = e.target as Element
      const rootEl = rootRef.current
      if (!inStory(target) || rootEl == null) return
      e.preventDefault()
      e.stopPropagation()
      setDraft({
        selector: cssPath(target, rootEl),
        label: describeElement(target),
        htmlContext: describeHtmlContext(target, rootEl),
        kind: "new",
      })
      setOpenSelector(null)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [enabled, inStory, layerActive])

  useEffect(() => {
    if (!layerActive) return
    window.addEventListener("scroll", bump, true)
    window.addEventListener("resize", bump)
    const ro = new ResizeObserver(bump)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => {
      window.removeEventListener("scroll", bump, true)
      window.removeEventListener("resize", bump)
      ro.disconnect()
    }
  }, [bump, layerActive])

  const groups = useMemo(() => {
    const map = new Map<string, StoryComment[]>()
    for (const c of comments) {
      const sel = c.selector
      if (sel.length === 0) continue
      const arr = map.get(sel) ?? []
      arr.push(c)
      map.set(sel, arr)
    }
    return map
  }, [comments])

  const root = rootRef.current

  const sendComment = (selector: string, label: string, htmlContext: string | undefined, p: SubmitPayload) => {
    postStoryComment({
      storyId: effectiveStoryId,
      ...(effectiveComponent != null ? { component: effectiveComponent } : {}),
      selector,
      label,
      ...(htmlContext != null ? { htmlContext } : {}),
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
      ...(draftUpdate.htmlContext != null ? { htmlContext: draftUpdate.htmlContext } : {}),
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
    if (draft == null) return
    const rootEl = rootRef.current
    if (rootEl == null) throw new Error("Cannot attach comment because the story root disappeared.")
    const { selector } = resolveNearestSelector(rootEl, draft.selector)
    const label = selector === draft.selector ? draft.label : rootLabel
    const htmlContext = selector === draft.selector ? draft.htmlContext : describeHtmlContext(rootEl, rootEl)
    sendComment(selector, label, htmlContext, p)
    clearCommentDraft()
    setDraft(null)
    setOpenSelector(selector)
  }

  if (!layerActive) return <>{children}</>

  return (
    <>
      <div ref={rootRef} data-comment-root>
        {children}
      </div>

      <div data-comment-ui style={overlayStyle}>
        {enabled && altDown && hover != null && <Highlight rect={hover.rect} label={hover.label} />}

        {enabled && root != null && Array.from(groups.entries()).map(([selector, list]) => {
          const el = resolveSelector(root, selector)
          if (el == null) return null
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

        {enabled && root != null && openSelector != null && (() => {
          const list = groups.get(openSelector)
          if (list == null) return null
          const nearest = resolveNearestSelector(root, openSelector)
          const selector = nearest.selector
          const label = selector === openSelector ? list[0]?.label ?? openSelector : rootLabel
          const rect = nearest.element.getBoundingClientRect()
          const initialDraftProps = draft != null && draft.kind === "reply" && draft.selector === openSelector
            ? { initialDraft: draft }
            : {}
          return (
            <div
              style={{
                ...popoverShell,
                ...applyPopoverDragOffset(popoverPos(rect), popoverOffset),
                position: "absolute",
                pointerEvents: "auto",
              }}
            >
              <CommentThread
                label={label}
                comments={list}
                onAdd={(p) => {
                  sendComment(selector, label, describeHtmlContext(nearest.element, root), p)
                  clearCommentDraft()
                  setDraft(null)
                }}
                {...initialDraftProps}
                onDraftChange={(p) => {
                  const replyDraft = { selector: openSelector, label, kind: "reply" as const, ...p }
                  setDraft(replyDraft)
                  sendCommentDraft(replyDraft, p)
                }}
                onEditingChange={sendCommentEditing}
                workspaceKind={workspaceKind}
                onClose={() => { clearCommentDraft(); setOpenSelector(null); setDraft(null) }}
                dragHandleProps={dragHandleProps}
              />
            </div>
          )
        })()}

        {enabled && draft != null && draft.kind !== "reply" && (
          (() => {
            const rootEl = rootRef.current
            const nearest = rootEl != null ? resolveNearestSelector(rootEl, draft.selector) : null
            const rect = nearest == null ? new DOMRect() : nearest.element.getBoundingClientRect()
            return (
              <div
                style={{
                  ...popoverShell,
                  ...applyPopoverDragOffset(popoverPos(rect), popoverOffset),
                  position: "absolute",
                  pointerEvents: "auto",
                }}
              >
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
                  dragHandleProps={dragHandleProps}
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
