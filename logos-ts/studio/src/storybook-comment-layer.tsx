import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CommentToolbar,
  Highlight,
  Pin,
  overlayStyle,
} from "./comment-overlay"

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
  screenshotDataUrl?: string
  status?: string
  sessionId?: string | null
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
  htmlContext?: string
  screenshotDataUrl?: string
  kind?: "new" | "reply"
}

interface StoryDraft extends Draft {
  storyId: string
  component?: string
  text: string
  kind: "new" | "reply"
}

interface LogosCommentLayerWindow extends Window {
  __LOGOS_STORY_COMMENT_LAYER_ACTIVE__?: string
}

interface DrawingSession {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  target: Element
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
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


function postPopoverShow(payload: {
  storyId: string
  component?: string
  selector: string
  label: string
  htmlContext?: string
  screenshotDataUrl?: string
  kind: "thread" | "composer"
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  viewport: { width: number; height: number }
}): void {
  try {
    window.parent.postMessage({ type: "logos:story-popover-show", ...payload }, "*")
  } catch {}
}

function postPopoverHide(): void {
  try {
    window.parent.postMessage({ type: "logos:story-popover-hide" }, "*")
  } catch {}
}

function onGoalsFromStudio(
  cb: (goals: StoryComment[], workspaceKind: "code", drafts: StoryDraft[]) => void,
): () => void {
  const handler = (e: MessageEvent) => {
    const data: unknown = e.data
    if (!isRecord(data) || data["type"] !== "logos:story-goals") return
    cb(
      Array.isArray(data["goals"]) ? data["goals"] as StoryComment[] : [],
      "code",
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

function createDrawingCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas")
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr))
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr))
  canvas.style.cssText = [
    "position:fixed",
    "inset:0",
    `width:${window.innerWidth}px`,
    `height:${window.innerHeight}px`,
    "z-index:2147482999",
    "pointer-events:none",
  ].join(";")
  const context = canvas.getContext("2d")
  if (context == null) return null
  context.scale(dpr, dpr)
  context.lineCap = "round"
  context.lineJoin = "round"
  context.lineWidth = 4
  context.strokeStyle = "#dc2626"
  document.documentElement.appendChild(canvas)
  return { canvas, context }
}

function annotationScreenshotDataUrl(canvas: HTMLCanvasElement): string | undefined {
  try {
    const dataUrl = canvas.toDataURL("image/png")
    return dataUrl.startsWith("data:image/png;base64,") ? dataUrl : undefined
  } catch {
    return undefined
  }
}

function cloneWithInlineStyles(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))]
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]
  sourceNodes.forEach((node, index) => {
    const cloneNode = cloneNodes[index]
    if (cloneNode == null) return
    cloneNode.style.cssText = window.getComputedStyle(node).cssText
  })
  return clone
}

async function captureAnnotatedScreenshot(root: HTMLElement, annotationCanvas: HTMLCanvasElement): Promise<string | undefined> {
  const fallback = annotationScreenshotDataUrl(annotationCanvas)
  const output = document.createElement("canvas")
  output.width = Math.max(1, window.innerWidth)
  output.height = Math.max(1, window.innerHeight)
  const context = output.getContext("2d")
  if (context == null) return fallback

  try {
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, output.width, output.height)
    const rect = root.getBoundingClientRect()
    const clone = cloneWithInlineStyles(root)
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml")
    const serialized = new XMLSerializer().serializeToString(clone)
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}">`,
      `<foreignObject x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}">`,
      serialized,
      "</foreignObject></svg>",
    ].join("")
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("timed out loading serialized story screenshot")), 150)
      image.onload = () => {
        window.clearTimeout(timeout)
        resolve()
      }
      image.onerror = () => {
        window.clearTimeout(timeout)
        reject(new Error("failed to load serialized story screenshot"))
      }
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    context.drawImage(image, 0, 0)
    context.drawImage(annotationCanvas, 0, 0, output.width, output.height)
    return annotationScreenshotDataUrl(output) ?? fallback
  } catch {
    return fallback
  }
}

async function buildDrawingDraft(root: HTMLElement, session: DrawingSession): Promise<Draft> {
  const screenshotDataUrl = await captureAnnotatedScreenshot(root, session.canvas)
  return {
    selector: cssPath(session.target, root),
    label: describeElement(session.target),
    htmlContext: appendAnnotationContext(describeHtmlContext(session.target, root), session),
    ...(screenshotDataUrl != null ? { screenshotDataUrl } : {}),
    kind: "new",
  }
}

