/* eslint-disable @typescript-eslint/no-unused-vars, no-restricted-syntax */
import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"

const KIND_COLORS: Record<string, string> = {
  function: "#c08bf0",
  class: "#4a9eff",
  interface: "#e0c060",
  type: "#e0c060",
  enum: "#e09050",
  variable: "#8a8a92",
  method: "#8a8a92",
}

const KIND_LABELS: Record<string, string> = {
  function: "fn",
  class: "cls",
  interface: "iface",
  type: "type",
  enum: "enum",
  variable: "val",
  method: "method",
}

export interface SymbolInfo {
  id: string
  kind: string
  name: string
  parent?: string
}

export interface FileGroupData {
  label: string
  filePath: string
  symbols: SymbolInfo[]
  expanded: boolean
  onToggle: (fileId: string) => void
  onToggleClass: (classId: string) => void
  expandedClasses: Set<string>
}

type FileGroupNodeProps = NodeProps & { data: FileGroupData }

export const FileGroupNode = memo(function FileGroupNode({ data, id }: FileGroupNodeProps) {
  const { label, symbols, expanded, onToggle, onToggleClass, expandedClasses } = data

  const handleToggle = useCallback(() => {
    onToggle(id)
  }, [id, onToggle])

  const classes = symbols.filter((s) => s.kind === "class")
  const topLevel = symbols.filter((s) => s.kind !== "method")
  const methods = symbols.filter((s) => s.kind === "method")

  const edgeCount = symbols.length

  return (
    <div
      className="fg-node"
      style={{ minWidth: expanded ? 220 : 160 }}
    >
      <div className="fg-header" onClick={handleToggle}>
        <span className="fg-arrow">{expanded ? "▾" : "▸"}</span>
        <span className="fg-file-icon">
          <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
            <path d="M1 1h5.5L10 4.5V12H1V1z" stroke="#8a8a92" strokeWidth="1.2" fill="none" />
            <path d="M6.5 1v3.5H10" stroke="#8a8a92" strokeWidth="1.2" fill="none" />
          </svg>
        </span>
        <span className="fg-label">{label}</span>
        {!expanded && <span className="fg-count">{edgeCount}</span>}
      </div>

      {expanded && (
        <div className="fg-body">
          {topLevel.map((sym) => {
            const isClass = sym.kind === "class"
            const classExpanded = expandedClasses.has(sym.id)
            const classMethods = isClass
              ? methods.filter((m) => m.parent === sym.id)
              : []

            return (
              <div key={sym.id} className="fg-symbol-group">
                <div
                  className={`fg-symbol ${isClass ? "fg-class" : ""}`}
                  onClick={isClass ? () => onToggleClass(sym.id) : undefined}
                >
                  {isClass && (
                    <span className="fg-arrow-sm">{classExpanded ? "▾" : "▸"}</span>
                  )}
                  <span
                    className="fg-kind"
                    style={{ color: KIND_COLORS[sym.kind] || "#8a8a92" }}
                  >
                    {KIND_LABELS[sym.kind] || sym.kind}
                  </span>
                  <span className="fg-sym-name">{sym.name.split(".").pop()}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`${sym.id}-src`}
                    className="fg-handle fg-handle-right"
                  />
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={`${sym.id}-tgt`}
                    className="fg-handle fg-handle-left"
                  />
                </div>
                {isClass && classExpanded && classMethods.length > 0 && (
                  <div className="fg-methods">
                    {classMethods.map((m) => (
                      <div key={m.id} className="fg-symbol fg-method">
                        <span
                          className="fg-kind"
                          style={{ color: KIND_COLORS[m.kind] }}
                        >
                          {KIND_LABELS[m.kind]}
                        </span>
                        <span className="fg-sym-name">{m.name.split(".").pop()}</span>
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={`${m.id}-src`}
                          className="fg-handle fg-handle-right"
                        />
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={`${m.id}-tgt`}
                          className="fg-handle fg-handle-left"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!expanded && (
        <>
          <Handle type="source" position={Position.Right} id="file-src" className="fg-handle fg-handle-right" />
          <Handle type="target" position={Position.Left} id="file-tgt" className="fg-handle fg-handle-left" />
        </>
      )}
    </div>
  )
})
