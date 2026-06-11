import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChangesRail } from "./ChangesRail"
import type { Comment, WorkspaceMeta } from "./types"

const now = 1718100000000

const workspaces: WorkspaceMeta[] = [
  { id: "ws-1", name: "refactor-filters", createdAt: now - 3600000 },
  { id: "ws-2", name: "fix-search-bug", parentId: "ws-1", createdAt: now - 1800000 },
  { id: "ws-3", name: "add-dark-mode", createdAt: now },
]

const comments: Comment[] = [
  { id: "c1", target: "fn:parseJob", label: "parseJob", text: "Extract date parsing into a helper", workspaceId: "ws-1", mode: "code", createdAt: now - 3000000 },
  { id: "c2", target: "fn:filterJobs", label: "filterJobs", text: "Add remote-only filter option", workspaceId: "ws-1", mode: "arch", createdAt: now - 2500000 },
  { id: "c3", target: "cls:JobStore", label: "JobStore", text: "Memoize the sorted list", workspaceId: "ws-2", mode: "code", createdAt: now - 1000000 },
]

const noop = () => {}

const meta: Meta<typeof ChangesRail> = {
  component: ChangesRail,
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    open: true,
    onToggle: noop,
    comments,
    workspaces,
    workspacesLoading: false,
    activeWorkspaceId: "ws-1",
    selected: null,
    onBase: noop,
    onNewWorkspace: noop,
    onOpenWorkspace: noop,
    onFork: noop,
    onSelectComment: noop,
    onDeleteWorkspace: noop,
    onDeleteComment: noop,
    agentRunning: false,
    agentWorkspace: null,
  },
}
export default meta

type Story = StoryObj<typeof ChangesRail>

export const Default: Story = {}

export const WithAgentRunning: Story = {
  args: { agentRunning: true, agentWorkspace: "ws-1" },
}

export const SelectedComment: Story = {
  args: { selected: { type: "comment", id: "c1" } },
}

export const Empty: Story = {
  args: { workspaces: [], comments: [], activeWorkspaceId: null },
}

export const Collapsed: Story = {
  args: { open: false },
}

export const Loading: Story = {
  args: { workspaces: [], workspacesLoading: true, activeWorkspaceId: null },
}

export const ManyWorkspaces: Story = {
  args: {
    workspaces: Array.from({ length: 12 }, (_, i) => ({
      id: `ws-${i}`,
      name: `workspace-${i}`,
      createdAt: now - i * 600000,
    })),
    activeWorkspaceId: "ws-0",
  },
}
