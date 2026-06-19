import type { StudioIndex, Workspace } from "./types"

const componentsOf = (file: StudioIndex["files"][number]) =>
  file.components?.length ? file.components : file.component ? [file.component] : []

export type SnapshotChangeStatus = "added" | "changed" | "removed"

export interface SnapshotChange {
  id: string
  component: string
  exportName: string
  storyId: string | null
  status: SnapshotChangeStatus
  beforeSnapshot: string | null
  afterSnapshot: string | null
}

interface IndexedSnapshot {
  component: string
  exportName: string
  storyId: string | null
  snapshot: string | null
}

export function selectReviewBaseIndex(projectIndex: StudioIndex, parentWorkspaceIndex: StudioIndex | null): StudioIndex {
  return parentWorkspaceIndex ?? projectIndex
}

export function selectWorkspaceReviewBaseIndex(projectIndex: StudioIndex, workspace: Workspace | null): StudioIndex {
  if (!workspace) return projectIndex
  return workspace.instances[workspace.baseInstanceId]?.index ?? projectIndex
}

function snapshotMap(index: StudioIndex): Map<string, IndexedSnapshot> {
  const snaps = new Map<string, IndexedSnapshot>()
  for (const file of index.files) {
    for (const component of componentsOf(file)) {
      for (const story of component.stories) {
        const id = `${component.name}::${story.exportName}`
        snaps.set(id, {
          component: component.name,
          exportName: story.exportName,
          storyId: story.id,
          snapshot: story.snapshot,
        })
      }
    }
  }
  return snaps
}

export function snapshotChanges(base: StudioIndex, workspace: StudioIndex): SnapshotChange[] {
  const before = snapshotMap(base)
  const after = snapshotMap(workspace)
  const ids = new Set([...before.keys(), ...after.keys()])
  const changes: SnapshotChange[] = []

  for (const id of ids) {
    const previous = before.get(id)
    const current = after.get(id)
    if (previous && current && previous.snapshot === current.snapshot) continue

    const snap = current ?? previous
    if (!snap) continue
    changes.push({
      id,
      component: snap.component,
      exportName: snap.exportName,
      storyId: current?.storyId ?? previous?.storyId ?? null,
      status: previous ? current ? "changed" : "removed" : "added",
      beforeSnapshot: previous?.snapshot ?? null,
      afterSnapshot: current?.snapshot ?? null,
    })
  }

  return changes.sort((a, b) =>
    a.component.localeCompare(b.component) ||
    a.exportName.localeCompare(b.exportName)
  )
}

export function extractSnapshotHtml(snapshot: string | null): string | null {
  if (snapshot == null) return null
  const trimmed = snapshot.trim()
  if (trimmed.startsWith("<")) return trimmed

  const match = trimmed.match(/=\s*`([\s\S]*)`;\s*$/)
  const payload = match?.[1] ?? trimmed
  let html: string | null
  if (payload.startsWith('"') && payload.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(payload)
      html = typeof parsed === "string" ? parsed : null
    } catch {
      html = payload.slice(1, -1)
    }
  } else {
    html = match ? payload : null
  }
  return html?.trim().startsWith("<") ? html : null
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

export function formatSnapshot(snapshot: string | null): string {
  const html = extractSnapshotHtml(snapshot)
  if (html == null) return ""
  const document = new DOMParser().parseFromString(html, "text/html")
  return [...document.body.childNodes].flatMap((node) => formatNode(node, 0)).join("\n")
}
