/* eslint-disable no-restricted-syntax */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"

export interface StorySnapshotRecord {
  key: string
  value: string
  snapshotFile: string
}

export interface StorySnapshotStore {
  records: StorySnapshotRecord[]
  get(story: StoryEntry): string | null
}

export interface StorySnapshotTestResult {
  frontendDir: string
  testFile: string
  entryFile: string
  htmlFile: string
  configFile: string
  storyCount: number
}

interface StorybookDirs {
  frontendDir: string
  configDir?: string
}

const STORY_SNAPSHOT_REQUIRED_PACKAGES = ["@storybook/react", "playwright"] as const
const SNAPSHOT_SCAN_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".logos_cache",
  "dist",
  "build",
  "coverage",
  "storybook-static",
  "generated",
])

function posixPath(path: string): string {
  return path.split(sep).join("/")
}

function safeStoryFileName(storyId: string): string {
  return storyId.replace(/[^a-zA-Z0-9._-]+/g, "-") || "story"
}

function importPath(fromDir: string, toFile: string): string {
  const rel = posixPath(relative(fromDir, toFile))
  return rel.startsWith(".") ? rel : `./${rel}`
}

function isSubpath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"))
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && SNAPSHOT_SCAN_SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(full)
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

export function parseSnapshotKeys(snapContent: string, snapshotFile = ""): StorySnapshotRecord[] {
  const records: StorySnapshotRecord[] = []
  const re = /^exports\[`(.+?)`\]\s*=\s*`([\s\S]*?)`;$/gm
  let m
  while ((m = re.exec(snapContent))) {
    const key = m[1]
    const value = m[2]
    if (key != null && value != null) records.push({ key, value, snapshotFile })
  }
  return records
}

export function loadStorySnapshotStore(root: string, opts: { frontendDir?: string } = {}): StorySnapshotStore {
  const absRoot = resolve(root)
  const frontendDir = resolve(opts.frontendDir ?? root)
  const files = walkFiles(absRoot)
  const browserRecords = files
    .filter((file) => file.endsWith(".html") && file.split(sep).includes("story-snapshots"))
    .map((file) => ({
      key: `story-id:${file.slice(file.lastIndexOf(sep) + 1).replace(/\.html$/, "")}`,
      value: readFileSync(file, "utf8"),
      snapshotFile: relative(absRoot, file),
    }))
  const records = files
    .filter((file) => file.endsWith(".snap") && file.split(sep).includes("__snapshots__"))
    .flatMap((file) => parseSnapshotKeys(readFileSync(file, "utf8"), relative(absRoot, file)))
    .concat(browserRecords)
  const byKey = new Map(records.map((record) => [record.key, record.value]))

  const candidatesFor = (story: StoryEntry): string[] => {
    const rootRel = `./${posixPath(relative(absRoot, story.filePath))}`
    const frontendRel = isSubpath(frontendDir, story.filePath)
      ? `./${posixPath(relative(frontendDir, story.filePath))}`
      : null
    return [...new Set([rootRel, frontendRel].filter((value): value is string => value != null))]
      .map((storyPath) => `captured: ${storyPath} / ${story.exportName} 1`)
  }

  return {
    records,
    get(story) {
      const browserValue = byKey.get(`story-id:${safeStoryFileName(story.id)}`)
      if (browserValue != null) return browserValue
      for (const key of candidatesFor(story)) {
        const value = byKey.get(key)
        if (value != null) return value
        const suffixMatch = records.find((record) => record.key.endsWith(`> ${key}`))
        if (suffixMatch) return suffixMatch.value
      }
      return null
    },
  }
}

function previewFile(configDir: string | undefined): string | null {
  if (!configDir) return null
  for (const name of ["preview.tsx", "preview.ts", "preview.jsx", "preview.js"]) {
    const file = join(configDir, name)
    if (existsSync(file)) return file
  }
  return null
}

function tsconfigAliases(frontendDir: string): Record<string, { replacement: string; relativeToRoot: string | null }> {
  const tsconfig = join(frontendDir, "tsconfig.json")
  if (!existsSync(tsconfig)) return {}
  try {
    const parsed = JSON.parse(readFileSync(tsconfig, "utf8")) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> }
    }
    const baseUrl = resolve(frontendDir, parsed.compilerOptions?.baseUrl ?? ".")
    const paths = parsed.compilerOptions?.paths ?? {}
    const aliases: Record<string, { replacement: string; relativeToRoot: string | null }> = {}
    for (const [key, values] of Object.entries(paths)) {
      const first = values[0]
      if (!first) continue
      const find = key.replace(/\/\*$/, "")
      const replacement = resolve(baseUrl, first.replace(/\/\*$/, ""))
      aliases[find] = {
        replacement,
        relativeToRoot: isSubpath(frontendDir, replacement) ? posixPath(relative(frontendDir, replacement)) : null,
      }
    }
    return aliases
  } catch {
    return {}
  }
}

