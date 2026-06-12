import type { Meta, StoryObj } from "@storybook/react-vite"
import type { Comment, WorkspaceMeta } from "./types"
import { ChangesRail } from "./ChangesRail"

const meta: Meta<typeof ChangesRail> = {
  component: ChangesRail,
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof ChangesRail>

const noop = () => {}

const ws1: WorkspaceMeta = {
  id: "ws-1",
  name: "workspace-1",
  createdAt: Date.now() - 300_000,
}

const ws2: WorkspaceMeta = {
  id: "ws-2",
  name: "workspace-2",
  parentId: "ws-1",
  createdAt: Date.now() - 60_000,
}

const comment1: Comment = {
  id: "c-1",
  target: "fn:loadProject",
  label: "loadProject",
  text: "Add glob pattern parameter so callers can scope the file set",
  workspaceId: "ws-1",
  mode: "code",
  createdAt: Date.now() - 240_000,
}

const comment2: Comment = {
  id: "c-2",
  target: "cls:StudioIndex",
  label: "StudioIndex",
  text: "Flatten into a single files[] array",
  workspaceId: "ws-1",
  mode: "arch",
  createdAt: Date.now() - 120_000,
}

export const Empty: Story = {
  args: {
    open: true,
    onToggle: noop,
    comments: [],
    workspaces: [],
    workspacesLoading: false,
    activeWorkspaceId: null,
    selected: null,
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

export const Collapsed: Story = {
  args: {
    ...Empty.args,
    open: false,
    workspaces: [ws1, ws2],
  },
}

export const Loading: Story = {
  args: {
    ...Empty.args,
    workspacesLoading: true,
  },
}

export const WithWorkspaces: Story = {
  args: {
    ...Empty.args,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-1",
    comments: [comment1, comment2],
  },
}

export const AgentRunning: Story = {
  args: {
    ...WithWorkspaces.args,
    agentRunning: true,
    agentWorkspace: "ws-1",
  },
}

export const CommentSelected: Story = {
  args: {
    ...WithWorkspaces.args,
    selected: { type: "comment", id: "c-2" },
  },
}
