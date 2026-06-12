// Storybook ↔ Studio bridge via postMessage.
//
// Comments live exclusively in the studio's goal system. The Storybook iframe
// sends new comments to the parent frame and receives the current goal list
// back so it can render pins.

export interface StoryComment {
  id: string
  storyId: string
  selector: string
  label: string
  text: string
  author: string
  createdAt: number
  component?: string
  mode?: string
  fork?: boolean
  status?: string
}

export function postComment(comment: Omit<StoryComment, "id" | "createdAt">): void {
  try {
    window.parent?.postMessage({ type: "logos:story-comment", ...comment }, "*")
  } catch {}
}

export function onGoalsFromStudio(
  cb: (goals: StoryComment[], workspaceKind: "code" | "arch") => void,
): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data?.type === "logos:story-goals") {
      cb(e.data.goals as StoryComment[], e.data.workspaceKind === "arch" ? "arch" : "code")
    }
  }
  window.addEventListener("message", handler)
  return () => window.removeEventListener("message", handler)
}

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

export function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32)
  return text ? `${tag} "${text}"` : `<${tag}>`
}
