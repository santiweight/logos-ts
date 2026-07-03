import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type IframeHTMLAttributes,
  type Ref,
} from "react"
import { CommentCtx, DiffCtx, Row } from "./arch"
import { contentPanelLabel } from "./content-label"
import { TerminalLog } from "./TerminalLog"
import type { ComponentEntry, GoalApi, DiffStatus, FileEntry, FileItem, RunState, RunTarget, SbState, Selection } from "./types"

export type StoryRenderer = "portable" | "storybook"

interface Props {
  file: FileEntry
  selection: Selection
  workspaceId: string | null
  storyRenderer: StoryRenderer
  storybookUrl: string
  storybookState: SbState | null
  storybookRenderKey: string
  storyCommentEditingByStoryId?: Record<string, boolean>
  onRetryStorybook: (() => void) | null
  showHeader?: boolean
  comments: GoalApi["comments"]
  onComment: GoalApi["onComment"]
  diff: Record<string, DiffStatus>
}

export function ContentPanel({
  file,
  selection,
  workspaceId,
  storyRenderer,
  storybookUrl,
  storybookState,
  storybookRenderKey,
  storyCommentEditingByStoryId = {},
  onRetryStorybook,
  showHeader = true,
  comments,
  onComment,
  diff,
}: Props) {
  const label = contentPanelLabel(file, selection)
  const comps = componentsOf(file)
  const comp = selection.component
    ? comps.find((candidate) => candidate.name === selection.component) ?? comps[0]
    : selection.storyId
      ? comps.find((candidate) => candidate.stories.some((story) => story.id === selection.storyId)) ?? comps[0]
      : comps[0]
  const symbol = selection.symbol
    ? file.items.find((it) => it.name === selection.symbol)
    : null
  const activeView = selection.view === "story" ? "story" : "code"

  return (
    <CommentCtx.Provider value={{ comments, onComment }}>
      <DiffCtx.Provider value={diff}>
      <section className="content">
        {showHeader && (
          <header className="content-header">
            <span className="crumb">{label}</span>
          </header>
        )}

        <div className="content-body">
          {activeView === "story" && comp && (
            <StoryView
              {...(selection.storyId != null ? { storyId: selection.storyId } : {})}
              workspaceId={workspaceId}
              storyRenderer={storyRenderer}
              storybookUrl={storybookUrl}
              storybookState={storybookState}
              storybookRenderKey={storybookRenderKey}
              storyCommentEditing={selection.storyId ? storyCommentEditingByStoryId[selection.storyId] === true : false}
              onRetryStorybook={onRetryStorybook}
            />
          )}
          {activeView === "code" && symbol && <SymbolView item={symbol} />}
          {activeView === "code" && !symbol && comp && <ComponentCodeView component={comp} />}
          {activeView === "code" && !symbol && !comp && <FileCodeView file={file} />}
        </div>
      </section>
      </DiffCtx.Provider>
    </CommentCtx.Provider>
  )
}

function componentsOf(file: FileEntry): ComponentEntry[] {
  return file.components?.length ? file.components : file.component ? [file.component] : []
}

function ComponentCodeView({ component }: { component: ComponentEntry }) {
  const fieldsDesc = component.propsFields.map((f) => `${f.name}: ${f.type}`).join("\n")
  return (
    <div className="content-body">
      <div className="rows">
        <Row
          tag="component"
          tagClass="cls"
          title={component.signature}
          code={component.componentCode}
          target={`component:${component.name}`}
          label={`<${component.name}/>`}
        />
        {component.propsName && (
          <Row
            tag="props"
            tagClass="impl"
            title={component.propsName}
            {...(fieldsDesc ? { desc: fieldsDesc } : {})}
            {...(component.propsCode != null ? { code: component.propsCode } : {})}
            target={`props:${component.propsName}`}
            label={component.propsName}
          />
        )}
      </div>
    </div>
  )
}

