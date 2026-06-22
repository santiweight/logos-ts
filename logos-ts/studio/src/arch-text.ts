/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { StudioIndex } from "./types"

const componentsOf = (file: StudioIndex["files"][number]) =>
  file.components?.length ? file.components : file.component ? [file.component] : []

export function indexToArchText(index: StudioIndex): string {
  const lines: string[] = []

  for (const f of index.files) {
    const components = componentsOf(f)
    const hasItems = f.items.length > 0 || components.length > 0
    if (!hasItems) continue

    lines.push(`// ${f.file}`)

    for (const it of f.items) {
      if ("tests" in it) {
        for (const test of it.tests) lines.push(`test(${JSON.stringify(test.name)})`)
      }
      if (it.kind === "function") {
        lines.push(`declare function ${it.signature}`)
      } else if (it.kind === "type") {
        lines.push(`declare ${it.signature}`)
      } else {
        lines.push(`declare class ${it.name} {`)
        for (const field of it.fields) lines.push(`  ${field.name}: ${field.type}`)
        for (const m of it.methods) {
          for (const test of m.tests) lines.push(`  test(${JSON.stringify(test.name)})`)
          lines.push(`  ${m.signature}`)
        }
        lines.push(`}`)
      }
    }

    for (const component of components) {
      lines.push(`declare function ${component.signature}`)
      if (component.propsName) {
        lines.push(`interface ${component.propsName} {`)
        for (const p of component.propsFields) lines.push(`  ${p.name}: ${p.type}`)
        lines.push(`}`)
      }
      for (const story of component.stories) {
        if (story.storyFile == null) continue
        lines.push(`story ${story.exportName} in ${story.storyFile}`)
      }
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

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const nextRow = dp[i + 1]
      const currRow = dp[i]
      if (nextRow != null && currRow != null) {
        currRow[j] = aLines[i] === bLines[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, currRow[j + 1] ?? 0)
      }
    }

  const out: DiffLine[] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && aLines[i] === bLines[j]) {
      out.push({ type: "same", text: aLines[i] ?? "" })
      i++; j++
    } else if (j < m && (i >= n || (dp[i]?.[j + 1] ?? 0) >= (dp[i + 1]?.[j] ?? 0))) {
      out.push({ type: "add", text: bLines[j] ?? "" })
      j++
    } else {
      out.push({ type: "del", text: aLines[i] ?? "" })
      i++
    }
  }
  return out
}