function appendAnnotationContext(htmlContext: string, session: DrawingSession): string {
  const left = Math.round(Math.min(session.startX, session.lastX))
  const top = Math.round(Math.min(session.startY, session.lastY))
  const width = Math.round(Math.abs(session.lastX - session.startX))
  const height = Math.round(Math.abs(session.lastY - session.startY))
  return [
    htmlContext,
    `annotation: Alt-drag drawing from viewport (${Math.round(session.startX)}, ${Math.round(session.startY)}) to (${Math.round(session.lastX)}, ${Math.round(session.lastY)}); bounds ${left},${top} ${width}x${height}`,
  ].join("\n")
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
  const drawingRef = useRef<DrawingSession | null>(null)
  const annotationPreviewRef = useRef<HTMLCanvasElement | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])
  const identity = portableStoryIdentity()
  const effectiveStoryId = identity?.storyId ?? storyId
  const effectiveComponent = identity?.component ?? component

  const clearAnnotationPreview = useCallback(() => {
    annotationPreviewRef.current?.remove()
    annotationPreviewRef.current = null
  }, [])

  useEffect(() => {
    if (!layerActive) return undefined
    return releaseStoryCommentLayer
  }, [layerActive])

  useEffect(() => {
    if (!layerActive) return undefined
    return onGoalsFromStudio((goals, _kind, drafts) => {
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
    clearAnnotationPreview()
    postPopoverHide()
  }, [clearAnnotationPreview, effectiveStoryId, layerActive])

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
    const onMouseDown = (e: MouseEvent) => {
      if (!e.altKey || e.button !== 0) return
      const target = e.target as Element
      const rootEl = rootRef.current
      if (!inStory(target) || rootEl == null) return
      clearAnnotationPreview()
      const drawing = createDrawingCanvas()
      if (drawing == null) return
      drawing.context.beginPath()
      drawing.context.moveTo(e.clientX, e.clientY)
      drawingRef.current = {
        canvas: drawing.canvas,
        context: drawing.context,
        target,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      const session = drawingRef.current
      if (session == null) return
      e.preventDefault()
      e.stopPropagation()
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (Math.hypot(dx, dy) >= 4) session.moved = true
      session.lastX = e.clientX
      session.lastY = e.clientY
      session.context.lineTo(e.clientX, e.clientY)
      session.context.stroke()
    }
    const onMouseUp = (e: MouseEvent) => {
      const session = drawingRef.current
      if (session == null) return
      drawingRef.current = null
      if (!session.moved) {
        session.canvas.remove()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      suppressClickUntilRef.current = Date.now() + 500
      const rootEl = rootRef.current
      if (rootEl == null) {
        session.canvas.remove()
        return
      }
      annotationPreviewRef.current = session.canvas
      void buildDrawingDraft(rootEl, session).then(setDraft)
      setOpenSelector(null)
      setHover(null)
    }
    document.addEventListener("mousedown", onMouseDown, true)
    document.addEventListener("mousemove", onMouseMove, true)
    document.addEventListener("mouseup", onMouseUp, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true)
      document.removeEventListener("mousemove", onMouseMove, true)
      document.removeEventListener("mouseup", onMouseUp, true)
      drawingRef.current?.canvas.remove()
      drawingRef.current = null
      clearAnnotationPreview()
    }
  }, [clearAnnotationPreview, enabled, inStory, layerActive])

  useEffect(() => {
    if (!layerActive || !enabled) return
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return
      if (Date.now() < suppressClickUntilRef.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const target = e.target as Element
      const rootEl = rootRef.current
      if (!inStory(target) || rootEl == null) return
      e.preventDefault()
      e.stopPropagation()
      clearAnnotationPreview()
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
  }, [clearAnnotationPreview, enabled, inStory, layerActive])

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
  const rootLabel = effectiveComponent ?? effectiveStoryId

  const viewportInfo = () => ({ width: window.innerWidth, height: window.innerHeight })

  const rectInfo = (r: DOMRect) => ({
    left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
  })

  const showPopover = useCallback((kind: "thread" | "composer", selector: string, label: string, rect: DOMRect, extra?: { htmlContext?: string; screenshotDataUrl?: string }) => {
    postPopoverShow({
      storyId: effectiveStoryId,
      ...(effectiveComponent != null ? { component: effectiveComponent } : {}),
      selector,
      label,
      ...(extra?.htmlContext != null ? { htmlContext: extra.htmlContext } : {}),
      ...(extra?.screenshotDataUrl != null ? { screenshotDataUrl: extra.screenshotDataUrl } : {}),
      kind,
      rect: rectInfo(rect),
      viewport: viewportInfo(),
    })
  }, [effectiveComponent, effectiveStoryId])

  useEffect(() => {
    if (!layerActive || !root) return
    if (openSelector != null) {
      const list = groups.get(openSelector)
      if (list != null) {
        const nearest = resolveNearestSelector(root, openSelector)
        const selector = nearest.selector
        const label = selector === openSelector ? list[0]?.label ?? openSelector : rootLabel
        showPopover("thread", selector, label, nearest.element.getBoundingClientRect())
      }
    } else if (draft != null && draft.kind !== "reply") {
      const nearest = resolveNearestSelector(root, draft.selector)
      const rect = nearest.element.getBoundingClientRect()
      showPopover("composer", draft.selector, draft.label, rect, {
        ...(draft.htmlContext != null ? { htmlContext: draft.htmlContext } : {}),
        ...(draft.screenshotDataUrl != null ? { screenshotDataUrl: draft.screenshotDataUrl } : {}),
      })
    }
  })

  useEffect(() => {
    if (!layerActive) return
    const handler = (e: MessageEvent) => {
      const data: unknown = e.data
      if (!isRecord(data)) return
      if (data["type"] === "logos:story-popover-closed") {
        setOpenSelector(null)
        setDraft(null)
        clearAnnotationPreview()
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [clearAnnotationPreview, layerActive])

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
                clearAnnotationPreview()
                if (openSelector === selector) {
                  setOpenSelector(null)
                  setDraft(null)
                  postPopoverHide()
                } else {
                  setOpenSelector(selector)
                  setDraft(null)
                }
              }}
            />
          )
        })}

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
