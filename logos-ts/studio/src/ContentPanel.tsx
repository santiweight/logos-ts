import { CommentCtx, DiffCtx, Row } from "./arch"
import { GraphView } from "./GraphView"
import type { CommentApi, ComponentEntry, DiffStatus, Selection, View } from "./types"

interface Props {
  component: ComponentEntry
  selection: Selection
  storybookUrl: string
  onView: (view: View) => void
  onCapture: (storyId: string) => void
  comments: CommentApi["comments"]
  onComment: CommentApi["onComment"]
  diff: Record<string, DiffStatus>
}

export function ContentPanel({
  component,
  selection,
  storybookUrl,
  onView,
  onCapture,
  comments,
  onComment,
  diff,
}: Props) {
  const tabs: View[] = ["code", "arch", "story", "captured"]
  const label =
    selection.view === "arch"
      ? `${component.name} / arch`
      : selection.view === "story"
        ? `${component.name} / ${storyExport(component, selection.storyId)}`
        : selection.view === "captured"
          ? `${component.name} / ${selection.exportName} ⟨captured⟩`
          : component.name

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
          {selection.view === "code" && <CodeView component={component} />}
          {selection.view === "arch" && <GraphView focusFile={component.file} />}
          {selection.view === "story" && (
            <StoryView
              storyId={selection.storyId}
              storybookUrl={storybookUrl}
              onCapture={onCapture}
            />
          )}
          {selection.view === "captured" && (
            <CapturedView component={component} exportName={selection.exportName} />
          )}
        </div>
      </section>
      </DiffCtx.Provider>
    </CommentCtx.Provider>
  )
}

function storyExport(c: ComponentEntry, storyId?: string): string {
  return c.stories.find((s) => s.id === storyId)?.exportName ?? c.stories[0]?.exportName ?? "—"
}

function CodeView({ component }: { component: ComponentEntry }) {
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
      <div className="deps">
        deps → {component.deps.map((d) => d.split("#")[1] ?? d).join(" · ") || "—"}
      </div>
    </div>
  )
}

function StoryView({
  storyId,
  storybookUrl,
  onCapture,
}: {
  storyId?: string
  storybookUrl: string
  onCapture: (storyId: string) => void
}) {
  if (!storyId) return <div className="empty">No story selected.</div>
  const src = `${storybookUrl}/iframe.html?id=${storyId}&viewMode=story`
  return (
    <div className="pane">
      <div className="pane-path">
        <span>⟨live⟩ {src.replace(/^https?:\/\//, "")}</span>
        <button className="capture-btn" onClick={() => onCapture(storyId)}>
          📸 Capture as test
        </button>
      </div>
      <iframe className="story-frame" src={src} title={storyId} />
    </div>
  )
}

function CapturedView({
  component,
  exportName,
}: {
  component: ComponentEntry
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
