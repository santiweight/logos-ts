import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { ChangesRail } from "./ChangesRail"

afterEach(cleanup)

const noop = () => {}

const baseProps = {
  open: true,
  onToggle: noop,
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onNewWorkspace: noop,
  onOpenWorkspace: noop as (id: string) => void,
  onFork: noop,
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
      { id: "ws-1", name: "feature-branch", parentId: null, createdAt: 1000, goals: [] },
      { id: "ws-2", name: "bugfix", parentId: null, createdAt: 2000, goals: [] },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument()
    expect(screen.getByText(/bugfix/)).toBeInTheDocument()
  })

  it("hides loading indicator once workspaces arrive", () => {
    const workspaces = [
      { id: "ws-1", name: "my-workspace", parentId: null, createdAt: 1000, goals: [] },
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
      {
        id: "ws-1",
        name: "feature",
        parentId: null,
        createdAt: 1000,
        goals: [
          { id: "g-1", text: "make it bold", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "running" as const },
        ],
      },
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
      {
        id: "ws-1",
        name: "feature",
        parentId: null,
        createdAt: 1000,
        goals: [
          { id: "g-1", text: "make it bold", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "done" as const },
        ],
      },
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
      {
        id: "ws-1",
        name: "active-ws",
        parentId: null,
        createdAt: 2000,
        goals: [
          { id: "g-1", text: "running goal", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "running" as const },
        ],
      },
      {
        id: "ws-2",
        name: "idle-ws",
        parentId: null,
        createdAt: 1000,
        goals: [
          { id: "g-2", text: "done goal", label: "span", target: "component:Y", mode: "code" as const, createdAt: 1000, status: "done" as const },
        ],
      },
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
})