function SymbolView({ item }: { item: FileItem }) {
  if (item.kind === "function") {
    return (
      <div className="content-body">
        <div className="rows">
          <Row
            tag="impl"
            tagClass="impl"
            title={item.signature}
            code={item.code}
            target={`fn:${item.name}`}
            label={`ƒ ${item.name}`}
          />
          {item.tests.map((t) => (
            <Row
              key={t.name}
              tag="test"
              tagClass="test"
              title={t.name}
              {...(t.description != null ? { desc: t.description } : {})}
              code={t.code}
              indent
              target={`test:${t.file}::${t.name}`}
              label={`test · ${t.name}`}
            />
          ))}
        </div>
        <div className="deps">deps → {item.deps.join(" · ") || "—"}</div>
      </div>
    )
  }

  if (item.kind === "type") {
    return (
      <div className="content-body">
        <div className="rows">
          <Row
            tag="type"
            tagClass="type"
            title={item.signature}
            code={item.code}
            target={`type:${item.name}`}
            initialOpen
            label={`T ${item.name}`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="content-body">
      <div className="rows">
        <Row
          tag="class"
          tagClass="cls"
          title={`class ${item.name}`}
          code={item.code}
          target={`cls:${item.name}`}
          label={`⬚ ${item.name}`}
        />
        {item.tests.map((t) => (
          <Row
            key={t.name}
            tag="test"
            tagClass="test"
            title={t.name}
            {...(t.description != null ? { desc: t.description } : {})}
            code={t.code}
            indent
            target={`test:${t.file}::${t.name}`}
            label={`test · ${t.name}`}
          />
        ))}
        {item.methods.map((m) => (
          <div key={m.name}>
            <Row
              tag="method"
              tagClass="method"
              title={m.signature}
              code={m.code}
              target={`method:${item.name}.${m.name}`}
              label={`· ${m.name}`}
            />
            {m.tests.map((t) => (
              <Row
                key={t.name}
                tag="test"
                tagClass="test"
                title={t.name}
                {...(t.description != null ? { desc: t.description } : {})}
                code={t.code}
                indent
                target={`test:${t.file}::${t.name}`}
                label={`test · ${t.name}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="deps">deps → {item.deps.join(" · ") || "—"}</div>
    </div>
  )
}

function FileCodeView({ file }: { file: FileEntry }) {
  return (
    <div className="content-body">
      <div className="rows">
        {file.items.map((it) =>
          it.kind === "function" ? (
            <Row
              key={it.name}
              tag="fn"
              tagClass="impl"
              title={it.signature}
              code={it.code}
              target={`fn:${it.name}`}
              label={`ƒ ${it.name}`}
            />
          ) : it.kind === "type" ? (
            <Row
              key={it.name}
              tag="type"
              tagClass="type"
              title={it.signature}
              code={it.code}
              target={`type:${it.name}`}
              label={`T ${it.name}`}
            />
          ) : (
            <Row
              key={it.name}
              tag="class"
              tagClass="cls"
              title={`class ${it.name}`}
              code={it.code}
              target={`cls:${it.name}`}
              label={`⬚ ${it.name}`}
            />
          )
        )}
      </div>
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const sec = Math.floor((now - since) / 1000)
  return <>{sec}s</>
}

function StoryView({
  storyId,
  workspaceId,
  storyRenderer,
  storybookUrl,
  storybookState,
  storybookRenderKey,
  storyCommentEditing,
  onRetryStorybook,
}: {
  storyId?: string
  workspaceId: string | null
  storyRenderer: StoryRenderer
  storybookUrl: string
  storybookState: SbState | null
  storybookRenderKey: string
  storyCommentEditing: boolean
  onRetryStorybook: (() => void) | null
}) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [storybookState?.logs.length])

  // No server and no startup in flight (e.g. studio restarted, or the entry
  // was pruned): kick off a start instead of showing a spinner forever.
  const shouldAutoStart = !!onRetryStorybook && !storybookUrl && !storybookState
  useEffect(() => {
    if (shouldAutoStart) onRetryStorybook()
  }, [shouldAutoStart, onRetryStorybook])

  const portableParams = new URLSearchParams({ storyId: storyId ?? "", logosReload: storybookRenderKey })
  if (workspaceId) portableParams.set("workspaceId", workspaceId)
  const nextSrc = storyRenderer === "portable"
    ? `/portable-story.html?${portableParams.toString()}`
    : `${storybookUrl}/iframe.html?id=${storyId ?? ""}&viewMode=story&logosReload=${encodeURIComponent(storybookRenderKey)}`
  const src = useDeferredString(nextSrc, storyCommentEditing)
  if (!storyId) return <div className="empty">No story selected.</div>

  if (storyRenderer === "portable") {
    return (
      <div className="pane">
        <FittedIframe
          className="story-frame"
          sandbox="allow-scripts allow-forms allow-same-origin"
          src={src}
          title={storyId}
        />
      </div>
    )
  }

  if (!storybookUrl) {
    if (storybookState?.status === "failed") {
      return (
        <div className="sb-startup">
          <div className="sb-startup-header sb-failed">Storybook failed to start</div>
          {storybookState.error && <div className="sb-startup-error">{storybookState.error}</div>}
          {onRetryStorybook && (
            <button className="sb-retry-btn" onClick={onRetryStorybook}>↻ Retry</button>
          )}
          {storybookState.logs.length > 0 && (
            <pre className="sb-startup-logs">
              <TerminalLog lines={storybookState.logs} />
              <div ref={logsEndRef} />
            </pre>
          )}
        </div>
      )
    }

    return (
      <div className="sb-startup">
        <div className="sb-startup-header">
          <span className="ag-spin">⟳</span>{" "}
          Starting Storybook
          {storybookState?.startedAt && <> (<Elapsed since={storybookState.startedAt} />)</>}
          ...
        </div>
        {storybookState?.logs && storybookState.logs.length > 0 && (
          <pre className="sb-startup-logs">
            <TerminalLog lines={storybookState.logs} />
            <div ref={logsEndRef} />
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="pane">
      <FittedIframe className="story-frame" src={src} title={storyId} />
    </div>
  )
}

export function RunView({
  target,
  runUrl,
  runState,
  onRun,
}: {
  target: RunTarget | null
  runUrl: string
  runState: RunState | null
  onRun: ((targetId: string, restart?: boolean) => void) | null
}) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [runState?.logs.length])

  const shouldAutoStart = !!target && !!onRun && !runUrl && !runState
  useEffect(() => {
    if (shouldAutoStart && target) onRun(target.id)
  }, [shouldAutoStart, target, onRun])

  if (!target) return <div className="empty">No run selected.</div>

  if (!runUrl) {
    if (runState?.status === "failed") {
      return (
        <div className="sb-startup">
          <div className="sb-startup-header sb-failed">{target.label} failed to start</div>
          {runState.error && <div className="sb-startup-error">{runState.error}</div>}
          {onRun && (
            <button className="sb-retry-btn" onClick={() => onRun(target.id)}>▶ Play</button>
          )}
          {runState.logs.length > 0 && (
            <pre className="sb-startup-logs">
              <TerminalLog lines={runState.logs} />
              <div ref={logsEndRef} />
            </pre>
          )}
        </div>
      )
    }

    return (
      <div className="sb-startup">
        <div className="sb-startup-header">
          <span className="ag-spin">⟳</span>{" "}
          Starting {target.label}
          {runState?.startedAt && <> (<Elapsed since={runState.startedAt} />)</>}
          ...
        </div>
        {runState?.logs && runState.logs.length > 0 && (
          <pre className="sb-startup-logs">
            <TerminalLog lines={runState.logs} />
            <div ref={logsEndRef} />
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="pane">
      <div className="pane-path">
        <span>⟨run⟩ {target.label}</span>
        {onRun && (
          <button className="sb-retry-btn" onClick={() => onRun(target.id, true)}>↻ Restart</button>
        )}
      </div>
      <FittedIframe className="story-frame" src={runUrl} title={target.label} />
      <div className="hint">
        Running from {target.cwd} with hot reload when the underlying dev server supports it.
      </div>
    </div>
  )
}

function useDeferredString(value: string, defer: boolean): string {
  const [committedValue, setCommittedValue] = useState(value)
  useEffect(() => {
    if (!defer) setCommittedValue(value)
  }, [defer, value])
  return defer ? committedValue : value
}

function extractSnapHtml(raw: string): string | null {
  const m = raw.match(/exports\[.*?\]\s*=\s*`"?([\s\S]*?)"?`;\s*$/m)
  if (!m?.[1]) return null
  return m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\")
}

function formatHtml(html: string): string {
  let out = ""
  let indent = 0
  const tokens = html.split(/(<[^>]+>)/g).filter(Boolean)
  for (const tok of tokens) {
    if (tok.startsWith("</")) {
      indent = Math.max(0, indent - 1)
      out += "  ".repeat(indent) + tok + "\n"
    } else if (tok.startsWith("<") && !tok.endsWith("/>") && !tok.startsWith("<!")) {
      out += "  ".repeat(indent) + tok + "\n"
      indent++
    } else if (tok.startsWith("<")) {
      out += "  ".repeat(indent) + tok + "\n"
    } else if (tok.trim()) {
      out += "  ".repeat(indent) + tok + "\n"
    }
  }
  return out.trimEnd()
}

function diffLines(a: string, b: string): { type: "same" | "add" | "del"; text: string }[] {
  const aLines = a.split("\n")
  const bLines = b.split("\n")
  const out: { type: "same" | "add" | "del"; text: string }[] = []
  let ai = 0, bi = 0
  while (ai < aLines.length || bi < bLines.length) {
    if (ai < aLines.length && bi < bLines.length && aLines[ai] === bLines[bi]) {
      out.push({ type: "same", text: aLines[ai]! })
      ai++; bi++
    } else if (bi < bLines.length && (ai >= aLines.length || !aLines.slice(ai).includes(bLines[bi]!))) {
      out.push({ type: "add", text: bLines[bi]! })
      bi++
    } else if (ai < aLines.length && (bi >= bLines.length || !bLines.slice(bi).includes(aLines[ai]!))) {
      out.push({ type: "del", text: aLines[ai]! })
      ai++
    } else {
      out.push({ type: "del", text: aLines[ai]! })
      ai++
    }
  }
  return out
}

type SnapTab = "rendered" | "source" | "diff"

function SnapshotIframe({
  html,
  workspaceId,
  storyRenderer,
  storybookUrl,
  storybookRenderKey,
  storyId,
}: {
  html: string
  workspaceId: string | null
  storyRenderer: StoryRenderer
  storybookUrl: string
  storybookRenderKey: string
  storyId?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const htmlRef = useRef(html)
  htmlRef.current = html

  const inject = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const send = () => win.postMessage({ type: "logos:render-snapshot", html: htmlRef.current }, "*")
    send()
    setTimeout(send, 500)
    setTimeout(send, 1500)
  }, [])

  useEffect(() => {
    inject()
  }, [html, inject])

  const id = storyId ?? ""
  const params = new URLSearchParams({ storyId: id, logosReload: storybookRenderKey })
  if (workspaceId) params.set("workspaceId", workspaceId)
  const src = storyRenderer === "portable"
    ? `/portable-story.html?${params.toString()}`
    : `${storybookUrl}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&logosReload=${encodeURIComponent(storybookRenderKey)}`
  return (
    <FittedIframe
      ref={iframeRef}
      className="story-frame"
      src={src}
      title="snapshot-render"
      onLoad={inject}
    />
  )
}

const DEFAULT_FRAME_SIZE = { width: 1280, height: 800 }

type FrameSize = typeof DEFAULT_FRAME_SIZE

const FittedIframe = forwardRef<HTMLIFrameElement, IframeHTMLAttributes<HTMLIFrameElement>>(
  function FittedIframe({ className = "", onLoad, ...props }, forwardedRef) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [frameSize, setFrameSize] = useState<FrameSize>(DEFAULT_FRAME_SIZE)
    const [scale, setScale] = useState(1)
    const [loading, setLoading] = useState(true)

    const setIframeRef = useCallback((node: HTMLIFrameElement | null) => {
      iframeRef.current = node
      setForwardedRef(forwardedRef, node)
    }, [forwardedRef])

    const refit = useCallback((options: { focusIframe?: boolean } = {}) => {
      const viewport = viewportRef.current
      const iframe = iframeRef.current
      if (!viewport || !iframe) return

      const viewportRect = viewport.getBoundingClientRect()
      const nextFrameSize = measureIframeContent(iframe)
      setFrameSize(nextFrameSize)
      setScale(fitScale(viewportRect.width, nextFrameSize.width))
      if (options.focusIframe) iframe.focus()
    }, [])

    useEffect(() => {
      setLoading(true)
      refit()
      const viewport = viewportRef.current
      if (!viewport) return

      const ResizeObserverCtor = globalThis.ResizeObserver
      const observer = ResizeObserverCtor ? new ResizeObserverCtor(() => refit()) : null
      observer?.observe(viewport)
      const handleResize = () => refit()
      window.addEventListener("resize", handleResize)
      return () => {
        observer?.disconnect()
        window.removeEventListener("resize", handleResize)
      }
    }, [props.src, refit])

    const handleLoad = useCallback<NonNullable<IframeHTMLAttributes<HTMLIFrameElement>["onLoad"]>>((event) => {
      setLoading(false)
      onLoad?.(event)
      refit()
      window.setTimeout(refit, 250)
      window.setTimeout(refit, 1000)
    }, [onLoad, refit])

    return (
      <div className="fit-frame-shell">
        <div className="fit-frame-toolbar">
          <button
            className="fit-frame-btn"
            type="button"
            onClick={() => refit({ focusIframe: true })}
            aria-label="Refit preview"
            title="Refit preview"
          >
            Fit
          </button>
        </div>
        <div className="fit-frame-viewport" ref={viewportRef}>
          {loading && <div className="fit-frame-loading"><div className="fit-frame-spinner" /></div>}
          <div
            className="fit-frame-stage"
            style={{ width: `${frameSize.width * scale}px`, height: `${frameSize.height * scale}px` }}
          >
            <div
              className="fit-frame-canvas"
              style={{ width: `${frameSize.width}px`, height: `${frameSize.height}px`, transform: `scale(${scale})` }}
            >
              <iframe
                {...props}
                ref={setIframeRef}
                className={["story-frame", className].filter(Boolean).join(" ")}
                onLoad={handleLoad}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }
)

function setForwardedRef<T>(ref: Ref<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref) {
    ;(ref as { current: T | null }).current = value
  }
}

function measureIframeContent(iframe: HTMLIFrameElement): FrameSize {
  try {
    const doc = iframe.contentDocument
    const html = doc?.documentElement
    const body = doc?.body
    if (!html) return DEFAULT_FRAME_SIZE

    const bodyRect = body?.getBoundingClientRect()
    return {
      width: Math.ceil(Math.max(
        DEFAULT_FRAME_SIZE.width,
        html.scrollWidth,
        html.offsetWidth,
        html.clientWidth,
        body?.scrollWidth ?? 0,
        body?.offsetWidth ?? 0,
        bodyRect?.width ?? 0
      )),
      height: Math.ceil(Math.max(
        DEFAULT_FRAME_SIZE.height,
        html.scrollHeight,
        html.offsetHeight,
        html.clientHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
        bodyRect?.height ?? 0
      )),
    }
  } catch {
    return DEFAULT_FRAME_SIZE
  }
}

function fitScale(viewportWidth: number, frameWidth: number): number {
  if (viewportWidth <= 0 || frameWidth <= 0) return 1
  // Fit previews to the available width only. Tall pages should stay readable
  // and scroll vertically instead of shrinking into a full-page thumbnail.
  return Math.min(1, viewportWidth / frameWidth)
}
