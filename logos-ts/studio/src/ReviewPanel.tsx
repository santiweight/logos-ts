import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { indexToArchText, lineDiff, type DiffLine } from "./arch-text"
import {
  capturedTestChanges,
  extractSnapshotHtml,
  formatCapturedSnapshot,
  type CaptureChange,
} from "./review"
import type { SbState, StudioIndex } from "./types"

interface Props {
  base: StudioIndex
  workspace: StudioIndex
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: () => void
}

type ReviewTab = "architecture" | "captured"
type CaptureView = "visual" | "diff"

interface ReviewFileDiff {
  file: string
  lines: DiffLine[]
  add: number
  del: number
  status: "added" | "changed" | "removed"
}

export function ReviewPanel({
  base,
  workspace,
  storybookUrl,
  storybookState,
  onRetryStorybook,
}: Props) {
  const architectureLines = useMemo(
    () => lineDiff(indexToArchText(base), indexToArchText(workspace)),
    [base, workspace]
  )
  const captureChanges = useMemo(() => capturedTestChanges(base, workspace), [base, workspace])
  const architectureStats = useMemo(() => diffStats(architectureLines), [architectureLines])
  const [tab, setTab] = useState<ReviewTab>(captureChanges.length > 0 ? "captured" : "architecture")

  return (
    <section className="content review-panel">
      <header className="content-header review-header">
        <span className="crumb">Review workspace changes</span>
        <div className="tabs">
          <button
            className={`tab ${tab === "architecture" ? "active" : ""}`}
            onClick={() => setTab("architecture")}
          >
            Architecture
            {architectureStats.add + architectureStats.del > 0 &&
              ` +${architectureStats.add} -${architectureStats.del}`}
          </button>
          <button
            className={`tab ${tab === "captured" ? "active" : ""}`}
            onClick={() => setTab("captured")}
          >
            Captured tests {captureChanges.length}
          </button>
        </div>
      </header>
      <div className="content-body">
        {tab === "architecture" ? (
          <ArchitectureReview lines={architectureLines} stats={architectureStats} />
        ) : (
          <CapturedReview
            changes={captureChanges}
            storybookUrl={storybookUrl}
            storybookState={storybookState}
            onRetryStorybook={onRetryStorybook}
          />
        )}
      </div>
    </section>
  )
}

function diffStats(lines: DiffLine[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of lines) {
    if (line.type === "add") add++
    if (line.type === "del") del++
  }
  return { add, del }
}

