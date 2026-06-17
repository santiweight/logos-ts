export interface TestRef {
  name: string
  file: string
  description?: string
  code: string
}
export interface StoryNode {
  id: string
  exportName: string
}
export interface CapturedNode {
  exportName: string
  testFile: string
  snapshot: string | null
  previousSnapshot: string | null
}
export interface ComponentEntry {
  name: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
  stories: StoryNode[]
  captured: CapturedNode[]
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
export type FileItem = FileFn | FileClass

export interface FileEntry {
  file: string
  code: string
  items: FileItem[]
  components?: ComponentEntry[]
  // Compatibility alias for older consumers; prefer components.
  component?: ComponentEntry
}

export interface StudioIndex {
  root: string
  files: FileEntry[]
}

export type View = "code" | "arch" | "story" | "captured"

export interface Selection {
  file: string
  symbol?: string
  component?: string
  view: View
  storyId?: string
  exportName?: string
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
  status: "pending" | "running" | "done" | "error"
  sessionId?: string | null
}

export type WorkspaceKind = "code" | "arch"

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

export interface WorkspaceMeta {
  id: string
  name: string
  kind: WorkspaceKind
  parentId: string | null
  createdAt: number
  baseArcWsInstanceId: string | null
  activeArcWsInstanceId: string | null
  goldenArcWsInstanceId: string | null
  baseImplWsInstanceId: string | null
  activeImplWsInstanceId: string | null
  goals: Goal[]
}

export interface ArcWsInstance {
  id: string
  workspaceId: string
  materializedRoot: string
  bodyRecordsFile: string | null
  mutability: "writable" | "immutable"
  createdAt: number
  index: StudioIndex
}

export interface ImplValidationResult {
  status: "pass" | "fail"
  checkedAt: number
  issues: string[]
}

export interface ImplWsInstance {
  id: string
  workspaceId: string
  arcWsInstanceId: string | null
  materializedRoot: string
  mutability: "writable" | "immutable"
  createdAt: number
  index: StudioIndex
  validation: ImplValidationResult | null
}

export interface Workspace extends WorkspaceMeta {
  forkDir: string
  index: StudioIndex
  arcWsInstances: Record<string, ArcWsInstance>
  implWsInstances: Record<string, ImplWsInstance>
}
