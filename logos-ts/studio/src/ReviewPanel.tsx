import { useEffect, useMemo, useState } from "react"
import { indexToArchText, lineDiff, type DiffLine } from "./arch-text"
import { highlightTs } from "./highlight"
import {
  snapshotChanges,
  formatSnapshot,
  type SnapshotChange,
} from "./review"
import type { StudioIndex } from "./types"

interface ScreenshotContext {
  workspaceId: string
  baseInstanceId: string
  workspaceInstanceId: string
}

interface Props {
  base: StudioIndex
  workspace: StudioIndex
  showHeaderTitle?: boolean

  screenshots?: ScreenshotContext
}

type ReviewTab = "architecture" | "snapshots"
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
  showHeaderTitle = true,
  screenshots,
}: Props) {
  const architectureLines = useMemo(
    () => lineDiff(indexToArchText(base), indexToArchText(workspace)),
    [base, workspace]
  )
  const snapshotChangesList = useMemo(() => snapshotChanges(base, workspace), [base, workspace])
  const architectureStats = useMemo(() => diffStats(architectureLines), [architectureLines])
  const [tab, setTab] = useState<ReviewTab>(snapshotChangesList.length > 0 ? "snapshots" : "architecture")

  return (
    <section className="content review-panel">
      <header className="content-header review-header">
        {showHeaderTitle && <span className="crumb">Review workspace changes</span>}
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
            className={`tab ${tab === "snapshots" ? "active" : ""}`}
            onClick={() => setTab("snapshots")}
          >
            Snapshots {snapshotChangesList.length}
          </button>
        </div>
      </header>
      <div className="content-body">
        {tab === "architecture" ? (
          <ArchitectureReview lines={architectureLines} stats={architectureStats} />
        ) : (
          <SnapshotReview changes={snapshotChangesList} screenshots={screenshots} />
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
      <span className="inline-diff-code">{highlightTs(line.text)}</span>
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



function SnapshotReview({
  changes,
  screenshots,
}: {
  changes: SnapshotChange[]
  screenshots?: ScreenshotContext
}) {
  const [selectedId, setSelectedId] = useState(changes[0]?.id ?? null)
  const selected = changes.find((change) => change.id === selectedId) ?? changes[0] ?? null

  useEffect(() => {
    if (selectedId != null && changes.some((change) => change.id === selectedId)) return
    setSelectedId(changes[0]?.id ?? null)
  }, [changes, selectedId])

  if (!selected) {
    return <div className="empty">No snapshots changed in this workspace.</div>
  }

  return (
    <div className="capture-review">
      <aside className="capture-review-list">
        <div className="capture-review-list-title">CHANGED SNAPSHOTS</div>
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
            </span>
          </button>
        ))}
      </aside>
      <SnapshotDetail
        change={selected}
        screenshots={screenshots}
      />
    </div>
  )
}

function SnapshotDetail({
  change,
  screenshots,
}: {
  change: SnapshotChange
  screenshots?: ScreenshotContext
}) {
  const [view, setView] = useState<CaptureView>("visual")
  const sourceLines = useMemo(
    () => lineDiff(
      formatSnapshot(change.beforeSnapshot),
      formatSnapshot(change.afterSnapshot)
    ),
    [change]
  )

  useEffect(() => setView("visual"), [change.id])

  return (
    <section className="capture-review-detail">
      <header className="capture-detail-header">
        <div>
          <strong>{change.component} / {change.exportName}</strong>
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
          screenshots={screenshots}
        />
      ) : (
        <pre className="capture-source-diff">
          {sourceLines.map((line, index) => <DiffRow key={index} line={line} />)}
        </pre>
      )}
    </section>
  )
}

function screenshotUrl(ctx: ScreenshotContext, instanceId: string, storyId: string): string {
  const storyFile = storyId.replace(/[^a-zA-Z0-9._-]+/g, "-") || "story"
  return `/api/screenshots/${ctx.workspaceId}/${instanceId}/${storyFile}.png`
}

function VisualComparison({
  change,
  screenshots,
}: {
  change: SnapshotChange
  screenshots?: ScreenshotContext
}) {
  if (!screenshots || !change.storyId) {
    return <div className="empty">No screenshots available for this story.</div>
  }
  const beforeSrc = screenshotUrl(screenshots, screenshots.baseInstanceId, change.storyId)
  const afterSrc = screenshotUrl(screenshots, screenshots.workspaceInstanceId, change.storyId)
  return (
    <div className="capture-visuals split">
      <div className="capture-preview">
        <div className="capture-preview-label">Before</div>
        <img className="capture-preview-img" src={beforeSrc} alt={`Before ${change.storyId}`} />
      </div>
      <div className="capture-preview">
        <div className="capture-preview-label">After</div>
        <img className="capture-preview-img" src={afterSrc} alt={`After ${change.storyId}`} />
      </div>
    </div>
  )
}

