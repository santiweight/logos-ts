/* eslint-disable prefer-const, @typescript-eslint/prefer-readonly, @typescript-eslint/no-dynamic-delete, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars */
import { spawn, type ChildProcess } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { resolve, basename, extname } from "node:path"
import type { LogosRuntimeStore } from "./runtime-store.js"

export interface SbEntry {
  id: string
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

export type SbStatus = "starting" | "ready" | "failed"

export interface SbState {
  status: SbStatus
  startedAt: number
  updatedAt: number
  logs: string[]
  error?: string
}

type Registry = Record<string, SbEntry>

const MAX_LOG_LINES = 50

export class StorybookManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private stopping = new Set<string>()
  private pending = new Map<string, Promise<string>>()
  private states = new Map<string, SbState>()
  private store: LogosRuntimeStore
  private logosSrc: string
  private projectRoot: string

  constructor(store: LogosRuntimeStore, logosSrc: string, projectRoot: string) {
    this.store = store
    this.logosSrc = logosSrc
    this.projectRoot = projectRoot
    this.registry = this.store.listStorybooks()
    this.states = new Map(Object.entries(this.store.listStorybookStates()))
  }

  private save(): void {
    this.store.saveStorybooks(this.registry)
  }

  private saveState(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    this.store.saveStorybookState({ id, ...state })
  }

  private setState(id: string, state: SbState): SbState {
    this.states.set(id, state)
    this.saveState(id)
    return state
  }

