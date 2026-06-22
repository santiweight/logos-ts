export interface TestRef {
  name: string
  file: string
  description?: string
  code: string
}
export interface StoryNode {
  id: string
  exportName: string
  storyFile?: string
  storybookRoot?: string
  storyCode?: string
  snapshot: string | null
}
export interface ComponentEntry {
  name: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
  stories: StoryNode[]
}
export interface BackendMethod {
  name: string
  signature: string
  code: string
  tests: TestRef[]
}

export interface FileFn {
  kind: "function"
  name: string
  signature: string
  code: string
  deps: string[]
  tests: TestRef[]
}
export interface FileClass {
  kind: "class"
  name: string
  fields: { name: string; type: string }[]
  methods: BackendMethod[]
  deps: string[]
  tests: TestRef[]
  code: string
}
export interface FileType {
  kind: "type"
  name: string
  signature: string
  code: string
}
export type FileItem = FileFn | FileClass | FileType

export interface FileEntry {
  file: string
  code: string
  items: FileItem[]
  components?: ComponentEntry[]
  // Compatibility alias for older consumers; prefer components.
  component?: ComponentEntry
}

export interface SymbolLocation { file: string; line: number }
export interface StudioIndex {
  root: string
  files: FileEntry[]
  symbols?: Record<string, SymbolLocation>
}

export type View = "code" | "arch" | "story" | "run"

export interface Selection {
  file: string
  symbol?: string
  component?: string
  view: View
  storyId?: string
  exportName?: string
  runTargetId?: string
}

export interface GoalReply {
  author: "agent" | "user"
  text: string
  createdAt: number
}

export type GoalLifecycle =
  | {
      stage: "initializing"
      state: "creating_goal" | "creating_workspace" | "creating_instance" | "starting_session"
    }
  | {
      stage: "impl"
      state: "agent_running" | "agent_finished" | "ready_to_merge" | "impl_blocked" | "impl_failed"
    }
  | {
      stage: "merging"
      state: "queued" | "rebasing" | "resolving_conflicts" | "running_tests" | "repairing_tests" | "promoting_instance" | "merge_blocked" | "merge_failed"
    }
  | {
      stage: "merged"
      state: "complete"
    }

export interface GoalMergePolicy {
  autoMerge: boolean
}

export interface Goal {
  id: string
  text: string
  label: string
  target: string
  mode: "code" | "arch"
  createdAt: number
  storyId?: string | null
  selector?: string | null
  component?: string | null
  appPath?: string | null
  runTargetId?: string | null
  status: "pending" | "running" | "done" | "error"
  lifecycle?: GoalLifecycle
  mergePolicy?: GoalMergePolicy
  baseInstanceId?: string | null
  workingInstanceId?: string | null
  mergedInstanceId?: string | null
  sessionId?: string | null
  replies?: GoalReply[]
}

export type WorkspaceKind = "code" | "arch"

export interface WorkspacePublication {
  branchName: string
  remote: string
  commit: string
  changed: boolean
  pullRequest?: {
    number: number | null
    url: string
    created: boolean
  }
  updatedAt: number
}

export interface WorkspaceInitializationStep {
  id: "materialize" | "story_snapshots" | "commit_baseline" | "index"
  label: string
  status: "pending" | "running" | "done" | "error"
  detail?: string
  error?: string
}

export interface WorkspaceInitialization {
  status: "initializing" | "ready" | "error"
  updatedAt: number
  steps: WorkspaceInitializationStep[]
}

export interface GoalApi {
  comments: Record<string, Goal[]>
  onComment: (target: string, label: string, x: number, y: number) => void
}

export type DiffStatus = "added" | "changed" | "removed"

export interface TestFailure {
  test: string
  file: string
  message: string
}
export interface TestRun {
  total: number
  passed: number
  failed: number
  failures: TestFailure[]
}
export interface TestState {
  status: "running" | "pass" | "fail" | "idle"
  results: TestRun | null
  runningSince: number | null
}

export interface SbState {
  status: "starting" | "ready" | "failed"
  startedAt: number
  logs: string[]
  error?: string
}

export interface RunTarget {
  id: string
  label: string
  cwd: string
  command: string
  args: string[]
  framework?: "vite" | "next"
  env?: Record<string, string>
}

export interface RunState {
  id: string
  workspaceId: string
  targetId: string
  status: "starting" | "ready" | "failed"
  startedAt: number
  logs: string[]
  error?: string
}

export interface WorkspaceMeta {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseInstanceId: string
  activeInstanceId: string
  goals: Goal[]
  initialization?: WorkspaceInitialization
  publication?: WorkspacePublication
}

export interface WorkspaceInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: StudioIndex
}

export interface Workspace extends WorkspaceMeta {
  forkDir: string
  index: StudioIndex
  instances: Record<string, WorkspaceInstance>
}
