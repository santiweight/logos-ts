import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { ChangesRail } from "./ChangesRail"

afterEach(cleanup)

const noop = () => {}
const codeWs = (id: string, name: string, createdAt: number, goals: any[] = []) => ({
  id,
  name,
  kind: "code" as const,
  parentId: null,
  createdAt,
  baseArcWsInstanceId: null,
  activeArcWsInstanceId: null,
  goldenArcWsInstanceId: null,
  baseImplWsInstanceId: `impl-${id}`,
  activeImplWsInstanceId: `impl-${id}`,
  goals,
})

const baseProps = {
  open: true,
  onToggle: noop,
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onNewWorkspace: noop,
  onResetWorkspaces: noop,
  onOpenWorkspace: noop as (id: string) => void,
  onFork: noop,
  onCreatePullRequest: noop as (id: string) => void,
  onSelectGoal: noop as (id: string) => void,
  onDeleteWorkspace: noop as (id: string) => void,
  onDeleteGoal: noop as (wsId: string, goalId: string) => void,
  runningGoals: new Set<string>(),
}

describe("ChangesRail", () => {
  it("shows loading indicator while workspaces are loading", () => {
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={[]} />)
    expect(screen.getByText("Loading workspaces…")).toBeInTheDocument()
  })

  it("shows workspace list when loaded with workspaces", () => {
    const workspaces = [
      codeWs("ws-1", "feature-branch", 1000),
      codeWs("ws-2", "bugfix", 2000),
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument()
    expect(screen.getByText(/bugfix/)).toBeInTheDocument()
  })

  it("hides loading indicator once workspaces arrive", () => {
    const workspaces = [
      codeWs("ws-1", "my-workspace", 1000),
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/my-workspace/)).toBeInTheDocument()
  })

  it("collapsed rail does not show loading text", () => {
    render(<ChangesRail {...baseProps} open={false} workspacesLoading={true} workspaces={[]} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
  })

  it("shows spinner when a goal is in runningGoals", () => {
    const workspaces = [
      codeWs("ws-1", "feature", 1000, [
        { id: "g-1", text: "make it bold", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "running" as const },
      ]),
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        runningGoals={new Set(["g-1"])}
      />,
    )
    expect(screen.getByTitle("Agent running")).toBeInTheDocument()
  })

  it("does not show spinner when no goals are running", () => {
    const workspaces = [
      codeWs("ws-1", "feature", 1000, [
        { id: "g-1", text: "make it bold", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "done" as const },
      ]),
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        runningGoals={new Set<string>()}
      />,
    )
    expect(screen.queryByTitle("Agent running")).not.toBeInTheDocument()
  })

  it("shows spinner only for workspace with running goal, not others", () => {
    const workspaces = [
      codeWs("ws-1", "active-ws", 2000, [
        { id: "g-1", text: "running goal", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "running" as const },
      ]),
      codeWs("ws-2", "idle-ws", 1000, [
        { id: "g-2", text: "done goal", label: "span", target: "component:Y", mode: "code" as const, createdAt: 1000, status: "done" as const },
      ]),
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        runningGoals={new Set(["g-1"])}
      />,
    )
    const spinners = screen.getAllByTitle("Agent running")
    expect(spinners).toHaveLength(1)
  })

  it("opens a workspace context menu with create pull request", () => {
    const onCreatePullRequest = vi.fn()
    const workspaces = [
      codeWs("ws-1", "feature", 1000),
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        onCreatePullRequest={onCreatePullRequest}
      />,
    )

    fireEvent.contextMenu(screen.getByText(/feature/), { clientX: 10, clientY: 20 })
    fireEvent.click(screen.getByText("Create pull request"))

    expect(onCreatePullRequest).toHaveBeenCalledWith("ws-1")
  })
})
