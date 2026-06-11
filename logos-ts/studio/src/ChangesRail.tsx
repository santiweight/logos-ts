import type { Comment, WorkspaceMeta } from "./types"

interface Props {
  open: boolean
  onToggle: () => void
  comments: Comment[]
  workspaces: WorkspaceMeta[]
  activeWorkspaceId: string | null
  selected: { type: "workspace" | "comment"; id: string } | null
  onBase: () => void
  onNewWorkspace: () => void
  onOpenWorkspace: (id: string) => void
  onFork: () => void
  onSelectComment: (id: string) => void
  onDeleteWorkspace: (id: string) => void
  onDeleteComment: (id: string) => void
  agentRunning: boolean
  agentWorkspace: string | null
}

export function ChangesRail({
  open,
  onToggle,
  comments,
  workspaces,
  activeWorkspaceId,
  selected,
  onBase,
  onNewWorkspace,
  onOpenWorkspace,
  onFork,
  onSelectComment,
  onDeleteWorkspace,
  onDeleteComment,
  agentRunning,
  agentWorkspace,
}: Props) {
  if (!open) {
    return (
      <div className="rail collapsed">
        <button className="rail-toggle" onClick={onToggle} title="Workspaces">
          ⑂
        </button>
        {workspaces.length > 0 && <div className="rail-count">{workspaces.length}</div>}
      </div>
    )
  }

  const commentsFor = (wsId: string) => comments.filter((c) => c.workspaceId === wsId)

  return (
    <div className="rail">
      <div className="rail-head">
        <span>CHANGES</span>
        <span>
          <button className="rail-toggle" onClick={onNewWorkspace} title="New workspace">
            +
          </button>
          <button className="rail-toggle" onClick={onToggle} title="Collapse">
            ‹
          </button>
        </span>
      </div>

      <div className={`rail-row base ${!activeWorkspaceId ? "active" : ""}`} onClick={onBase}>
        <span className="rail-dot">●</span> Base
      </div>

      <div className="rail-sec">workspaces · ⌘⌫ to delete · alt-click code to add a change</div>
      {workspaces.length === 0 && (
        <div className="rail-empty muted small">none yet — alt-click an item to start one</div>
      )}

      {workspaces
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((w) => {
          const isActive = activeWorkspaceId === w.id
          const wsSelected = selected?.type === "workspace" && selected.id === w.id
          const wsComments = commentsFor(w.id)
          return (
            <div key={w.id}>
              <div
                className={`rail-row ws ${isActive || wsSelected ? "active" : ""}`}
                onClick={() => onOpenWorkspace(w.id)}
              >
                <button
                  className="rail-del"
                  title="Delete workspace (⌘⌫)"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteWorkspace(w.id)
                  }}
                >
                  ×
                </button>
                <span className="rail-dot fork">⑂</span> {w.name}
                {w.parentId && <span className="rail-status"> · branch</span>}
                {!isActive && <span className="rail-status"> · {wsComments.length} change(s)</span>}
                {agentRunning && agentWorkspace === w.id && (
                  <span className="rail-agent" title="An agent is addressing this workspace">
                    <span className="ag-spin">⟳</span> agent…
                  </span>
                )}
                {isActive && (
                  <button
                    className="rail-fork"
                    title="Fork (branch to compare)"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFork()
                    }}
                  >
                    fork ⑂
                  </button>
                )}
              </div>

              {isActive &&
                wsComments
                  .slice()
                  .reverse()
                  .map((c) => {
                    const cSelected = selected?.type === "comment" && selected.id === c.id
                    return (
                      <div
                        key={c.id}
                        className={`rail-row comment ${cSelected ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectComment(c.id)
                        }}
                      >
                        <button
                          className="rail-del"
                          title="Delete change (⌘⌫)"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteComment(c.id)
                          }}
                        >
                          ×
                        </button>
                        <div className="rail-target">
                          {c.label}
                          <span className={`cmode ${c.mode ?? "code"}`}>{c.mode ?? "code"}</span>
                        </div>
                        <div className="rail-comment">{c.text}</div>
                      </div>
                    )
                  })}
            </div>
          )
        })}
    </div>
  )
}
