import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry !== "node_modules" && entry !== ".next") out.push(...walk(path))
      continue
    }
    if (
      /\.(ts|tsx)$/.test(entry) &&
      !/(\.test|\.spec|\.stories)\.(ts|tsx)$/.test(entry)
    ) {
      out.push(path)
    }
  }
  return out
}

function collect(root: string): string[] {
  if (!existsSync(root)) return []
  if (statSync(root).isFile()) return [root]
  return walk(root)
}

export function sourceText(roots = ["app", "components", "lib"]): string {
  return roots.flatMap(collect).map((path) => readFileSync(path, "utf8")).join("\n")
}

export function assertMatch(text: string, pattern: RegExp, message: string): void {
  assert.match(text, pattern, message)
}

export function assertNoMatch(text: string, pattern: RegExp, message: string): void {
  assert.doesNotMatch(text, pattern, message)
}
