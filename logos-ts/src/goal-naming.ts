export interface GoalNameInput {
  text: string
  target?: string
  label?: string
  mode?: "code" | "arch"
  component?: string | null
  storyId?: string | null
  selector?: string | null
  htmlContext?: string | null
}

const MAX_GOAL_NAME_LENGTH = 48
const FALLBACK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "for",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "want",
  "with",
  "would",
])

export function buildGoalNamePrompt(input: GoalNameInput): string {
  const context = [
    input.mode ? `Mode: ${input.mode}` : null,
    input.component ? `Component: ${input.component}` : null,
    input.storyId ? `Story: ${input.storyId}` : null,
    input.target ? `Target: ${input.target}` : null,
    input.label ? `Current target label: ${input.label}` : null,
    input.selector ? `CSS selector: ${input.selector}` : null,
    input.htmlContext ? `Selected HTML context:\n${input.htmlContext}` : null,
  ].filter(Boolean).join("\n")

  return [
    "Name this coding-agent chat.",
    "",
    "Return only one concise title.",
    "Rules:",
    "- 2 to 5 words.",
    `- ${MAX_GOAL_NAME_LENGTH} characters maximum.`,
    "- Summarize the user's requested outcome, not the method.",
    "- Focus on WHAT changes, not HOW — name the result, not the task.",
    "- If the comment is a long instruction paragraph, distill it to the core intent.",
    "- Prefer a concrete UI/domain noun from the selected HTML context when the request says this, these, it, or that.",
    "- Do not use CSS selectors, file names, or symbol names unless they are the clearest user-facing noun.",
    "- Do not echo generic verbs like 'Write', 'Implement', 'Create', 'Add' from the instructions — use domain-specific verbs or nouns instead.",
    "- No quotes, markdown, prefixes, trailing period, or explanation.",
    "",
    "Examples:",
    "",
    "Current target label: span \"postings\"",
    "User comment: make this bold",
    "Title: Make Postings Bold",
    "",
    "Component: FilterSidebar",
    "User comment: The filter sidebar is too noisy; collapse advanced filters by default.",
    "Title: Collapse Advanced Filters",
    "",
    "Component: UserCard",
    "User comment: Add loading and error states to this component, handle the case where the avatar URL is missing",
    "Title: UserCard Loading Error States",
    "",
    "Target: backend:getPostById",
    "User comment: This endpoint returns 500 when the post ID doesn't exist in the database, it should return 404 instead",
    "Title: Fix Missing Post 404",
    "",
    "---",
    "Now name the following chat:",
    "",
    context,
    "",
    `User comment: ${input.text.trim()}`,
  ].filter((part) => part !== null).join("\n")
}

export function cleanGoalName(raw: string): string | null {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return null

  const cleaned = firstLine
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/^(title|name)\s*:\s*/i, "")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  return truncateGoalName(cleaned)
}

export function fallbackGoalName(input: GoalNameInput): string {
  const subject = vagueReference(input.text) ? subjectFromContext(input) : ""
  const text = subject ? input.text.replace(/\b(this|these|that|those|it)\b/i, subject) : input.text
  const words = text
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)

  const selected = words
    .filter((word) => !FALLBACK_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 5)

  const source = selected.length >= 2 ? selected : words.slice(0, 5)
  const title = source
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim()

  return truncateGoalName(title || input.label || input.target || "Untitled Goal")
}

function vagueReference(text: string): boolean {
  return /\b(this|these|that|those|it)\b/i.test(text)
}

function subjectFromContext(input: GoalNameInput): string {
  const context = [input.label, input.htmlContext, input.component]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
  const quoted = context.match(/"([^"]{2,48})"/)?.[1]
  if (quoted) return quoted
  const words = context
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !FALLBACK_STOP_WORDS.has(word.toLowerCase()))
  return words[0] ?? ""
}

function truncateGoalName(name: string): string {
  if (name.length <= MAX_GOAL_NAME_LENGTH) return name
  const clipped = name.slice(0, MAX_GOAL_NAME_LENGTH).replace(/\s+\S*$/, "").trim()
  return clipped || name.slice(0, MAX_GOAL_NAME_LENGTH).trim()
}