  private clearState(id: string): void {
    this.states.delete(id)
    this.store.deleteStorybookState(id)
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** On startup, reconnect to still-alive processes and purge dead ones. */
  cleanupAll(): void {
    for (const [id, entry] of Object.entries(this.registry)) {
      if (this.isAlive(entry.pid)) {
        console.log(`[storybook-mgr] reconnected ${id} on port ${entry.port} (pid ${entry.pid})`)
        if (!this.states.get(id)) {
          this.setState(id, {
            status: "ready",
            startedAt: entry.startedAt,
            updatedAt: Date.now(),
            logs: [],
          })
        }
      } else {
        console.log(`[storybook-mgr] purging stale ${id} (pid ${entry.pid} dead)`)
        delete this.registry[id]
        this.setState(id, {
          status: "failed",
          startedAt: entry.startedAt,
          updatedAt: Date.now(),
          logs: [],
          error: `storybook process ${entry.pid} is no longer running`,
        })
      }
    }
    this.save()
  }

  /** Get the URL for a workspace, or null if not running. */
  get(id: string): string | null {
    const entry = this.registry[id]
    if (!entry) return null
    if (!this.isAlive(entry.pid)) {
      delete this.registry[id]
      this.live.delete(id)
      this.save()
      const state = this.states.get(id)
      this.setState(id, {
        status: "failed",
        startedAt: state?.startedAt ?? entry.startedAt,
        updatedAt: Date.now(),
        logs: state?.logs ?? [],
        error: `storybook process ${entry.pid} is no longer running`,
      })
      return null
    }
    return entry.url
  }

  /** Get all entries (for the API). */
  all(): Record<string, SbEntry> {
    return { ...this.registry }
  }

  /** Get startup state for a workspace (status, logs, error). */
  state(id: string): SbState | null {
    return this.states.get(id) ?? null
  }

  /** Get all startup states. */
  allStates(): Record<string, SbState> {
    const out: Record<string, SbState> = {}
    for (const [id, s] of this.states) out[id] = s
    return out
  }

  private pushLog(id: string, line: string): void {
    const s = this.states.get(id)
    if (!s) return
    s.logs.push(line)
    if (s.logs.length > MAX_LOG_LINES) s.logs.shift()
    s.updatedAt = Date.now()
    this.saveState(id)
  }

  private prepareCommentBridge(frontendDir: string): void {
    const configDir = resolve(frontendDir, ".storybook")
    if (!existsSync(configDir)) return

    const bridgeDir = resolve(configDir, ".logos")
    mkdirSync(bridgeDir, { recursive: true })
    copyFileSync(resolve(this.logosSrc, "../studio/src/comment-ui.tsx"), resolve(bridgeDir, "comment-ui.tsx"))
    copyFileSync(resolve(this.logosSrc, "../studio/src/icons.tsx"), resolve(bridgeDir, "icons.tsx"))
    writeFileSync(resolve(bridgeDir, "comment-store.ts"), STORYBOOK_COMMENT_STORE)
    writeFileSync(resolve(bridgeDir, "CommentLayer.tsx"), STORYBOOK_COMMENT_LAYER)

    const previewNames = ["preview.tsx", "preview.ts", "preview.jsx", "preview.js"]
    const existingPreview = previewNames.map((name) => resolve(configDir, name)).find((file) => existsSync(file))
    const previewFile = existingPreview ?? resolve(configDir, "preview.ts")
    const ext = extname(previewFile) || ".ts"
    const userPreview = resolve(configDir, `preview.logos-user${ext}`)

    if (existsSync(previewFile)) {
      const previewText = readFileSync(previewFile, "utf8")
      if (previewText.includes("withLogosComments")) return
      if (!existsSync(userPreview)) renameSync(previewFile, userPreview)
    } else {
      writeFileSync(userPreview, "const preview = {}\nexport default preview\n")
    }

    writeFileSync(previewFile, previewWrapper(`./${basename(userPreview, ext)}`))
  }

  prepare(frontendDir: string): void {
    this.prepareCommentBridge(frontendDir)
  }

  /**
   * Ensure a Storybook is running for the given workspace.
   * Returns a promise that resolves with the URL once the port is detected.
   * If already running, resolves immediately.
   */
  ensure(id: string, frontendDir: string): Promise<string> {
    const existing = this.get(id)
    if (existing) return Promise.resolve(existing)
    const pending = this.pending.get(id)
    if (pending) return pending

    const state = this.setState(id, { status: "starting", startedAt: Date.now(), updatedAt: Date.now(), logs: [] })

    const promise = new Promise<string>((resolve_, reject) => {
      this.prepareCommentBridge(frontendDir)
      const npx = resolve(frontendDir, "node_modules/.bin/storybook")
      // node_modules is symlinked to the shared install, so Vite's default
      // cacheDir (node_modules/.vite) would be shared by every concurrent
      // instance — point each instance at its own cache inside the fork.
      const cacheDir = resolve(frontendDir, ".vite-logos")
      const child = spawn(npx, ["dev", "--ci", "--no-open", "--host", "127.0.0.1"], {
        cwd: frontendDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CACHE_DIR: resolve(this.projectRoot, ".logos_cache", id),
          LOGOS_TS_SRC: this.logosSrc,
          LOGOS_PROJECT_ROOT: this.projectRoot,
          LOGOS_STORYBOOK_BASE: `/storybooks/${encodeURIComponent(id)}/`,
          LOGOS_SB_CACHE_DIR: cacheDir,
          // Ownership tag: lets `ps -E` / a sweeper identify strays from dead sessions.
          LOGOS_SESSION: basename(this.projectRoot),
          LOGOS_WS: id,
        },
      })

      let resolved = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const fail = (error: string) => {
        state.status = "failed"
        state.error = error
        state.updatedAt = Date.now()
        this.saveState(id)
        if (!resolved) {
          resolved = true
          if (timeout) clearTimeout(timeout)
          reject(new Error(error))
        }
      }

      child.on("error", (e) => {
        console.error(`[storybook-mgr] ${id} error:`, e.message)
        fail(e.message)
      })

      if (!child.pid) {
        fail(`failed to spawn storybook for ${id}`)
        return
      }

      this.live.set(id, child)
      timeout = setTimeout(() => {
        // Give up and reap the child so an unregistered Storybook isn't leaked.
        try { child.kill() } catch {}
        this.live.delete(id)
        fail(`storybook for ${id} did not print a port within 120s`)
      }, 120_000)

      const bufferLines = (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          const trimmed = line.trim()
          if (trimmed) this.pushLog(id, trimmed)
        }
      }

      // Accumulate stdout across chunks — the URL can be split mid-line.
      let stdoutBuf = ""
      child.stdout.on("data", (d: Buffer) => {
        bufferLines(d)
        stdoutBuf += d.toString()
        const m = stdoutBuf.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/)
        if (m != null && m[1] != null && !resolved) {
          resolved = true
          clearTimeout(timeout)
          const port = parseInt(m[1], 10)
          const url = `http://127.0.0.1:${port}`
          const pid = child.pid
          if (pid == null) {
            fail(`failed to get pid from storybook child process`)
            return
          }
          const entry: SbEntry = {
            id,
            pid,
            port,
            url,
            cwd: frontendDir,
            startedAt: Date.now(),
          }
          this.registry[id] = entry
          state.status = "ready"
          delete state.error
          state.updatedAt = Date.now()
          this.save()
          this.saveState(id)
          console.log(`[storybook-mgr] ${id} ready on ${url} (pid ${child.pid})`)
          resolve_(url)
        }
      })
      child.stderr.on("data", bufferLines)
      child.on("close", (code) => {
        console.log(`[storybook-mgr] ${id} exited (code ${code})`)
        delete this.registry[id]
        this.live.delete(id)
        this.save()
        if (this.stopping.delete(id)) return
        fail(`storybook for ${id} exited with code ${code}`)
      })
    })
    this.pending.set(id, promise)
    promise.finally(() => this.pending.delete(id)).catch(() => undefined)
    return promise
  }

  /** Kill a specific workspace's Storybook. */
  shutdown(id: string): void {
    const entry = this.registry[id]
    if (entry) {
      this.stopping.add(id)
      try { process.kill(entry.pid, "SIGTERM") } catch {}
      delete this.registry[id]
      this.save()
      this.clearState(id)
    }
    this.pending.delete(id)
    const child = this.live.get(id)
    if (child) {
      this.stopping.add(id)
      try { child.kill() } catch {}
      this.live.delete(id)
    }
    this.clearState(id)
  }

  /** Kill all tracked Storybook processes. */
  shutdownAll(): void {
    for (const id of Object.keys(this.registry)) {
      this.shutdown(id)
    }
  }
}

