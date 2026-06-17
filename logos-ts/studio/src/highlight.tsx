import type { ReactNode } from "react"

const TOKEN_RE = /(".*?"|'.*?'|`.*?`|\b[A-Za-z_$][A-Za-z0-9_$]*\b|\b\d+(?:\.\d+)?\b|[{}()[\]:;,<>|&=?.])/g

const KEYWORDS = new Set([
  "declare", "function", "class", "interface", "type", "const", "let", "var",
  "return", "extends", "implements", "readonly", "private", "public", "protected",
  "async", "await", "new", "export", "import", "from", "if", "else", "switch",
  "case", "default", "for", "while", "do", "throw", "try", "catch", "finally",
  "break", "continue", "delete", "instanceof", "typeof", "keyof", "in", "of",
  "as", "is", "abstract", "override", "yield", "super", "static", "enum",
  "namespace", "void", "null", "undefined", "true", "false", "this",
])

const BUILTIN_TYPES = new Set([
  "string", "number", "boolean", "void", "null", "unknown", "any", "never",
  "Record", "Promise", "Array", "Map", "Set", "Partial", "Required", "Omit",
  "Pick", "Readonly", "Exclude", "Extract", "ReturnType", "Parameters",
])

function tokenClass(token: string, prev: string | null): string {
  if (prev === "function" && /^[A-Za-z_$]/.test(token)) return "tok-function"
  if (KEYWORDS.has(token)) return "tok-keyword"
  if (BUILTIN_TYPES.has(token)) return "tok-type"
  if (/^["'`]/.test(token)) return "tok-string"
  if (/^\d/.test(token)) return "tok-number"
  if (/^[A-Z]/.test(token)) return "tok-symbol"
  if (/^[A-Za-z_$]/.test(token)) return "tok-ident"
  return "tok-punc"
}

export function highlightTs(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let prev: string | null = null
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0]
    const idx = match.index
    if (idx > last) nodes.push(text.slice(last, idx))
    const cls = tokenClass(token, prev)
    nodes.push(<span key={`${idx}-${token}`} className={cls}>{token}</span>)
    last = idx + token.length
    prev = KEYWORDS.has(token) || BUILTIN_TYPES.has(token) || /^[A-Za-z_$]/.test(token) ? token : null
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <pre className={className ? `code ${className}` : "code"}>
      {highlightTs(code)}
    </pre>
  )
}
