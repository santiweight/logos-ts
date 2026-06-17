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

const codeWs = (id: string, name: string, createdAt: number, goals: Goal[] = [], parentId: string | null = null): WorkspaceMeta => ({
  id,
  name,
  kind: "code",
  parentId,
  createdAt,
  baseArcWsInstanceId: null,
  activeArcWsInstanceId: null,
  goldenArcWsInstanceId: null,
  baseImplWsInstanceId: `impl-${id}`,
  activeImplWsInstanceId: `impl-${id}`,
  goals,
})

const archWs = (id: string, name: string, createdAt: number, goals: Goal[] = [], parentId: string | null = null): WorkspaceMeta => ({
  id,
  name,
  kind: "arch",
  parentId,
  createdAt,
  baseArcWsInstanceId: `arc-${id}`,
  activeArcWsInstanceId: `arc-${id}`,
  goldenArcWsInstanceId: `arc-${id}`,
  baseImplWsInstanceId: null,
  activeImplWsInstanceId: null,
  goals,
})

const ws1: WorkspaceMeta = {
  ...codeWs("ws-1", "workspace-1", Date.now() - 300_000, [goal1, goal2]),
}

const ws2: WorkspaceMeta = {
  ...codeWs("ws-2", "workspace-2", Date.now() - 60_000, [], "ws-1"),
}

const wsArch: WorkspaceMeta = {
  ...archWs("ws-arch", "workspace-arch", Date.now() - 180_000, [goal2, goalError]),
}

const baseArgs = {
  open: true,
  onToggle: noop,
  workspaces: [],
  workspacesLoading: false,
  activeWorkspaceId: null,
  selected: null,
  onNewWorkspace: noop,
  onResetWorkspaces: noop,
  onOpenWorkspace: noop,
  onFork: noop,
  onCreatePullRequest: noop,
  onSelectGoal: noop,
  onDeleteWorkspace: noop,
  onDeleteGoal: noop,
  runningGoals: new Set<string>(),
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
    selected: { type: "goal", id: "g-2" },
  },
}

export const AllGoalStatuses: Story = {
  args: {
    ...baseArgs,
    workspaces: [
      {
        ...ws1,
        goals: [goal1, goal2, goalRunning, goalError],
      },
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
      codeWs("ws-3", "workspace-3", Date.now() - 400_000),
      archWs("ws-4", "workspace-4", Date.now() - 10_000, [goalRunning], "ws-3"),
    ],
    activeWorkspaceId: "ws-1",
    runningGoals: new Set(["g-3"]),
  },
}
