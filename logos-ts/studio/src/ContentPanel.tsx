/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-unnecessary-condition */
import { useCallback, useEffect, useRef, useState } from "react"
import { CommentCtx, DiffCtx, Row } from "./arch"
import { GraphView } from "./GraphView"
import type { GoalApi, DiffStatus, FileEntry, FileItem, SbState, Selection, View } from "./types"

interface Props {
  file: FileEntry
  selection: Selection
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: (() => void) | null
  onView: (view: View) => void
  onCapture: (storyId: string) => void
  comments: GoalApi["comments"]
  onComment: GoalApi["onComment"]
  diff: Record<string, DiffStatus>
}

export function ContentPanel({
  file,
  selection,
  storybookUrl,
  storybookState,
  onRetryStorybook,
  onView,
  onCapture,
  comments,
  onComment,
  diff,
}: Props) {
  const comp = file.component
  const symbol = selection.symbol
    ? file.items.find((it) => it.name === selection.symbol)
    : null

  const tabs: View[] = comp
    ? ["code", "arch", "story", "captured"]
    : ["code", "arch"]

  const label = symbol
    ? `${file.file} / ${symbol.kind === "class" ? "⬚" : "ƒ"} ${symbol.name}`
    : comp && selection.view === "arch"
      ? `${comp.name} / arch`
      : comp && selection.view === "story"
        ? `${comp.name} / ${storyExport(comp, selection.storyId)}`
        : comp && selection.view === "captured"
          ? `${comp.name} / ${selection.exportName} ⟨captured⟩`
          : comp
            ? comp.name
            : file.file

  return (
    <CommentCtx.Provider value={{ comments, onComment }}>
      <DiffCtx.Provider value={diff}>
      <section className="content">
        <header className="content-header">
          <span className="crumb">{label}</span>
          <div className="tabs">
            {tabs.map((t) => (
              <button
                key={t}
                className={`tab ${selection.view === t ? "active" : ""}`}
                onClick={() => onView(t)}
              >
                {t === "code" ? "Code" : t === "arch" ? "Arch" : t === "story" ? "Story" : "Captured"}
              </button>
            ))}
          </div>
        </header>

        <div className="content-body">
          {selection.view === "arch" && <GraphView focusFile={file.file} />}
          {selection.view === "story" && comp && (
            <StoryView
              {...(selection.storyId != null ? { storyId: selection.storyId } : {})}
              storybookUrl={storybookUrl}
              storybookState={storybookState}
              onRetryStorybook={onRetryStorybook}
              onCapture={onCapture}
            />
          )}
          {selection.view === "captured" && comp && (
            <CapturedView component={comp} exportName={selection.exportName} storybookUrl={storybookUrl} />
          )}
          {selection.view === "code" && symbol && <SymbolView item={symbol} />}
          {selection.view === "code" && !symbol && comp && <ComponentCodeView component={comp} />}
          {selection.view === "code" && !symbol && !comp && <FileCodeView file={file} />}
        </div>
      </section>
      </DiffCtx.Provider>
    </CommentCtx.Provider>
  )
}

function storyExport(c: NonNullable<FileEntry["component"]>, storyId?: string): string {
  return c.stories.find((s) => s.id === storyId)?.exportName ?? c.stories[0]?.exportName ?? "—"
}

function ComponentCodeView({ component }: { component: NonNullable<FileEntry["component"]> }) {
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
        {(item.methods ?? []).map((m) => (
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
  storybookUrl,
  storybookState,
  onRetryStorybook,
  onCapture,
}: {
  storyId?: string
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: (() => void) | null
  onCapture: (storyId: string) => void
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

  if (!storyId) return <div className="empty">No story selected.</div>

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
              {storybookState.logs.join("\n")}
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
            {storybookState.logs.join("\n")}
            <div ref={logsEndRef} />
          </pre>
        )}
      </div>
    )
  }

  const src = `${storybookUrl}/iframe.html?id=${storyId}&viewMode=story`
  return (
    <div className="pane">
      <div className="pane-path">
        <span>⟨live⟩ {src.replace(/^https?:\/\//, "")}</span>
        <button className="capture-btn" onClick={() => onCapture(storyId)}>
          📸 Capture as test
        </button>
      </div>
      <iframe className="story-frame" key={src} src={src} title={storyId} />
      <div className="hint">
        Requires a Storybook dev server running for this project.
      </div>
    </div>
  )
}

function extractSnapHtml(raw: string): string | null {
  const m = raw.match(/exports\[.*?\]\s*=\s*`"?([\s\S]*?)"?`;\s*$/m)
  if (!m) return null
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
      out.push({ type: "same", text: aLines[ai] })
      ai++; bi++
    } else if (bi < bLines.length && (ai >= aLines.length || !aLines.slice(ai).includes(bLines[bi]))) {
      out.push({ type: "add", text: bLines[bi] })
      bi++
    } else if (ai < aLines.length && (bi >= bLines.length || !bLines.slice(bi).includes(aLines[ai]))) {
      out.push({ type: "del", text: aLines[ai] })
      ai++
    } else {
      out.push({ type: "del", text: aLines[ai] })
      ai++
    }
  }
  return out
}

type SnapTab = "rendered" | "source" | "diff"

function SnapshotIframe({ html, storybookUrl, storyId }: { html: string; storybookUrl: string; storyId?: string }) {
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
  const src = `${storybookUrl}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`
  return (
    <iframe
      ref={iframeRef}
      className="story-frame"
      src={src}
      title="snapshot-render"
      onLoad={inject}
    />
  )
}

function CapturedView({
  component,
  exportName,
  storybookUrl,
}: {
  component: NonNullable<FileEntry["component"]>
  exportName?: string
  storybookUrl: string
}) {
  const [tab, setTab] = useState<SnapTab>("rendered")
  const cap = component.captured.find((c) => c.exportName === exportName) ?? component.captured[0]
  if (!cap) return <div className="empty">No captured tests for {component.name}.</div>

  const html = extractSnapHtml(cap.snapshot ?? "") ?? cap.snapshot ?? ""
  const formatted = formatHtml(html)
  const hasDiff = cap.previousSnapshot != null && cap.previousSnapshot !== cap.snapshot
  const prevHtml = hasDiff ? extractSnapHtml(cap.previousSnapshot!) ?? "" : null
  const diffResult = hasDiff ? diffLines(formatHtml(prevHtml!), formatted) : null

  const tabs: { id: SnapTab; label: string }[] = [
    { id: "rendered", label: "Rendered" },
    { id: "source", label: "Source" },
    ...(hasDiff ? [{ id: "diff" as const, label: "Diff" }] : []),
  ]

  return (
    <div className="pane">
      <div className="pane-path">
        <span className={`badge ${hasDiff ? "changed" : "ok"}`}>
          {hasDiff ? "~ changed" : "✓ captured"}
        </span>{" "}
        {cap.testFile}
      </div>
      <div className="snap-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`snap-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      {tab === "rendered" && storybookUrl && (
        <SnapshotIframe html={html} storybookUrl={storybookUrl} storyId={component.stories[0]?.id} />
      )}
      {tab === "rendered" && !storybookUrl && (
        <div className="empty">Waiting for Storybook to start…</div>
      )}
      {tab === "source" && (
        <pre className="code snap">{formatted}</pre>
      )}
      {tab === "diff" && diffResult && (
        <pre className="code snap snap-diff">{diffResult.map((l, i) => (
          <span key={i} className={`diff-line diff-${l.type}`}>{l.type === "add" ? "+" : l.type === "del" ? "-" : " "} {l.text}{"\n"}</span>
        ))}</pre>
      )}
    </div>
  )
}
