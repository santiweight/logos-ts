import { readFileSync, readdirSync } from "node:fs"
import { resolve, basename } from "node:path"
import { describe, it } from "node:test"
import assert from "node:assert/strict"

const SERVER_IMPORT_PATTERNS = [
  /from\s+["']@\/lib\/db["']/,
  /from\s+["']@prisma\/client["']/,
  /from\s+["']prisma["']/,
  /from\s+["']node:fs["']/,
  /from\s+["']node:crypto["']/,
  /from\s+["']fs["']/,
  /from\s+["']crypto["']/,
  /require\s*\(\s*["']@\/lib\/db["']\s*\)/,
  /require\s*\(\s*["']@prisma\/client["']\s*\)/,
]

function findStoriesFile(): string {
  const appDir = resolve(process.cwd(), "app")
  const files = readdirSync(appDir)
  const storiesFile = files.find((f) => /\.stories\.(t|j)sx?$/.test(f) && !f.startsWith("admin"))
  if (!storiesFile) throw new Error("No stories file found in app/")
  return resolve(appDir, storiesFile)
}

function findPresentationalFile(storiesContent: string): string | null {
  const relMatch = storiesContent.match(/from\s+["']\.\/([^"']+)["']/)
  const aliasMatch = storiesContent.match(/from\s+["']@\/app\/([^"']+)["']/)
  const importPath = relMatch?.[1] ?? aliasMatch?.[1]
  if (!importPath || importPath === "page") return null
  const appDir = resolve(process.cwd(), "app")
  const candidates = [`${importPath}.tsx`, `${importPath}.ts`, `${importPath}.jsx`, `${importPath}.js`, importPath]
  for (const c of candidates) {
    try {
      readFileSync(resolve(appDir, c), "utf8")
      return resolve(appDir, c)
    } catch {}
  }
  return null
}

describe("write-server-component-stories", () => {
  it("creates a stories file in app/", () => {
    assert.doesNotThrow(() => findStoriesFile())
  })

  it("stories file does not import directly from page.tsx", () => {
    const content = readFileSync(findStoriesFile(), "utf8")
    assert.doesNotMatch(content, /from\s+["']\.\/page["']/)
  })

  it("stories file imports from a separate presentational component file", () => {
    const content = readFileSync(findStoriesFile(), "utf8")
    const presFile = findPresentationalFile(content)
    assert.notEqual(presFile, null, "stories should import from a presentational file, not page.tsx")
  })

  it("stories file has no server-only imports", () => {
    const content = readFileSync(findStoriesFile(), "utf8")
    for (const pattern of SERVER_IMPORT_PATTERNS) {
      assert.doesNotMatch(content, pattern)
    }
  })

  it("presentational component file has no server-only imports", () => {
    const storiesContent = readFileSync(findStoriesFile(), "utf8")
    const presFile = findPresentationalFile(storiesContent)
    assert.notEqual(presFile, null)
    const content = readFileSync(presFile!, "utf8")
    for (const pattern of SERVER_IMPORT_PATTERNS) {
      assert.doesNotMatch(content, pattern)
    }
  })

  it("presentational component file does not import from page.tsx", () => {
    const storiesContent = readFileSync(findStoriesFile(), "utf8")
    const presFile = findPresentationalFile(storiesContent)
    assert.notEqual(presFile, null)
    const content = readFileSync(presFile!, "utf8")
    assert.doesNotMatch(content, /from\s+["']\.\/page["']/)
  })

  it("has typed Meta and StoryObj exports", () => {
    const content = readFileSync(findStoriesFile(), "utf8")
    assert.ok(content.includes("Meta"), "stories should use typed Meta export")
    assert.ok(content.includes("StoryObj"), "stories should use typed StoryObj export")
  })

  it("has at least 3 story variants", () => {
    const content = readFileSync(findStoriesFile(), "utf8")
    const storyExports = [...content.matchAll(/export const \w+\s*:/g)]
    assert.ok(storyExports.length >= 3, `expected >= 3 story exports, got ${storyExports.length}`)
  })

  it("page.tsx still imports and uses the presentational component", () => {
    const pageContent = readFileSync(resolve(process.cwd(), "app/page.tsx"), "utf8")
    const storiesContent = readFileSync(findStoriesFile(), "utf8")
    const presFile = findPresentationalFile(storiesContent)
    assert.notEqual(presFile, null)
    const presName = basename(presFile!).replace(/\.(t|j)sx?$/, "")
    assert.match(pageContent, new RegExp(`from\\s+["'](?:\\.\\/|@\\/app\\/)${presName}["']`))
  })
})
