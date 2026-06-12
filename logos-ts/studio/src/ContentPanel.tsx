import { useState, useEffect, useRef } from "react"
import { CommentCtx, DiffCtx, Row } from "./arch"
import { GraphView } from "./GraphView"
import type { GoalApi, DiffStatus, FileEntry, FileItem, SbState, Selection, View } from "./types"

interface Props {
  file: FileEntry
  selection: Selection
  storybookUrl: string
  storybookState: SbState | null
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
              storyId={selection.storyId}
              storybookUrl={storybookUrl}
              storybookState={storybookState}
              onCapture={onCapture}
            />
          )}
          {selection.view === "captured" && comp && (
            <CapturedView component={comp} exportName={selection.exportName} />
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
            desc={fieldsDesc || undefined}
            code={component.propsCode}
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
              desc={t.description}
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
            desc={t.description}
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
                desc={t.description}
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
  onCapture,
}: {
  storyId?: string
  storybookUrl: string
  storybookState: SbState | null
  onCapture: (storyId: string) => void
}) {
  const logsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [storybookState?.logs.length])

  if (!storyId) return <div className="empty">No story selected.</div>

  if (!storybookUrl) {
    if (storybookState?.status === "failed") {
      return (
        <div className="sb-startup">
          <div className="sb-startup-header sb-failed">Storybook failed to start</div>
          {storybookState.error && <div className="sb-startup-error">{storybookState.error}</div>}
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

function CapturedView({
  component,
  exportName,
}: {
  component: NonNullable<FileEntry["component"]>
  exportName?: string
}) {
  const cap = component.captured.find((c) => c.exportName === exportName) ?? component.captured[0]
  if (!cap) return <div className="empty">No captured tests for {component.name}.</div>
  return (
    <div className="pane">
      <div className="pane-path">
        <span className="badge ok">✓ captured</span> {cap.testFile}
      </div>
      <pre className="code snap">{cap.snapshot ?? "(snapshot not yet written — run vitest)"}</pre>
    </div>
  )
}