export function missingStorySnapshotDependencies(frontendDir: string): string[] {
  const root = resolve(frontendDir)
  const packageJson = join(root, "package.json")
  let declaredDeps: Record<string, unknown> = {}
  try {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
    }
    declaredDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.optionalDependencies ?? {}),
    }
  } catch {
    declaredDeps = {}
  }

  return STORY_SNAPSHOT_REQUIRED_PACKAGES.filter((pkg) => {
    if (Object.hasOwn(declaredDeps, pkg)) return false
    return !existsSync(join(root, "node_modules", ...pkg.split("/"), "package.json"))
  })
}

export function ensureStorySnapshotTest(root: string, stories: StoryEntry[], dirs: StorybookDirs): StorySnapshotTestResult {
  const frontendDir = resolve(dirs.frontendDir)
  const logosDir = join(frontendDir, ".logos")
  mkdirSync(logosDir, { recursive: true })
  const testFile = join(logosDir, "story-snapshots.test.ts")
  const entryFile = join(logosDir, "story-snapshots.browser.tsx")
  const htmlFile = join(logosDir, "story-snapshots.html")
  const configFile = join(logosDir, "vitest.story-snapshots.config.ts")
  rmSync(join(logosDir, "story-snapshots.test.tsx"), { force: true })
  rmSync(join(logosDir, "__snapshots__", "story-snapshots.test.tsx.snap"), { force: true })
  rmSync(join(logosDir, "__snapshots__", "story-snapshots.test.ts.snap"), { force: true })
  const scopedStories = stories.filter((story) => isSubpath(frontendDir, story.filePath))
  const grouped = new Map<string, StoryEntry[]>()
  for (const story of scopedStories) {
    const list = grouped.get(story.filePath) ?? []
    if (list.length === 0) grouped.set(story.filePath, list)
    list.push(story)
  }

  const preview = previewFile(dirs.configDir)
  const browserImports: string[] = [
    "import React from \"react\"",
    "import { createRoot } from \"react-dom/client\"",
    "import { composeStories, setProjectAnnotations } from \"@storybook/react\"",
  ]
  if (preview) browserImports.push(`import preview from ${JSON.stringify(importPath(logosDir, preview))}`)
  const browserModuleLines: string[] = []
  const browserStoryLines: string[] = []
  const storyMetas: { id: string; title: string; file: string }[] = []
  let index = 0
  for (const [storyFile, entries] of grouped) {
    const moduleName = `stories${index}`
    const composedName = `composed${index}`
    browserImports.push(`import * as ${moduleName} from ${JSON.stringify(importPath(logosDir, storyFile))}`)
    browserModuleLines.push(`const ${composedName} = composeStories(${moduleName} as any) as Record<string, React.ComponentType<any>>`)
    for (const story of entries) {
      const title = `${story.component} / ${story.exportName}`
      browserStoryLines.push(`  ${JSON.stringify(story.id)}: { title: ${JSON.stringify(title)}, Component: ${composedName}[${JSON.stringify(story.exportName)}] },`)
      storyMetas.push({ id: story.id, title, file: safeStoryFileName(story.id) })
    }
    index += 1
  }

  const browserSource = [
    "/* This file is generated by Logos. Do not edit by hand. */",
    ...browserImports,
    "",
    preview ? "setProjectAnnotations(preview as any)" : "",
    ...browserModuleLines,
    "",
    "const stories: Record<string, { title: string; Component?: React.ComponentType<any> }> = {",
    ...browserStoryLines,
    "}",
    "",
    "const params = new URLSearchParams(window.location.search)",
    "const storyId = params.get(\"storyId\") ?? \"\"",
    "const story = stories[storyId]",
    "const root = document.getElementById(\"logos-story-root\")",
    "if (!root) throw new Error(\"Logos story root not found\")",
    "if (!story?.Component) throw new Error(`story export not found: ${storyId}`)",
    "document.title = story.title",
    "createRoot(root).render(",
    "  React.createElement(",
    "    \"section\",",
    "    { \"data-logos-story-rendered\": storyId, \"data-logos-story-title\": story.title },",
    "    React.createElement(story.Component)",
    "  )",
    ")",
    "",
  ].filter((line) => line !== null).join("\n")
  writeFileSync(entryFile, browserSource)

  writeFileSync(htmlFile, [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    "    <title>Logos Story Snapshot</title>",
    "  </head>",
    "  <body>",
    "    <div id=\"logos-story-root\"></div>",
    "    <script type=\"module\" src=\"/ .logos/story-snapshots.browser.tsx\"></script>",
    "  </body>",
    "</html>",
    "",
  ].join("\n").replace("/ .logos/", "/.logos/"))

  const aliases = tsconfigAliases(frontendDir)
  const aliasEntries = Object.entries(aliases)
    .map(([find, alias]) => {
      const replacement = alias.relativeToRoot != null
        ? `resolve(projectRoot, ${JSON.stringify(alias.relativeToRoot)})`
        : JSON.stringify(alias.replacement)
      return `      { find: ${JSON.stringify(find)}, replacement: ${replacement} },`
    })
    .join("\n")
  const configSource = [
    "/* This file is generated by Logos. Do not edit by hand. */",
    "import { dirname, resolve } from \"node:path\"",
    "import { fileURLToPath } from \"node:url\"",
    "",
    "const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), \"..\")",
    "",
    "export default {",
    "  test: {",
    "    globals: true,",
    "    environment: \"node\",",
    "    include: [\".logos/**/*.test.ts\"],",
    "    maxConcurrency: Number(process.env.LOGOS_STORY_SNAPSHOT_CONCURRENCY ?? 4),",
    "  },",
    "  esbuild: {",
    "    jsx: \"automatic\",",
    "    jsxImportSource: \"react\",",
    "  },",
    "  resolve: {",
    "    alias: [",
    aliasEntries,
    "    ],",
    "  },",
    "}",
    "",
  ].join("\n")
  writeFileSync(configFile, configSource)

  const storyMetaSource = JSON.stringify(storyMetas, null, 2)
  const testSource = [
    "/* This file is generated by Logos. Do not edit by hand. */",
    "import { mkdirSync } from \"node:fs\"",
    "import { dirname, resolve } from \"node:path\"",
    "import { fileURLToPath } from \"node:url\"",
    "import { afterAll, beforeAll, describe, expect, it } from \"vitest\"",
    "import { chromium, type Browser } from \"playwright\"",
    "import { createServer, type ViteDevServer } from \"vite\"",
    "",
    "const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), \"..\")",
    `const stories = ${storyMetaSource} as { id: string; title: string; file: string }[]`,
    "let server: ViteDevServer",
    "let browser: Browser",
    "",
    "function snapshotDocument(): string {",
    "  const clone = document.documentElement.cloneNode(true) as HTMLElement",
    "  clone.querySelectorAll(\"script\").forEach((node) => node.remove())",
    "  clone.querySelectorAll(\"style\").forEach((node) => node.removeAttribute(\"data-vite-dev-id\"))",
    "  return `<!doctype html>${clone.outerHTML}`",
    "}",
    "",
    "describe(\"logos browser story snapshots\", () => {",
    "  beforeAll(async () => {",
    "    server = await createServer({",
    "      root: projectRoot,",
    "      configFile: false,",
    "      server: { host: \"127.0.0.1\", port: 0 },",
    "      define: { \"process.env\": \"{}\" },",
    "      esbuild: { jsx: \"automatic\", jsxImportSource: \"react\" },",
    "      resolve: { alias: [",
    aliasEntries,
    "      ] },",
    "    })",
    "    await server.listen()",
    "    browser = await chromium.launch({ headless: true })",
    "  }, 60_000)",
    "",
    "  afterAll(async () => {",
    "    await browser?.close()",
    "    await server?.close()",
    "  }, 60_000)",
    "",
    "  for (const story of stories) {",
    "    it.concurrent(story.title, async () => {",
    "      const baseUrl = server.resolvedUrls?.local[0]",
    "      if (!baseUrl) throw new Error(\"Vite story snapshot server did not expose a local URL\")",
    "      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })",
    "      const storyUrl = new URL(`.logos/story-snapshots.html?storyId=${encodeURIComponent(story.id)}`, baseUrl).toString()",
    "      try {",
    "        await page.goto(storyUrl, { waitUntil: \"domcontentloaded\" })",
    "        await page.locator(`[data-logos-story-rendered='${story.id}']`).waitFor({ timeout: 30_000 })",
    "        await page.evaluate(() => document.fonts?.ready)",
    "        const html = await page.evaluate(snapshotDocument)",
    "        const snapshotFile = resolve(projectRoot, \".logos\", \"__snapshots__\", \"story-snapshots\", `${story.file}.html`)",
    "        mkdirSync(dirname(snapshotFile), { recursive: true })",
    "        await expect(html).toMatchFileSnapshot(snapshotFile)",
    "      } finally {",
    "        await page.close()",
    "      }",
    "    }, 60_000)",
    "  }",
    "})",
    "",
  ].join("\n")
  writeFileSync(testFile, testSource)

  return { frontendDir, testFile, entryFile, htmlFile, configFile, storyCount: scopedStories.length }
}

export function ensureStorySnapshotTestForRoot(root: string, dirs: StorybookDirs): StorySnapshotTestResult {
  const project = loadProject(root)
  const stories = indexStories(project.getSourceFiles().filter((source) => !source.getFilePath().includes("/node_modules/")))
  return ensureStorySnapshotTest(root, stories, dirs)
}
