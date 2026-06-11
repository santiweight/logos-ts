// Persistence for element-pinned story comments.
//
// Comments are written to disk via the Storybook dev-server middleware (see
// comments-server.ts) so they land in <project>/.logos/ where Logos backend
// agents read them — the same file-on-disk channel every other agent
// instruction uses. localStorage is a fallback for when the endpoint isn't
// reachable (e.g. a static `build-storybook` bundle), so the UI still works.
//
// A comment anchors to a single element via a :scope-relative CSS path computed
// against the story root, with a human-readable `label` kept for display and as
// a fallback when the anchor element can no longer be resolved.

export interface StoryComment {
  id: string
  storyId: string // Storybook story id, e.g. "directory-jobrow--default"
  selector: string // :scope-relative path from the story root
  label: string // human-readable anchor, e.g. 'a "Acme"'
  body: string
  author: string
  createdAt: number
  component?: string // component title, e.g. "JobRow" (for agent routing)
  // Set by the server: the one agent that owns this comment (1:1) + its status.
  agentId?: string
  agentStatus?: string
}

const ENDPOINT = "/api/story-comments"
const KEY = "hn-jobs:story-comments:v1" // localStorage fallback

export async function listComments(storyId: string): Promise<StoryComment[]> {
  const all = await readAll()
  return all.filter((c) => c.storyId === storyId).sort((a, b) => a.createdAt - b.createdAt)
}

export async function addComment(
  input: Omit<StoryComment, "id" | "createdAt">,
): Promise<StoryComment> {
  const comment: StoryComment = { ...input, id: newId(), createdAt: Date.now() }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    })
    if (!res.ok) throw new Error(`POST ${res.status}`)
  } catch {
    localWriteAll([...localReadAll(), comment])
  }
  return comment
}

export async function removeComment(id: string): Promise<void> {
  try {
    const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`DELETE ${res.status}`)
  } catch {
    localWriteAll(localReadAll().filter((c) => c.id !== id))
  }
}

async function readAll(): Promise<StoryComment[]> {
  try {
    const res = await fetch(ENDPOINT)
    if (!res.ok) throw new Error(`GET ${res.status}`)
    const data = (await res.json()) as { comments: StoryComment[] }
    return data.comments
  } catch {
    return localReadAll()
  }
}

function localReadAll(): StoryComment[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as StoryComment[]) : []
  } catch {
    return []
  }
}

function localWriteAll(comments: StoryComment[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(comments))
  } catch {
    /* ignore */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

// --- DOM anchoring -----------------------------------------------------------

// A :scope-relative selector (e.g. ":scope > tbody > tr:nth-of-type(2) > td")
// that resolves the element from the story root. nth-of-type keeps it stable
// across re-renders without relying on data-* attributes the app doesn't have.
export function cssPath(el: Element, root: Element): string {
  if (el === root) return ":scope"
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== root) {
    const parent: Element | null = node.parentElement
    if (!parent) break
    let part = node.tagName.toLowerCase()
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName)
    if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`
    parts.unshift(part)
    node = parent === root ? null : parent
    if (parent === root) break
  }
  return parts.length ? ":scope > " + parts.join(" > ") : ":scope"
}

export function resolve(root: Element, selector: string): Element | null {
  try {
    return selector === ":scope" ? root : root.querySelector(selector)
  } catch {
    return null
  }
}

// Short human label for an element: tag + trimmed text content.
export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32)
  return text ? `${tag} "${text}"` : `<${tag}>`
}
