/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-condition */
import { useEffect, useRef } from "react"

// Each streamed message from the agent-run SSE.
export interface AgentMsg {
  type: "status" | "event" | "stderr" | "raw" | "error" | "done"
  message?: string
  line?: string
  code?: number
  event?: any
}

function summarizeToolInput(name: string, input: Record<string, any>): string {
  if (!input) return ""
  if (input["file_path"]) return input["file_path"]
  if (input["command"]) return String(input["command"]).slice(0, 80)
  if (input["pattern"]) return input["pattern"]
  if (input["path"]) return input["path"]
  if (input["prompt"]) return String(input["prompt"]).slice(0, 60)
  return Object.keys(input).slice(0, 2).join(", ")
}

function Line({ m }: { m: AgentMsg }) {
  if (m.type === "status") return <div className="ag-line ag-status">▸ {m.message}</div>
  if (m.type === "stderr") return <div className="ag-line ag-err">{m.message}</div>
  if (m.type === "error") return <div className="ag-line ag-err">✗ {m.message}</div>
  if (m.type === "done")
    return <div className="ag-line ag-done">● agent finished{m.code ? ` (exit ${m.code})` : ""}</div>
  if (m.type === "raw") return <div className="ag-line ag-dim">{m.line}</div>

  const e = m.event
  if (!e) return null
  if (e.type === "system" && e.subtype === "init")
    return <div className="ag-line ag-dim">agent session started ({e.model})</div>
  if (e.type === "assistant") {
    const blocks = e.message?.content ?? []
    return (
      <>
        {blocks.map((b: any, i: number) => {
          if (b.type === "text" && b.text?.trim())
            return (
              <div key={i} className="ag-line ag-text">
                {b.text.trim()}
              </div>
            )
          if (b.type === "tool_use")
            return (
              <div key={i} className="ag-line ag-tool">
                <span className="ag-tool-name">{b.name}</span>{" "}
                <span className="ag-tool-arg">{summarizeToolInput(b.name, b.input)}</span>
              </div>
            )
          return null
        })}
      </>
    )
  }
  if (e.type === "result")
    return (
      <div className="ag-line ag-done">
        ● result{e.total_cost_usd ? ` · $${e.total_cost_usd.toFixed(3)}` : ""}
      </div>
    )
  return null
}

export function AgentPanel({
  events,
  running,
  onClose,
}: {
  events: AgentMsg[]
  running: boolean
  onClose: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [events])

  return (
    <div className="agent-panel">
      <div className="agent-head">
        <span>
          {running ? <span className="ag-spin">⟳</span> : "●"} Agent activity
        </span>
        <button className="agent-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="agent-log">
        {events.length === 0 && (
          <div className="ag-line ag-dim">
            no agent activity yet — declare a change (alt-click a node) and an agent starts here.
          </div>
        )}
        {events.map((m, i) => (
          <Line key={i} m={m} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
