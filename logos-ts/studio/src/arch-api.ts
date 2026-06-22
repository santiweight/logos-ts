import type { Goal, WorkspaceInitialization, WorkspacePublication } from "./types"

export type ArchNodeKind =
  | "app"
  | "group"
  | "module"
  | "component"
  | "story"
  | "test"
  | "service"
  | "data"
  | "type"
  | "run"

export type ArchNodeStatus = "added" | "changed" | "removed" | "failed" | "running"
export type ArchCheckStatus = "pending" | "running" | "pass" | "fail" | "idle"

export interface ArchWorkspaceSummary {
  id: string
  name: string
  kind: "arch"
  parentId: string | null
  createdAt: number
  activeSnapshotId: string
  goals: Goal[]
  initialization?: WorkspaceInitialization
  publication?: WorkspacePublication
}

export interface ArchTreeNode {
  id: string
  parentId: string | null
  kind: ArchNodeKind
  label: string
  path: string
  target?: string
  status?: ArchNodeStatus
  comments: number
  tests: number
  stories: number
  selectable: boolean
}

export interface ArchTreeResponse {
  workspaceId: string
  snapshotId: string
  rootNodeId: string
  nodes: ArchTreeNode[]
}

export type ArchContentSection =
  | {
      kind: "summary"
      title: string
      body: string
    }
  | {
      kind: "contract"
      title: string
      fields: { name: string; value: string }[]
    }
  | {
      kind: "stories"
      title: string
      stories: { id: string; label: string; previewId: string | null }[]
    }
  | {
      kind: "tests"
      title: string
      tests: { id: string; label: string; status: ArchCheckStatus }[]
    }
  | {
      kind: "diagnostics"
      title: string
      diagnostics: ArchDiagnostic[]
    }

export interface ArchContentResponse {
  workspaceId: string
  snapshotId: string
  nodeId: string
  title: string
  kind: ArchNodeKind
  sections: ArchContentSection[]
  primaryPreviewId?: string
}

export interface ArchDiagnostic {
  id: string
  kind: "storybook" | "app" | "test" | "typecheck" | "architecture" | "implementation"
  status: ArchCheckStatus
  severity: "info" | "warning" | "error"
  title: string
  message?: string
  nodeIds: string[]
  startedAt?: number
  completedAt?: number
}

export interface ArchPreview {
  id: string
  kind: "storybook" | "app"
  label: string
  status: "starting" | "ready" | "failed"
  url: string | null
  nodeIds: string[]
  error?: string
}

export interface ArchEvaluationResponse {
  workspaceId: string
  snapshotId: string
  status: "idle" | "running" | "pass" | "fail"
  checks: ArchDiagnostic[]
  previews: ArchPreview[]
}

export interface ArchReviewChange {
  id: string
  status: "added" | "changed" | "removed"
  title: string
  nodeIds: string[]
  before?: string
  after?: string
}

export interface ArchSnapshotChange {
  id: string
  component: string
  story: string
  status: "added" | "changed" | "removed"
  beforeHtml?: string
  afterHtml?: string
}

export interface ArchReviewResponse {
  workspaceId: string
  baseSnapshotId: string
  snapshotId: string
  architectureChanges: ArchReviewChange[]
  snapshotChanges: ArchSnapshotChange[]
}

export interface ArchWorkspaceResponse {
  workspace: ArchWorkspaceSummary
  tree: ArchTreeResponse
  evaluation: ArchEvaluationResponse
  review: ArchReviewResponse
}