function previewWrapper(userPreviewImport: string): string {
  return `import * as userPreviewModule from "${userPreviewImport}"
import { withLogosComments } from "./.logos/CommentLayer"

const userDefault = (userPreviewModule as any).default ?? {}
const userDecorators = [
  ...((userPreviewModule as any).decorators ?? []),
  ...(userDefault.decorators ?? []),
]

const preview = {
  ...userPreviewModule,
  ...userDefault,
  decorators: [...userDecorators, withLogosComments],
}

export default preview
`
}

const STORYBOOK_COMMENT_STORE = `// Generated by Logos. Storybook preview <-> Studio bridge.

export interface StoryComment {
  id: string
  storyId: string
  selector: string
  label: string
  text: string
  author?: string
  createdAt: number
  component?: string
  htmlContext?: string
  mode?: string
  status?: string
  replies?: { author: "agent" | "user"; text: string; createdAt: number }[]
}

export function postComment(comment: Omit<StoryComment, "id" | "createdAt"> & { fork?: boolean }): void {
  try {
    window.parent?.postMessage({ type: "logos:story-comment", ...comment }, "*")
  } catch {}
}

export function postReady(storyId: string): void {
  try {
    window.parent?.postMessage({ type: "logos:story-ready", storyId }, "*")
  } catch {}
}

export function postCommentEditing(storyId: string, active: boolean): void {
  try {
    window.parent?.postMessage({ type: "logos:story-comment-editing", storyId, active }, "*")
  } catch {}
}

export function postCommentDraft(draft: (Omit<StoryComment, "id" | "createdAt" | "author" | "status"> & { text: string; mode: "code" | "arch"; fork: boolean; kind: "new" | "reply" }) | { storyId: string; active: false }): void {
  try {
    window.parent?.postMessage({ type: "logos:story-comment-draft", ...draft }, "*")
  } catch {}
}

export function onGoalsFromStudio(cb: (goals: StoryComment[], workspaceKind: "code" | "arch", drafts: any[]) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "logos:story-goals") {
      const kind = event.data.workspaceKind === "arch" ? "arch" : "code"
      cb(event.data.goals as StoryComment[], kind, Array.isArray(event.data.drafts) ? event.data.drafts : [])
    }
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}

export function cssPath(el: Element, root: Element): string {
  if (el === root) return ":scope"
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    let part = node.tagName.toLowerCase()
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
    if (sameTag.length > 1) part += \`:nth-of-type(\${sameTag.indexOf(node) + 1})\`
    parts.unshift(part)
    node = parent === root ? null : parent
    if (parent === root) break
  }
  return parts.length ? ":scope > " + parts.join(" > ") : ":scope"
}

export function resolve(root: Element, selector: string): Element | null {
  try {
    return selector === ":scope" ? root : root.querySelector(selector)
  } catch {
    return null
  }
}

export function resolveNearest(root: Element, selector: string): { selector: string; element: Element } {
  const exact = resolve(root, selector)
  if (exact) return { selector, element: exact }
  if (!selector.startsWith(":scope > ")) return { selector: ":scope", element: root }
  const parts = selector.slice(":scope > ".length).split(" > ")
  for (let i = parts.length - 1; i > 0; i--) {
    const parentSelector = ":scope > " + parts.slice(0, i).join(" > ")
    const element = resolve(root, parentSelector)
    if (element) return { selector: parentSelector, element }
  }
  return { selector: ":scope", element: root }
}

export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 32)
  return text ? \`\${tag} "\${text}"\` : \`<\${tag}>\`
}

export function describeHtmlContext(el: Element, root: Element): string {
  const parts = ["selected: " + elementContextLine(el)]
  const parent = el.parentElement
  if (parent && parent !== root) parts.push("parent: " + elementContextLine(parent))
  return parts.join("\\n")
}

function elementContextLine(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const attrs = ["role", "aria-label", "title", "class"]
    .map((name) => {
      const value = el.getAttribute(name)
      return value ? name + "=\\"" + value.trim().slice(0, 64) + "\\"" : null
    })
    .filter(Boolean)
    .join(" ")
  const text = (el.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 140)
  return "<" + tag + (attrs ? " " + attrs : "") + ">" + text + "</" + tag + ">"
}
`

