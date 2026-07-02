/* eslint-disable @typescript-eslint/no-unused-vars */
import { type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import type { WorkspaceMeta } from "./types"
import { svgIcon } from "./icons"

const listIcon = svgIcon("M5 7h14M5 12h14M5 17h14", 12)
const plusIcon = svgIcon("M12 5v14M5 12h14", 12)
const collapseIcon = svgIcon("M15 18l-6-6 6-6", 12)
const resetIcon = svgIcon("M4 4v6h6M20 20v-6h-6M6.5 17.5a7.5 7.5 0 0 0 11-10.2L20 10M17.5 6.5a7.5 7.5 0 0 0-11 10.2L4 14", 12)
const mergeIcon = svgIcon("M7 3v11a4 4 0 0 0 4 4h6M17 18l-3-3M17 18l-3 3M7 7h5", 12)
const trashIcon = svgIcon("M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7", 12)
const pushIcon = svgIcon("M12 21V5M7 10l5-5 5 5M5 21h14", 12)

function initializationStatusText(status: NonNullable<WorkspaceMeta["initialization"]>["steps"][number]["status"]): string {
  switch (status) {
    case "done": return "done"
    case "running": return "running"
    case "error": return "error"
    case "pending":
    default: return "pending"
  }
}

interface WorkspaceTreeNode {
  workspace: WorkspaceMeta
  children: WorkspaceTreeNode[]
}

function workspaceTree(workspaces: WorkspaceMeta[]): WorkspaceTreeNode[] {
  const nodes = new Map<string, WorkspaceTreeNode>()
  for (const workspace of workspaces) nodes.set(workspace.id, { workspace, children: [] })
  const roots: WorkspaceTreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.workspace.parentId ? nodes.get(node.workspace.parentId) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortNodes = (items: WorkspaceTreeNode[]) => {
    items.sort((a, b) => b.workspace.createdAt - a.workspace.createdAt)
    for (const item of items) sortNodes(item.children)
  }
  sortNodes(roots)
  return roots
}

function rowStyle(depth: number, baseMargin = 4): CSSProperties {
  return { marginLeft: baseMargin + depth * 14 }
}

function workspaceThread(workspace: WorkspaceMeta) {
  if (workspace.goals.length > 1) {
    throw new Error(`Workspace "${workspace.name}" has ${workspace.goals.length} threads; the changes rail supports one thread per workspace.`)
  }
  return workspace.goals[0] ?? null
}

interface Props {
  open: boolean
  onToggle: () => void
  workspaces: WorkspaceMeta[]
  workspacesLoading: boolean
  activeWorkspaceId: string | null
  selected: { type: "workspace" | "goal"; id: string } | null
  onNewWorkspace: () => void
  onResetWorkspaces: () => void
  onOpenWorkspace: (id: string) => void
  onCreatePullRequest: (id: string) => void
  onSelectGoal: (workspaceId: string, goalId: string) => void
  onDeleteWorkspace: (id: string) => void
  onDeleteGoal: (wsId: string, goalId: string) => void
  onAcceptGoal: (goalId: string) => void
  runningGoals: Set<string>
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void
}

export function ChangesRail({
  open,
  onToggle,
  workspaces,
  workspacesLoading,
  activeWorkspaceId,
  selected,
  onNewWorkspace,
  onResetWorkspaces,
  onOpenWorkspace,
  onCreatePullRequest,
  onSelectGoal,
  onDeleteWorkspace,
  onDeleteGoal,
  onAcceptGoal,
  runningGoals,
  onResizeStart,
}: Props) {
  if (!open) {
    return (
      <div className="rail collapsed">
        <button className="rail-toggle" onClick={onToggle} title="Changes" aria-label="Open changes">
          {listIcon}
        </button>
        {workspaces.length > 0 && <div className="rail-count">{workspaces.length}</div>}
      </div>
    )
  }

  const renderWorkspace = (node: WorkspaceTreeNode, depth: number) => {
    const w = node.workspace
    const thread = workspaceThread(w)
    const isActive = activeWorkspaceId === w.id
    const wsSelected = selected?.type === "workspace" && selected.id === w.id
    const threadSelected = selected?.type === "goal" && selected.id === thread?.id
    const goals = w.goals
    const canAccept = thread != null
      && !runningGoals.has(thread.id)
      && thread.lifecycle?.stage === "impl"
      && thread.lifecycle.state === "ready_to_merge"
    const hasUpdatesToPush = w.publication
      ? goals.some((g) => g.createdAt > w.publication!.updatedAt)
      : false
    return (
      <div key={w.id} className="rail-workspace-group">
        <div
          className={`rail-row ws ${isActive || wsSelected || threadSelected ? "active" : ""}`}
          style={rowStyle(depth)}
          title={thread ? `${w.name} (${thread.status})` : w.name}
          onClick={() => {
            if (thread) onSelectGoal(w.id, thread.id)
            else onOpenWorkspace(w.id)
          }}
        >
          <div className="rail-main">
            <span className="rail-title">{w.name}</span>
            {w.initialization?.status === "initializing" && <span className="rail-status"> · initializing</span>}
            {w.initialization?.status === "error" && <span className="rail-status error"> · init failed</span>}
          </div>
          <div className="rail-actions">
            {w.initialization?.status === "initializing" && (
              <span className="rail-agent" title="Workspace initializing">
                <span className="ag-spin">↻</span>
              </span>
            )}
            {goals.some((g) => runningGoals.has(g.id)) && (
              <span className="rail-agent" title="Agent running">
                <span className="ag-spin">↻</span>
              </span>
            )}
            {canAccept && (
              <button
                className="rail-merge"
                title="Accept change"
                aria-label={`Accept ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onAcceptGoal(thread.id)
                }}
              >
                {mergeIcon}
              </button>
            )}
            {!w.publication && (
              <button
                className="rail-merge"
                title="Make pull request"
                aria-label={`Make pull request for ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCreatePullRequest(w.id)
                }}
              >
                {mergeIcon}
              </button>
            )}
            <button
              className="rail-del"
              title="Delete workspace (⌘⌫)"
              aria-label={`Delete ${w.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onDeleteWorkspace(w.id)
              }}
            >
              {trashIcon}
            </button>
          </div>
        </div>

        {isActive && w.initialization && w.initialization.status !== "ready" && (
          <div className={`rail-initialization ${w.initialization.status}`} style={rowStyle(depth, 18)}>
            {w.initialization.steps.map((step) => (
              <div key={step.id} className={`rail-init-step ${step.status}`}>
                <span className="rail-init-mark">
                  {step.status === "running" ? <span className="ag-spin">↻</span> : step.status === "done" ? "✓" : step.status === "error" ? "!" : "·"}
                </span>
                <span className="rail-init-label">{step.label}</span>
                <span className="rail-init-status">{initializationStatusText(step.status)}</span>
                {step.error && <div className="rail-init-error" title={step.error}>{step.error}</div>}
              </div>
            ))}
          </div>
        )}

        {isActive && w.publication && (
          <div className="rail-publication" style={rowStyle(depth, 18)}>
            <div className="rail-publication-main">
              {w.publication.pullRequest?.url ? (
                <a
                  href={w.publication.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {w.publication.pullRequest.number ? `PR #${w.publication.pullRequest.number}` : "PR"}
                </a>
              ) : (
                <span className="rail-publication-value">PR created</span>
              )}
            </div>
            {hasUpdatesToPush ? (
              <button
                className="rail-push-updates"
                title="Push updates to pull request"
                aria-label={`Push updates for ${w.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onCreatePullRequest(w.id)
                }}
              >
                {pushIcon}
              </button>
            ) : (
              <button className="rail-push-updates disabled" title="Pull request is up to date" aria-label={`${w.name} pull request is up to date`} disabled>
                {pushIcon}
              </button>
            )}
          </div>
        )}

        {node.children.map((child) => renderWorkspace(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="rail">
      <div className="rail-resize" title="Resize changes sidebar" onPointerDown={onResizeStart} />
      <div className="rail-head">
        <span>CHANGES</span>
        <span>
          <button className="rail-toggle" onClick={onNewWorkspace} title="New workspace" aria-label="New workspace">
            {plusIcon}
          </button>
          <button className="rail-toggle" onClick={onResetWorkspaces} title="Reset all workspaces" aria-label="Reset all workspaces">
            {resetIcon}
          </button>
          <button className="rail-toggle" onClick={onToggle} title="Collapse" aria-label="Collapse changes">
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

      {workspaceTree(workspaces).map((node) => renderWorkspace(node, 0))}
    </div>
  )
}
