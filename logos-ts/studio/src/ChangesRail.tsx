import type { Goal, WorkspaceMeta } from "./types"
import { svgIcon } from "./icons"

const branchIcon = svgIcon("M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9", 12)
const plusIcon = svgIcon("M12 5v14M5 12h14", 12)
const collapseIcon = svgIcon("M15 18l-6-6 6-6", 12)

interface Props {
  open: boolean
  onToggle: () => void
  workspaces: WorkspaceMeta[]
  workspacesLoading: boolean
  activeWorkspaceId: string | null
  selected: { type: "workspace" | "goal"; id: string } | null
  onNewWorkspace: () => void
  onOpenWorkspace: (id: string) => void
  onFork: () => void
  onSelectGoal: (id: string) => void
  onDeleteWorkspace: (id: string) => void
  onDeleteGoal: (wsId: string, goalId: string) => void
  runningGoals: Set<string>
}

export function ChangesRail({
  open,
  onToggle,
  workspaces,
  workspacesLoading,
  activeWorkspaceId,
  selected,
  onNewWorkspace,
  onOpenWorkspace,
  onFork,
  onSelectGoal,
  onDeleteWorkspace,
  onDeleteGoal,
  runningGoals,
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
          const goals = w.goals ?? []
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
                {!isActive && goals.length > 0 && <span className="rail-status"> · {goals.length}</span>}
                {goals.some((g) => runningGoals.has(g.id)) && (
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
                goals
                  .slice()
                  .reverse()
                  .map((g) => {
                    const gSelected = selected?.type === "goal" && selected.id === g.id
                    return (
                      <div
                        key={g.id}
                        className={`rail-row comment ${gSelected ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectGoal(g.id)
                        }}
                      >
                        <button
                          className="rail-del"
                          title="Delete goal (⌘⌫)"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteGoal(w.id, g.id)
                          }}
                        >
                          ×
                        </button>
                        <div className="rail-target">
                          {g.label}
                          <span className={`cmode ${g.mode ?? "code"}`}>{g.mode ?? "code"}</span>
                          <span className={`goal-status ${g.status}`}>{g.status}</span>
                        </div>
                        <div className="rail-comment">{g.text}</div>
                      </div>
                    )
                  })}
            </div>
          )
        })}
    </div>
  )
}
