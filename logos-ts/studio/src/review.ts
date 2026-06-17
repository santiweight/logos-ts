import type { StudioIndex, Workspace } from "./types"

const componentsOf = (file: StudioIndex["files"][number]) =>
  file.components?.length ? file.components : file.component ? [file.component] : []

export type CaptureChangeStatus = "added" | "changed" | "removed"

export interface CaptureChange {
  id: string
  component: string
  exportName: string
  testFile: string
  storyId: string | null
  status: CaptureChangeStatus
  beforeSnapshot: string | null
  afterSnapshot: string | null
}

interface IndexedCapture {
  component: string
  exportName: string
  testFile: string
  storyId: string | null
  snapshot: string | null
}

export function selectReviewBaseIndex(projectIndex: StudioIndex, parentWorkspaceIndex: StudioIndex | null): StudioIndex {
  return parentWorkspaceIndex ?? projectIndex
}

export function selectWorkspaceReviewBaseIndex(projectIndex: StudioIndex, workspace: Workspace | null): StudioIndex {
  if (!workspace) return projectIndex
  const baseArcId = workspace.goldenArcWsInstanceId ?? workspace.baseArcWsInstanceId
  if (baseArcId) return workspace.arcWsInstances[baseArcId]?.index ?? projectIndex
  const baseImplId = workspace.baseImplWsInstanceId
  return baseImplId ? workspace.implWsInstances[baseImplId]?.index ?? projectIndex : projectIndex
}

export function selectWorkspaceReviewIndex(workspace: Workspace | null): StudioIndex | null {
  if (!workspace) return null
  const arcId = workspace.activeArcWsInstanceId
  if (arcId) return workspace.arcWsInstances[arcId]?.index ?? workspace.index
  return workspace.index
}

export function selectWorkspaceOutcomeBaseIndex(projectIndex: StudioIndex, workspace: Workspace | null): StudioIndex {
  if (!workspace) return projectIndex
  const baseImplId = workspace.baseImplWsInstanceId
  return baseImplId ? workspace.implWsInstances[baseImplId]?.index ?? projectIndex : projectIndex
}

function captureMap(index: StudioIndex): Map<string, IndexedCapture> {
  const captures = new Map<string, IndexedCapture>()
  for (const file of index.files) {
    for (const component of componentsOf(file)) {
      for (const capture of component.captured) {
        const story = component.stories.find((candidate) => candidate.exportName === capture.exportName)
        const id = `${capture.testFile}::${capture.exportName}`
        captures.set(id, {
          component: component.name,
          exportName: capture.exportName,
          testFile: capture.testFile,
          storyId: story?.id ?? null,
          snapshot: capture.snapshot,
        })
      }
    }
  }
  return captures
}

export function capturedTestChanges(base: StudioIndex, workspace: StudioIndex): CaptureChange[] {
  const before = captureMap(base)
  const after = captureMap(workspace)
  const ids = new Set([...before.keys(), ...after.keys()])
  const changes: CaptureChange[] = []

  for (const id of ids) {
    const previous = before.get(id)
    const current = after.get(id)
    if (previous && current && previous.snapshot === current.snapshot) continue

    const capture = current ?? previous
    if (!capture) continue
    changes.push({
      id,
      component: capture.component,
      exportName: capture.exportName,
      testFile: capture.testFile,
      storyId: current?.storyId ?? previous?.storyId ?? null,
      status: previous ? current ? "changed" : "removed" : "added",
      beforeSnapshot: previous?.snapshot ?? null,
      afterSnapshot: current?.snapshot ?? null,
    })
  }

  return changes.sort((a, b) =>
    a.component.localeCompare(b.component) ||
    a.exportName.localeCompare(b.exportName) ||
    a.testFile.localeCompare(b.testFile)
  )
}

export function extractSnapshotHtml(snapshot: string | null): string | null {
  if (snapshot == null) return null
  const trimmed = snapshot.trim()
  if (trimmed.startsWith("<")) return trimmed

  const match = trimmed.match(/=\s*`([\s\S]*)`;\s*$/)
  if (!match) return null
  const payload = match[1] ?? ""
  if (payload.startsWith('"') && payload.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(payload)
      return typeof parsed === "string" ? parsed : null
    } catch {
      return payload.slice(1, -1)
    }
  }
  return payload
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

function formatNode(node: Node, depth: number): string[] {
  const indent = "  ".repeat(depth)
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? ""
    return text ? [`${indent}${text}`] : []
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return []

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  const attrs = [...element.attributes]
    .map((attr) => ` ${attr.name}="${escapeAttribute(attr.value)}"`)
    .join("")
  const children = [...element.childNodes]
  if (children.length === 0) return [`${indent}<${tag}${attrs}></${tag}>`]
  if (children.every((child) => child.nodeType === Node.TEXT_NODE)) {
    return [`${indent}<${tag}${attrs}>${element.textContent}</${tag}>`]
  }

  return [
    `${indent}<${tag}${attrs}>`,
    ...children.flatMap((child) => formatNode(child, depth + 1)),
    `${indent}</${tag}>`,
  ]
}

export function formatCapturedSnapshot(snapshot: string | null): string {
  const html = extractSnapshotHtml(snapshot)
  if (html == null) return ""
  const document = new DOMParser().parseFromString(html, "text/html")
  return [...document.body.childNodes].flatMap((node) => formatNode(node, 0)).join("\n")
}
