import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
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
      { id: "ws-1", name: "feature-branch", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
      { id: "ws-2", name: "bugfix", kind: "code" as const, parentId: null, createdAt: 2000, baseInstanceId: "inst-2", activeInstanceId: "inst-2", goals: [] },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument()
    expect(screen.getByText(/bugfix/)).toBeInTheDocument()
  })

  it("hides loading indicator once workspaces arrive", () => {
    const workspaces = [
      { id: "ws-1", name: "my-workspace", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
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
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
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
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
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
        kind: "code" as const,
        parentId: null,
        createdAt: 2000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [
          { id: "g-1", text: "running goal", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "running" as const },
        ],
      },
      {
        id: "ws-2",
        name: "idle-ws",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-2",
        activeInstanceId: "inst-2",
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

  it("opens a workspace context menu with create or update merge request", () => {
    const onCreatePullRequest = vi.fn()
    const workspaces = [
      { id: "ws-1", name: "feature", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        onCreatePullRequest={onCreatePullRequest}
      />,
    )

    fireEvent.contextMenu(screen.getByText(/feature/), { clientX: 10, clientY: 20 })
    fireEvent.click(screen.getByText("Create or update merge request"))

    expect(onCreatePullRequest).toHaveBeenCalledWith("ws-1")
  })

  it("creates pull requests from the workspace row button", () => {
    const onCreatePullRequest = vi.fn()
    const workspaces = [
      { id: "ws-1", name: "feature", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
    ]
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        onCreatePullRequest={onCreatePullRequest}
      />,
    )

    fireEvent.click(screen.getByTitle("Make pull request"))

    expect(onCreatePullRequest).toHaveBeenCalledWith("ws-1")
  })

  it("shows attached branch and pull request for the active workspace", () => {
    const workspaces = [
      {
        id: "ws-1",
        name: "feature",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [],
        publication: {
          branchName: "logos/feature",
          remote: "origin",
          commit: "abc123",
          changed: true,
          updatedAt: 2000,
          pullRequest: { number: 42, url: "https://github.com/acme/repo/pull/42", created: true },
        },
      },
    ]
    render(<ChangesRail {...baseProps} workspaces={workspaces} activeWorkspaceId="ws-1" />)

    expect(screen.getByText("origin/logos/feature")).toBeInTheDocument()
    expect(screen.getByText("pull request")).toHaveAttribute("href", "https://github.com/acme/repo/pull/42")
    expect(screen.getByText("PR #42")).toHaveAttribute("href", "https://github.com/acme/repo/pull/42")
  })
})