const STORYBOOK_COMMENT_LAYER = `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Decorator } from "@storybook/react"
import {
  postComment,
  postReady,
  postCommentEditing,
  postCommentDraft,
  onGoalsFromStudio,
  cssPath,
  describe,
  describeHtmlContext,
  resolve,
  resolveNearest,
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
} from "./comment-ui"

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

function componentNameFromContext(context: any): string | undefined {
  const component = context.component
  return component?.displayName ?? component?.name ?? context.title?.split("/").at(-1)
}

export const withLogosComments: Decorator = (Story, context) => (
  <CommentLayer storyId={context.id} component={componentNameFromContext(context)}>
    <Story />
  </CommentLayer>
)

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
  const [workspaceKind, setWorkspaceKind] = useState<"code" | "arch">("code")
  const [comments, setComments] = useState<StoryComment[]>([])
  const [altDown, setAltDown] = useState(false)
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [openSelector, setOpenSelector] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    postReady(storyId)
    return onGoalsFromStudio((goals, kind, drafts) => {
      setComments(goals.filter((goal) => goal.storyId === storyId))
      setWorkspaceKind(kind)
      const restored = drafts.find((draft) => draft.storyId === storyId && typeof draft.text === "string" && draft.text.trim())
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
    const onDown = (event: KeyboardEvent) => {
      if (event.key === "Alt" || event.ctrlKey || event.metaKey) setAltDown(true)
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.key === "Alt" || !event.altKey && !event.ctrlKey && !event.metaKey) {
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
    const onMove = (event: MouseEvent) => {
      const target = event.target as Element
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
    const onClick = (event: MouseEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) return
      const target = event.target as Element
      if (!inStory(target) || !rootRef.current) return
      event.preventDefault()
      event.stopPropagation()
      setDraft({
        selector: cssPath(target, rootRef.current),
        label: describe(target),
        htmlContext: describeHtmlContext(target, rootRef.current),
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
    for (const comment of comments) {
      const selector = comment.selector
      if (!selector) continue
      const list = map.get(selector) ?? []
      list.push(comment)
      map.set(selector, list)
    }
    return map
  }, [comments])

  const root = rootRef.current

  const sendComment = (selector: string, label: string, htmlContext: string | undefined, payload: SubmitPayload) => {
    postComment({
      storyId,
      component,
      selector,
      label,
      ...(htmlContext ? { htmlContext } : {}),
      text: payload.text,
      author: "you",
      mode: payload.mode,
      fork: payload.fork,
    })
  }

  const sendCommentEditing = useCallback((active: boolean) => {
    postCommentEditing(storyId, active)
  }, [storyId])

  const clearCommentDraft = useCallback(() => {
    postCommentDraft({ storyId, active: false })
    sendCommentEditing(false)
  }, [sendCommentEditing, storyId])

  const sendCommentDraft = useCallback((draftUpdate: Draft, payload: SubmitPayload) => {
    if (!payload.text.trim()) {
      postCommentDraft({ storyId, active: false })
      sendCommentEditing(false)
      return
    }
    postCommentDraft({
      storyId,
      component,
      selector: draftUpdate.selector,
      label: draftUpdate.label,
      ...(draftUpdate.htmlContext ? { htmlContext: draftUpdate.htmlContext } : {}),
      text: payload.text,
      mode: payload.mode,
      fork: payload.fork,
      kind: draftUpdate.kind ?? "new",
    })
    sendCommentEditing(true)
  }, [component, sendCommentEditing, storyId])

  useEffect(() => clearCommentDraft, [clearCommentDraft])

  const rootLabel = component ?? storyId

  const saveDraft = (payload: SubmitPayload) => {
    if (!draft) return
    const rootEl = rootRef.current
    if (!rootEl) throw new Error("Cannot attach comment because the story root disappeared.")
    const { selector } = resolveNearest(rootEl, draft.selector)
    const label = selector === draft.selector ? draft.label : rootLabel
    const htmlContext = selector === draft.selector ? draft.htmlContext : describeHtmlContext(rootEl, rootEl)
    sendComment(selector, label, htmlContext, payload)
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
                  setOpenSelector((current) => (current === selector ? null : selector))
                  setDraft(null)
                }}
              />
            )
          })}

        {enabled &&
          root &&
          openSelector &&
          (() => {
            const list = groups.get(openSelector)
            if (!list) return null
            const nearest = resolveNearest(root, openSelector)
            const selector = nearest.selector
            const label = selector === openSelector ? list[0]?.label ?? openSelector : rootLabel
            const rect = nearest.element.getBoundingClientRect()
            return (
              <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
                <CommentThread
                  label={label}
                  comments={list}
                  workspaceKind={workspaceKind}
                  onAdd={(payload) => {
                    sendComment(selector, label, describeHtmlContext(nearest.element, root), payload)
                    clearCommentDraft()
                    setDraft(null)
                  }}
                  initialDraft={draft?.kind === "reply" && draft.selector === openSelector ? draft : undefined}
                  onDraftChange={(payload) => {
                    const replyDraft = { selector: openSelector, label, kind: "reply" as const, ...payload }
                    setDraft(replyDraft)
                    sendCommentDraft(replyDraft, payload)
                  }}
                  onEditingChange={sendCommentEditing}
                  onClose={() => { clearCommentDraft(); setOpenSelector(null); setDraft(null) }}
                />
              </div>
            )
          })()}

        {enabled && draft && draft.kind !== "reply" && (
          (() => {
            const nearest = root ? resolveNearest(root, draft.selector) : null
            const rect = nearest?.element.getBoundingClientRect() ?? new DOMRect()
            return (
              <div style={{ ...popoverShell, ...popoverPos(rect), position: "absolute", pointerEvents: "auto" }}>
                <CommentComposer
                  label={draft.label}
                  workspaceKind={workspaceKind}
                  onSave={saveDraft}
                  onCancel={() => { clearCommentDraft(); setDraft(null) }}
                  initialDraft={draft}
                  onDraftChange={(payload) => {
                    const next = { ...draft, ...payload, kind: "new" as const }
                    setDraft(next)
                    sendCommentDraft(next, payload)
                  }}
                  onEditingChange={sendCommentEditing}
                />
              </div>
            )
          })()
        )}

        <CommentToolbar
          enabled={enabled}
          onToggle={() => setEnabled((value) => !value)}
          total={comments.length}
          altDown={altDown}
        />
      </div>
    </>
  )
}
`
