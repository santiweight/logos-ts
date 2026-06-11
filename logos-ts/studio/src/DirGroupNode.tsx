import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"

export interface DirGroupData {
  label: string
  fileCount: number
  symbolCount: number
  expanded: boolean
  depth: number
  onToggle: (id: string) => void
}

type DirGroupNodeProps = NodeProps & { data: DirGroupData }

const DEPTH_COLORS = ["#4a9eff", "#c08bf0", "#e0c060"]

export const DirGroupNode = memo(function DirGroupNode({ data, id }: DirGroupNodeProps) {
  const { label, fileCount, symbolCount, expanded, depth, onToggle } = data

  const handleToggle = useCallback(() => {
    onToggle(id)
  }, [id, onToggle])

  const accent = DEPTH_COLORS[depth] ?? DEPTH_COLORS[0]

  return (
    <div
      className={`dir-node dir-depth-${depth} ${expanded ? "dir-expanded" : ""}`}
      style={{ borderColor: accent }}
    >
      <div className="dir-header" onClick={handleToggle}>
        <span className="fg-arrow">{expanded ? "▾" : "▸"}</span>
        <span className="dir-icon" style={{ color: accent }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 2.5h3.5l1 1H11v7H1v-8z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
        </span>
        <span className="dir-label">{label}</span>
        {!expanded && (
          <span className="dir-stats">
            {fileCount}f · {symbolCount}s
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="dir-src" className="fg-handle fg-handle-right" />
      <Handle type="target" position={Position.Left} id="dir-tgt" className="fg-handle fg-handle-left" />
    </div>
  )
})
