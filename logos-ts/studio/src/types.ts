export interface StoryNode {
  id: string
  exportName: string
}
export interface CapturedNode {
  exportName: string
  testFile: string
  snapshot: string | null
}
export interface ComponentEntry {
  name: string
  file: string
  storiesFile: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
  deps: string[]
  stories: StoryNode[]
  captured: CapturedNode[]
}

// ---- backend ----
export interface TestRef {
  name: string
  file: string
  description?: string
  code: string
}
export interface BackendFn {
  kind: "function"
  name: string
  signature: string
  code: string
  deps: string[]
  tests: TestRef[]
}
export interface BackendMethod {
  name: string
  signature: string
  code: string
  tests: TestRef[]
}
export interface BackendClass {
  kind: "class"
  name: string
  fields: { name: string; type: string }[]
  methods: BackendMethod[]
  deps: string[]
  tests: TestRef[]
  code: string
}
export type BackendItem = BackendFn | BackendClass
export interface BackendFile {
  file: string
  code: string
  items: BackendItem[]
}

export interface StudioIndex {
  root: string
  storybookUrl: string
  components: ComponentEntry[]
  backend: BackendFile[]
}

export type View = "code" | "arch" | "story" | "captured"

export interface Selection {
  comp: string
  view: View
  storyId?: string
  exportName?: string
}

// Backend nodes are addressed by name only — no file, no method paths.
export interface BackendSel {
  symbol: string
}

export interface Comment {
  id: string
  target: string
  label: string
  text: string
  workspaceId: string | null
  mode: "code" | "arch"
  createdAt: number
  author?: string
  storyId?: string | null
  selector?: string | null
  component?: string | null
  agentId?: string | null
  agentStatus?: string | null
}

export interface CommentApi {
  comments: Record<string, Comment[]>
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

// A workspace = a branch: a cheap copy of the whole index that accumulates
// changes (comments). Iterate by adding comments to it; Fork to branch.
export interface WorkspaceMeta {
  id: string
  name: string
  parentId?: string | null
  createdAt: number
}
export interface Workspace extends WorkspaceMeta {
  index: StudioIndex
}
