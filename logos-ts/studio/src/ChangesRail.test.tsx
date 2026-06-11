import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { ChangesRail } from "./ChangesRail"

afterEach(cleanup)

const noop = () => {}

const baseProps = {
  open: true,
  onToggle: noop,
  comments: [],
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onBase: noop,
  onNewWorkspace: noop,
  onOpenWorkspace: noop as (id: string) => void,
  onFork: noop,
  onSelectComment: noop as (id: string) => void,
  onDeleteWorkspace: noop as (id: string) => void,
  onDeleteComment: noop as (id: string) => void,
  agentRunning: false,
  agentWorkspace: null,
}

describe("ChangesRail", () => {
  it("shows loading indicator while workspaces are loading", () => {
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={[]} />)
    expect(screen.getByText("Loading workspaces…")).toBeInTheDocument()
    expect(screen.queryByText(/none yet/)).not.toBeInTheDocument()
  })

  it("shows empty message when loaded with no workspaces", () => {
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={[]} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/none yet/)).toBeInTheDocument()
  })

  it("shows workspace list when loaded with workspaces", () => {
    const workspaces = [
      { id: "ws-1", name: "feature-branch", createdAt: 1000, fromBase: true },
      { id: "ws-2", name: "bugfix", createdAt: 2000, fromBase: true },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={false} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.queryByText(/none yet/)).not.toBeInTheDocument()
    expect(screen.getByText(/feature-branch/)).toBeInTheDocument()
    expect(screen.getByText(/bugfix/)).toBeInTheDocument()
  })

  it("hides loading indicator once workspaces arrive", () => {
    const workspaces = [
      { id: "ws-1", name: "my-workspace", createdAt: 1000, fromBase: true },
    ]
    render(<ChangesRail {...baseProps} workspacesLoading={true} workspaces={workspaces} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
    expect(screen.getByText(/my-workspace/)).toBeInTheDocument()
  })

  it("collapsed rail does not show loading text", () => {
    render(<ChangesRail {...baseProps} open={false} workspacesLoading={true} workspaces={[]} />)
    expect(screen.queryByText("Loading workspaces…")).not.toBeInTheDocument()
  })
})
