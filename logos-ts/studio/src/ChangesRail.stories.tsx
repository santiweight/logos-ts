import type { Meta, StoryObj } from "@storybook/react-vite"
import type { Goal, WorkspaceMeta } from "./types"
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

const goal1: Goal = {
  id: "g-1",
  target: "fn:loadProject",
  label: "loadProject",
  text: "Add glob pattern parameter so callers can scope the file set",
  mode: "code",
  createdAt: Date.now() - 240_000,
  status: "done",
}

const goal2: Goal = {
  id: "g-2",
  target: "cls:StudioIndex",
  label: "StudioIndex",
  text: "Flatten into a single files[] array",
  mode: "arch",
  createdAt: Date.now() - 120_000,
  status: "pending",
}

const goalRunning: Goal = {
  id: "g-3",
  target: "fn:buildContext",
  label: "buildContext",
  text: "Add import-cycle detection and emit a warning",
  mode: "code",
  createdAt: Date.now() - 90_000,
  status: "running",
}

const goalError: Goal = {
  id: "g-4",
  target: "fn:extractArchitecture",
  label: "extractArchitecture",
  text: "Return early when no source files are found",
  mode: "arch",
  createdAt: Date.now() - 60_000,
  status: "error",
}

const ws1: WorkspaceMeta = {
  id: "ws-1",
  name: "loadProject",
  kind: "code",
  parentId: null,
  createdAt: Date.now() - 300_000,
  baseInstanceId: "inst-1",
  activeInstanceId: "inst-1",
  goals: [goal1],
}

const ws2: WorkspaceMeta = {
  id: "ws-2",
  name: "workspace-2",
  kind: "code",
  parentId: "ws-1",
  createdAt: Date.now() - 60_000,
  baseInstanceId: "inst-2",
  activeInstanceId: "inst-2",
  goals: [],
}

const wsArch: WorkspaceMeta = {
  id: "ws-arch",
  name: "StudioIndex",
  kind: "arch",
  parentId: null,
  createdAt: Date.now() - 180_000,
  baseInstanceId: "inst-arch",
  activeInstanceId: "inst-arch",
  goals: [goal2],
}

const baseArgs = {
  open: true,
  onToggle: noop,
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onOpenWorkspace: noop,
  onCreatePullRequest: noop,
  onSelectGoal: noop,
  onDeleteWorkspace: noop,
  onDeleteGoal: noop,
  onAcceptGoal: noop,
  runningGoals: new Set<string>(),
  onResizeStart: noop,
}

export const Empty: Story = {
  args: baseArgs,
}

export const Collapsed: Story = {
  args: {
    ...baseArgs,
    open: false,
    workspaces: [ws1, ws2],
  },
}

export const CollapsedEmpty: Story = {
  args: {
    ...baseArgs,
    open: false,
  },
}

export const Loading: Story = {
  args: {
    ...baseArgs,
    workspacesLoading: true,
  },
}

export const WithWorkspaces: Story = {
  args: {
    ...baseArgs,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-1",
  },
}

export const WorkspaceSelected: Story = {
  args: {
    ...baseArgs,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-2",
    selected: { type: "workspace", id: "ws-2" },
  },
}

export const AgentRunning: Story = {
  args: {
    ...baseArgs,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-1",
    runningGoals: new Set(["g-1"]),
  },
}

export const GoalSelected: Story = {
  args: {
    ...baseArgs,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-1",
    selected: { type: "goal", id: "g-1" },
  },
}

export const AllGoalStatuses: Story = {
  args: {
    ...baseArgs,
    workspaces: [
      ws1,
      { ...ws2, id: "ws-status-pending", name: "StudioIndex", parentId: "ws-1", goals: [goal2] },
      { ...ws2, id: "ws-status-running", name: "buildContext", parentId: "ws-1", goals: [goalRunning] },
      { ...ws2, id: "ws-status-error", name: "extractArchitecture", parentId: "ws-1", goals: [goalError] },
    ],
    activeWorkspaceId: "ws-1",
    runningGoals: new Set(["g-3"]),
  },
}

export const GoalRunning: Story = {
  args: {
    ...baseArgs,
    workspaces: [
      {
        ...ws1,
        goals: [goalRunning],
      },
    ],
    activeWorkspaceId: "ws-1",
    runningGoals: new Set(["g-3"]),
  },
}

export const ArchWorkspace: Story = {
  args: {
    ...baseArgs,
    workspaces: [wsArch],
    activeWorkspaceId: "ws-arch",
  },
}

export const ForkedWorkspace: Story = {
  args: {
    ...baseArgs,
    workspaces: [ws1, ws2],
    activeWorkspaceId: "ws-2",
  },
}

export const ManyWorkspaces: Story = {
  args: {
    ...baseArgs,
    workspaces: [
      ws1,
      ws2,
      wsArch,
      {
        id: "ws-3",
        name: "workspace-3",
        kind: "code",
        parentId: null,
        createdAt: Date.now() - 400_000,
        baseInstanceId: "inst-3",
        activeInstanceId: "inst-3",
        goals: [],
      },
      {
        id: "ws-4",
        name: "workspace-4",
        kind: "arch",
        parentId: "ws-3",
        createdAt: Date.now() - 10_000,
        baseInstanceId: "inst-4",
        activeInstanceId: "inst-4",
        goals: [goalRunning],
      },
    ],
    activeWorkspaceId: "ws-1",
    runningGoals: new Set(["g-3"]),
  },
}
