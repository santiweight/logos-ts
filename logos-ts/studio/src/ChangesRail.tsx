import type { Comment, WorkspaceMeta } from "./types"
import { svgIcon } from "./icons"

const branchIcon = svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 12)
const plusIcon = svgIcon("M12 5v14M5 12h14", 12)
const collapseIcon = svgIcon("M15 18l-6-6 6-6", 12)

interface Props {
  open: boolean
  onToggle: () => void
  comments: Comment[]
  workspaces: WorkspaceMeta[]
  workspacesLoading: boolean
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
  workspacesLoading,
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
          {branchIcon}
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
            {plusIcon}
          </button>
          <button className="rail-toggle" onClick={onToggle} title="Collapse">
            {collapseIcon}
          </button>
        </span>
      </div>

      <div className={`rail-row base ${!activeWorkspaceId ? "active" : ""}`} onClick={onBase}>
        <span className="rail-dot">●</span> Base
      </div>
      {workspacesLoading && workspaces.length === 0 && (
        <div className="rail-loading muted small">Loading workspaces…</div>
      )}
      {!workspacesLoading && workspaces.length === 0 && (
        <div className="rail-empty muted small"></div>
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
                <span className="rail-dot fork">{branchIcon}</span> {w.name}
                {w.parentId && <span className="rail-status"> · branch</span>}
                {!isActive && wsComments.length > 0 && <span className="rail-status"> · {wsComments.length}</span>}
                {agentRunning && agentWorkspace === w.id && (
                  <span className="rail-agent" title="Agent running">
                    <span className="ag-spin">↻</span>
                  </span>
                )}
                {isActive && (
                  <button
                    className="rail-fork"
                    title="Fork workspace"
                    onClick={(e) => {
                      e.stopPropagation()
                      onFork()
                    }}
                  >
                    fork
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
