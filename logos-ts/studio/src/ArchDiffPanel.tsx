import { useMemo } from "react"
import type { StudioIndex } from "./types"
import { indexToArchText, lineDiff, type DiffLine } from "./arch-text"

interface Props {
  base: StudioIndex
  workspace: StudioIndex
  onClose: () => void
}

export function ArchDiffPanel({ base, workspace, onClose }: Props) {
  const lines = useMemo(() => {
    const a = indexToArchText(base)
    const b = indexToArchText(workspace)
    return lineDiff(a, b)
  }, [base, workspace])

  const stats = useMemo(() => {
    let add = 0, del = 0
    for (const l of lines) { if (l.type === "add") add++; if (l.type === "del") del++ }
    return { add, del }
  }, [lines])

  return (
    <section className="content">
      <header className="content-header">
        <span className="crumb">Architecture Diff</span>
        <span className="arch-diff-stats">
          <span className="arch-diff-add">+{stats.add}</span>{" "}
          <span className="arch-diff-del">-{stats.del}</span>
        </span>
        <button className="tab" onClick={onClose}>Close</button>
      </header>
      <div className="content-body">
        <pre className="arch-diff-code">
          {lines.map((l, i) => (
            <DiffRow key={i} line={l} />
          ))}
        </pre>
      </div>
    </section>
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
