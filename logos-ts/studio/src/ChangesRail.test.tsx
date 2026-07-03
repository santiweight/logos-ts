import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { ChangesRail } from "./ChangesRail"
import type { WorkspaceMeta } from "./types"

afterEach(cleanup)

const noop = () => {}

const baseProps = {
  open: true,
  onToggle: noop,
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onOpenWorkspace: noop as (id: string) => void,
  onCreatePullRequest: noop as (id: string) => void,
  onSelectGoal: noop as (workspaceId: string, goalId: string) => void,
  onDeleteWorkspace: noop as (id: string) => void,
  onDeleteGoal: noop as (wsId: string, goalId: string) => void,
  onAcceptGoal: noop as (goalId: string) => void,
  runningGoals: new Set<string>(),
  onResizeStart: noop,
}

describe("ChangesRail", () => {
  it("labels the rail as workspaces and keeps create/reset actions out of the rail header", () => {
    render(<ChangesRail {...baseProps} />)

    expect(screen.getByText("WORKSPACES")).toBeInTheDocument()
    expect(screen.queryByTitle("New workspace")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Reset all workspaces")).not.toBeInTheDocument()
  })

  it("shows loading indicator while workspaces are loading", () => {
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={[]} />)
    expect(screen.getByText("Loading workspaces…")).toBeInTheDocument()
  })

  it("shows workspace list when loaded with workspaces", () => {
    const workspaces: WorkspaceMeta[] = [
      { id: "ws-1", name: "feature-branch", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
      { id: "ws-2", name: "bugfix", kind: "code" as const, parentId: null, createdAt: 2000, baseInstanceId: "inst-2", activeInstanceId: "inst-2", goals: [] },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument()
    expect(screen.getByText(/bugfix/)).toBeInTheDocument()
  })

  it("hides loading indicator once workspaces arrive", () => {
    const workspaces: WorkspaceMeta[] = [
      { id: "ws-1", name: "my-workspace", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/my-workspace/)).toBeInTheDocument()
  })

  it("renders child workspaces under their parent", () => {
    const workspaces = [
      { id: "ws-parent", name: "Scratch", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
      { id: "ws-child", name: "Generate Stories for JobCard", kind: "code" as const, parentId: "ws-parent", createdAt: 3000, baseInstanceId: "inst-2", activeInstanceId: "inst-2", goals: [] },
    ]
    render(<ChangesRail {...baseProps} workspaces={workspaces} />)

    const parent = screen.getByText("Scratch").closest(".rail-row")
    const child = screen.getByText("Generate Stories for JobCard").closest(".rail-row")

    expect(parent).not.toBeNull()
    expect(child).not.toBeNull()
    expect(parent!.compareDocumentPosition(child!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("collapsed rail does not show loading text", () => {
    render(<ChangesRail {...baseProps} open={false} workspacesLoading={true} workspaces={[]} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Open workspaces")).toBeInTheDocument()
  })

  it("marks the workspace row as running when a change is in runningGoals", () => {
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
    expect(screen.getByText("feature").closest(".rail-row")).toHaveClass("running")
    expect(screen.queryByTitle("Agent running")).not.toBeInTheDocument()
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
    expect(screen.getByText("feature").closest(".rail-row")).not.toHaveClass("running")
    expect(screen.queryByTitle("Agent running")).not.toBeInTheDocument()
  })

  it("marks only the workspace with a running change", () => {
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
    expect(screen.getByText("active-ws").closest(".rail-row")).toHaveClass("running")
    expect(screen.getByText("idle-ws").closest(".rail-row")).not.toHaveClass("running")
    expect(screen.queryByTitle("Agent running")).not.toBeInTheDocument()
  })

  it("shows a single loading line instead of initialization sub-steps", () => {
    const workspaces: WorkspaceMeta[] = [
      {
        id: "ws-1",
        name: "loading-workspace",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [],
        initialization: {
          status: "initializing" as const,
          updatedAt: 1000,
          steps: [
            { id: "materialize", label: "Materialize workspace", status: "done" as const },
            { id: "story_snapshots", label: "Capture story snapshots", status: "running" as const },
            { id: "commit_baseline", label: "Commit snapshot baseline", status: "pending" as const },
            { id: "index", label: "Index workspace", status: "pending" as const },
          ],
        },
      },
    ]

    render(<ChangesRail {...baseProps} workspaces={workspaces} activeWorkspaceId="ws-1" />)

    expect(screen.getByText("Loading workspace…")).toBeInTheDocument()
    expect(screen.queryByText("Materialize workspace")).not.toBeInTheDocument()
    expect(screen.queryByText("Capture story snapshots")).not.toBeInTheDocument()
    expect(screen.getByTitle("Workspace initializing")).toBeInTheDocument()
  })

  it("uses the workspace row as the thread row", () => {
    const workspaces = [
      {
        id: "ws-1",
        name: "Make Bold",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [
          {
            id: "g-1",
            text: "make this bold",
            label: "Make Bold",
            target: "component:X",
            mode: "code" as const,
            createdAt: 1000,
            status: "pending" as const,
          },
        ],
      },
    ]

    render(<ChangesRail {...baseProps} workspaces={workspaces} activeWorkspaceId="ws-1" />)

    expect(screen.getByText("Make Bold")).toBeInTheDocument()
    expect(screen.queryByText("make this bold")).not.toBeInTheDocument()
    expect(screen.queryByText("pending")).not.toBeInTheDocument()
    expect(document.querySelector(".rail-row.comment")).toBeNull()
  })

  it("selects a workspace thread with its owning workspace id", () => {
    const onSelectGoal = vi.fn()
    const workspaces = [
      {
        id: "ws-1",
        name: "Make Bold",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [
          {
            id: "g-1",
            text: "make this bold",
            label: "Make Bold",
            target: "component:X",
            mode: "code" as const,
            createdAt: 1000,
            status: "pending" as const,
          },
        ],
      },
    ]

    render(<ChangesRail {...baseProps} workspaces={workspaces} activeWorkspaceId="ws-1" onSelectGoal={onSelectGoal} />)

    fireEvent.click(screen.getByText("Make Bold"))

    expect(onSelectGoal).toHaveBeenCalledWith("ws-1", "g-1")
  })

  it("does not render branch text for child workspaces", () => {
    const workspaces = [
      { id: "ws-parent", name: "Scratch", kind: "code" as const, parentId: null, createdAt: 1000, baseInstanceId: "inst-1", activeInstanceId: "inst-1", goals: [] },
      { id: "ws-child", name: "Generate Stories for JobCard", kind: "code" as const, parentId: "ws-parent", createdAt: 3000, baseInstanceId: "inst-2", activeInstanceId: "inst-2", goals: [] },
    ]

    render(<ChangesRail {...baseProps} workspaces={workspaces} />)

    expect(screen.queryByText(/branch/)).not.toBeInTheDocument()
  })

  it("throws when a workspace has more than one thread", () => {
    const workspaces = [
      {
        id: "ws-1",
        name: "Too Many Threads",
        kind: "code" as const,
        parentId: null,
        createdAt: 1000,
        baseInstanceId: "inst-1",
        activeInstanceId: "inst-1",
        goals: [
          { id: "g-1", text: "first", label: "First", target: "component:X", mode: "code" as const, createdAt: 1000, status: "pending" as const },
          { id: "g-2", text: "second", label: "Second", target: "component:Y", mode: "code" as const, createdAt: 1001, status: "pending" as const },
        ],
      },
    ]

    expect(() => render(<ChangesRail {...baseProps} workspaces={workspaces} />)).toThrow(/one thread per workspace/)
  })

  it("does not open a merge request context menu from workspace rows", () => {
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

    expect(screen.queryByText("Create or update merge request")).not.toBeInTheDocument()
    expect(onCreatePullRequest).not.toHaveBeenCalled()
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

  it("shows attached pull request and push-updates action for the active workspace", () => {
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

    expect(screen.queryByText("origin/logos/feature")).not.toBeInTheDocument()
    expect(screen.getByText("PR #42")).toHaveAttribute("href", "https://github.com/acme/repo/pull/42")
    expect(screen.queryByTitle("Push updates to pull request")).not.toBeInTheDocument()
    expect(screen.getByTitle("Pull request is up to date")).toBeDisabled()
    expect(screen.queryByText("Update MR")).not.toBeInTheDocument()
  })

  it("offers push updates when goals are newer than the attached pull request", () => {
    const onCreatePullRequest = vi.fn()
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
          { id: "g-1", text: "new work", label: "div", target: "component:X", mode: "code" as const, createdAt: 3000, status: "done" as const },
        ],
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
    render(
      <ChangesRail
        {...baseProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        onCreatePullRequest={onCreatePullRequest}
      />,
    )

    fireEvent.click(screen.getByTitle("Push updates to pull request"))

    expect(onCreatePullRequest).toHaveBeenCalledWith("ws-1")
  })

  it("does not show visible trash controls on change rows", () => {
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
          { id: "g-1", text: "make it bold", label: "div", target: "component:X", mode: "code" as const, createdAt: 1000, status: "pending" as const },
        ],
      },
    ]
    render(<ChangesRail {...baseProps} workspaces={workspaces} activeWorkspaceId="ws-1" />)

    expect(document.querySelector(".rail-row.comment")).toBeNull()
    expect(screen.queryByTitle("Delete change (⌘⌫)")).not.toBeInTheDocument()
  })
})