function ArchitectureReview({
  lines,
  stats,
}: {
  lines: DiffLine[]
  stats: { add: number; del: number }
}) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  if (stats.add === 0 && stats.del === 0) {
    return <div className="empty">No architectural changes in this workspace.</div>
  }
  const files = splitArchitectureDiff(lines)
  const toggleFile = (file: string) => {
    setExpandedFiles((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  }
  return (
    <div className="arch-review">
      <div className="arch-review-summary">
        <span>{files.length} changed file{files.length === 1 ? "" : "s"}</span>
        <span className="review-stat-add">+{stats.add}</span>
        <span className="review-stat-del">-{stats.del}</span>
      </div>
      <div className="review-file-list">
        {files.map((file) => {
          const expanded = expandedFiles.has(file.file)
          return (
            <section key={file.file} className={`review-file-card ${expanded ? "expanded" : "collapsed"}`}>
              <button
                className="review-file-header"
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleFile(file.file)}
              >
                <div className="review-file-profile">
                  <span className={`review-file-avatar ${file.status}`}>
                    {file.status === "added" ? "+" : file.status === "removed" ? "-" : "~"}
                  </span>
                  <div>
                    <strong>{file.file}</strong>
                    <small>{file.status}{expanded ? "" : " - click to expand"}</small>
                  </div>
                </div>
                <div className="review-file-stats">
                  {file.add > 0 && <span className="review-stat-add">+{file.add}</span>}
                  {file.del > 0 && <span className="review-stat-del">-{file.del}</span>}
                  <span className="review-expand-mark">{expanded ? "-" : "+"}</span>
                </div>
              </button>
              {expanded && (
                <pre className="inline-diff">
                  {file.lines.map((line, index) => (
                    <CodeDiffRow key={`${file.file}-${index}`} line={line} />
                  ))}
                </pre>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function splitArchitectureDiff(lines: DiffLine[]): ReviewFileDiff[] {
  const files: ReviewFileDiff[] = []
  let current: ReviewFileDiff | null = null

  const pushCurrent = () => {
    if (current == null || (current.add === 0 && current.del === 0)) return
    current.status =
      current.add > 0 && current.del === 0 ? "added" :
        current.del > 0 && current.add === 0 ? "removed" :
          "changed"
    files.push(current)
  }

  for (const line of lines) {
    const fileMatch = line.text.match(/^\/\/\s+(.+)$/)
    if (fileMatch != null) {
      pushCurrent()
      current = {
        file: fileMatch[1] ?? "Architecture",
        lines: [],
        add: line.type === "add" ? 1 : 0,
        del: line.type === "del" ? 1 : 0,
        status: "changed",
      }
      continue
    }
    if (current == null) {
      current = { file: "Architecture", lines: [], add: 0, del: 0, status: "changed" }
    }
    current.lines.push(line)
    if (line.type === "add") current.add++
    if (line.type === "del") current.del++
  }
  pushCurrent()
  return files
}

function CodeDiffRow({ line }: { line: DiffLine }) {
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " "
  return (
    <div className={`inline-diff-line inline-diff-${line.type}`}>
      <span className="inline-diff-prefix">{prefix}</span>
      <span className="inline-diff-code">{highlightTypeScript(line.text)}</span>
    </div>
  )
}

function DiffRow({ line }: { line: DiffLine }) {
  const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " "
  return (
    <div className={`arch-diff-line arch-diff-${line.type}`}>
      <span className="arch-diff-prefix">{prefix}</span>
      {line.text}
    </div>
  )
}

const TS_TOKEN_RE = /(".*?"|'.*?'|`.*?`|\b[A-Za-z_$][A-Za-z0-9_$]*\b|\b\d+(?:\.\d+)?\b|[{}()[\]:;,<>|&=?.])/g
const TS_KEYWORDS = new Set([
  "declare", "function", "class", "interface", "type", "const", "let", "var",
  "return", "extends", "implements", "readonly", "private", "public", "protected",
  "async", "await", "new",
])
const TS_TYPES = new Set(["string", "number", "boolean", "void", "null", "unknown", "any", "never", "Record", "Promise", "Array", "Map", "Set"])

function tokenClass(token: string): string {
  if (TS_KEYWORDS.has(token)) return "tok-keyword"
  if (TS_TYPES.has(token)) return "tok-type"
  if (/^["'`]/.test(token)) return "tok-string"
  if (/^\d/.test(token)) return "tok-number"
  if (/^[A-Z]/.test(token)) return "tok-symbol"
  if (/^[A-Za-z_$]/.test(token)) return "tok-ident"
  return "tok-punc"
}

function highlightTypeScript(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let previousToken: string | null = null
  for (const match of text.matchAll(TS_TOKEN_RE)) {
    const token = match[0]
    const index = match.index
    if (index > last) nodes.push(text.slice(last, index))
    const cls =
      previousToken === "function" && /^[A-Za-z_$]/.test(token)
        ? "tok-function"
        : tokenClass(token)
    nodes.push(<span key={`${index}-${token}`} className={cls}>{token}</span>)
    last = index + token.length
    previousToken = TS_KEYWORDS.has(token) || TS_TYPES.has(token) || /^[A-Za-z_$]/.test(token) ? token : null
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function CapturedReview({
  changes,
  storybookUrl,
  storybookState,
  onRetryStorybook,
}: {
  changes: CaptureChange[]
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: () => void
}) {
  const [selectedId, setSelectedId] = useState(changes[0]?.id ?? null)
  const selected = changes.find((change) => change.id === selectedId) ?? changes[0] ?? null

  useEffect(() => {
    if (selectedId != null && changes.some((change) => change.id === selectedId)) return
    setSelectedId(changes[0]?.id ?? null)
  }, [changes, selectedId])

  if (!selected) {
    return <div className="empty">No captured tests changed in this workspace.</div>
  }

  return (
    <div className="capture-review">
      <aside className="capture-review-list">
        <div className="capture-review-list-title">CHANGED CAPTURED TESTS</div>
        {changes.map((change) => (
          <button
            key={change.id}
            className={`capture-review-item ${change.id === selected.id ? "active" : ""}`}
            onClick={() => setSelectedId(change.id)}
          >
            <span className={`capture-change-mark ${change.status}`}>
              {change.status === "added" ? "+" : change.status === "removed" ? "-" : "~"}
            </span>
            <span>
              <strong>{change.component} / {change.exportName}</strong>
              <small>{change.testFile}</small>
            </span>
          </button>
        ))}
      </aside>
      <CaptureDetail
        change={selected}
        storybookUrl={storybookUrl}
        storybookState={storybookState}
        onRetryStorybook={onRetryStorybook}
      />
    </div>
  )
}

function CaptureDetail({
  change,
  storybookUrl,
  storybookState,
  onRetryStorybook,
}: {
  change: CaptureChange
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: () => void
}) {
  const [view, setView] = useState<CaptureView>("visual")
  const beforeHtml = extractSnapshotHtml(change.beforeSnapshot)
  const afterHtml = extractSnapshotHtml(change.afterSnapshot)
  const sourceLines = useMemo(
    () => lineDiff(
      formatCapturedSnapshot(change.beforeSnapshot),
      formatCapturedSnapshot(change.afterSnapshot)
    ),
    [change]
  )

  useEffect(() => setView("visual"), [change.id])

  return (
    <section className="capture-review-detail">
      <header className="capture-detail-header">
        <div>
          <strong>{change.component} / {change.exportName}</strong>
          <small>{change.testFile}</small>
        </div>
        <span className={`capture-status ${change.status}`}>{change.status}</span>
      </header>
      <div className="snap-tabs capture-view-tabs">
        <button
          className={`snap-tab ${view === "visual" ? "active" : ""}`}
          onClick={() => setView("visual")}
        >
          Before / after
        </button>
        <button
          className={`snap-tab ${view === "diff" ? "active" : ""}`}
          onClick={() => setView("diff")}
        >
          Snapshot diff
        </button>
      </div>
      {view === "visual" ? (
        <VisualComparison
          change={change}
          beforeHtml={beforeHtml}
          afterHtml={afterHtml}
          storybookUrl={storybookUrl}
          storybookState={storybookState}
          onRetryStorybook={onRetryStorybook}
        />
      ) : (
        <pre className="capture-source-diff">
          {sourceLines.map((line, index) => <DiffRow key={index} line={line} />)}
        </pre>
      )}
    </section>
  )
}

function VisualComparison({
  change,
  beforeHtml,
  afterHtml,
  storybookUrl,
  storybookState,
  onRetryStorybook,
}: {
  change: CaptureChange
  beforeHtml: string | null
  afterHtml: string | null
  storybookUrl: string
  storybookState: SbState | null
  onRetryStorybook: () => void
}) {
  if (!storybookUrl) {
    return (
      <div className="capture-preview-unavailable">
        <strong>
          {storybookState?.status === "failed" ? "Storybook failed to start." : "Starting Storybook..."}
        </strong>
        {storybookState?.error != null && storybookState.error !== "" && (
          <span>{storybookState.error}</span>
        )}
        {storybookState?.status === "failed" && (
          <button className="sb-retry-btn" onClick={onRetryStorybook}>Retry</button>
        )}
      </div>
    )
  }

  return (
    <div className={`capture-visuals ${beforeHtml != null && afterHtml != null ? "split" : "single"}`}>
      {beforeHtml != null && (
        <SnapshotPreview
          label="Before"
          html={beforeHtml}
          storyId={change.storyId}
          storybookUrl={storybookUrl}
        />
      )}
      {afterHtml != null && (
        <SnapshotPreview
          label="After"
          html={afterHtml}
          storyId={change.storyId}
          storybookUrl={storybookUrl}
        />
      )}
      {beforeHtml == null && afterHtml == null && (
        <div className="empty">This captured test has no snapshot output to render.</div>
      )}
    </div>
  )
}

function SnapshotPreview({
  label,
  html,
  storyId,
  storybookUrl,
}: {
  label: string
  html: string
  storyId: string | null
  storybookUrl: string
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const src = `${storybookUrl}/iframe.html?id=${encodeURIComponent(storyId ?? "")}&viewMode=story`
  const sendSnapshot = () => {
    frameRef.current?.contentWindow?.postMessage({ type: "logos:render-snapshot", html }, "*")
  }

  useEffect(() => {
    sendSnapshot()
    const first = window.setTimeout(sendSnapshot, 400)
    const second = window.setTimeout(sendSnapshot, 1200)
    return () => {
      window.clearTimeout(first)
      window.clearTimeout(second)
    }
  }, [html, src])

  return (
    <div className="capture-preview">
      <div className="capture-preview-label">{label}</div>
      <iframe
        ref={frameRef}
        className="capture-preview-frame"
        src={src}
        title={`${label} ${storyId ?? "captured story"}`}
        onLoad={sendSnapshot}
      />
    </div>
  )
}
