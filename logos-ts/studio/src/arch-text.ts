import type { StudioIndex } from "./types"

export function indexToArchText(index: StudioIndex): string {
  const lines: string[] = []

  for (const f of index.backend) {
    lines.push(`// ${f.file}`)
    for (const it of f.items) {
      if (it.kind === "function") {
        lines.push(`declare function ${it.signature}`)
      } else {
        lines.push(`declare class ${it.name} {`)
        for (const field of it.fields) lines.push(`  ${field.name}: ${field.type}`)
        for (const m of it.methods) lines.push(`  ${m.signature}`)
        lines.push(`}`)
      }
    }
    lines.push("")
  }

  for (const c of index.components) {
    lines.push(`// component: ${c.file}`)
    lines.push(`declare function ${c.signature}`)
    if (c.propsName) {
      lines.push(`interface ${c.propsName} {`)
      for (const f of c.propsFields) lines.push(`  ${f.name}: ${f.type}`)
      lines.push(`}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export interface DiffLine {
  type: "same" | "add" | "del"
  text: string
}

export function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n")
  const bLines = b.split("\n")
  const n = aLines.length
  const m = bLines.length

  // Myers-style LCS via DP for simplicity (fine for architecture-sized texts)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && aLines[i] === bLines[j]) {
      out.push({ type: "same", text: aLines[i] })
      i++; j++
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      out.push({ type: "add", text: bLines[j] })
      j++
    } else {
      out.push({ type: "del", text: aLines[i] })
      i++
    }
  }
  return out
}
