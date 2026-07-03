/* eslint-disable no-restricted-syntax */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorySnapshotRecord {
  key: string
  value: string
  snapshotFile: string
}

export interface StorySnapshotStore {
  records: StorySnapshotRecord[]
  get(story: StoryEntry): string | null
  screenshotHash(story: StoryEntry): string | null
}

export interface StoryCaptureResult {
  frontendDir: string
  captureScript: string
  entryFile: string
  htmlFile: string
  snapshotTestShim: string
  storyCount: number
}

export interface StorySnapshotComparison {
  storyId: string
  title: string
  baseline: string | null
  live: string | null
  match: boolean
}

interface StorybookDirs {
  frontendDir: string
  configDir?: string
}

/** @deprecated Use StoryCaptureResult instead. */
export interface StorySnapshotTestResult {
  frontendDir: string
  testFile: string
  entryFile: string
  htmlFile: string
  configFile: string
  storyCount: number
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

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

function snapshotDir(root: string): string {
  return join(resolve(root), ".logos", "__snapshots__", "story-snapshots")
}

function snapshotFilePath(root: string, storyId: string): string {
  return join(snapshotDir(root), `${safeStoryFileName(storyId)}.html`)
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

function buildAliasEntries(aliases: Record<string, { replacement: string; relativeToRoot: string | null }>): string {
  return Object.entries(aliases)
    .map(([find, alias]) => {
      const replacement = alias.relativeToRoot != null
        ? `resolve(projectRoot, ${JSON.stringify(alias.relativeToRoot)})`
        : JSON.stringify(alias.replacement)
      return `      { find: ${JSON.stringify(find)}, replacement: ${replacement} },`
    })
    .join("\n")
}

interface BrowserHarnessFiles {
  logosDir: string
  entryFile: string
  htmlFile: string
  storyMetas: { id: string; title: string; file: string }[]
}

function writeBrowserHarness(
  frontendDir: string,
  scopedStories: StoryEntry[],
  configDir: string | undefined,
): BrowserHarnessFiles {
  const logosDir = join(frontendDir, ".logos")
  mkdirSync(logosDir, { recursive: true })
  const entryFile = join(logosDir, "story-snapshots.browser.tsx")
  const htmlFile = join(logosDir, "story-snapshots.html")

  const grouped = new Map<string, StoryEntry[]>()
  for (const story of scopedStories) {
    const list = grouped.get(story.filePath) ?? []
    if (list.length === 0) grouped.set(story.filePath, list)
    list.push(story)
  }

  const preview = previewFile(configDir)
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

  writeFileSync(entryFile, [
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
  ].filter((line) => line !== null).join("\n"))

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

  return { logosDir, entryFile, htmlFile, storyMetas }
}

// ---------------------------------------------------------------------------
// 1. Capture — generate harness files + standalone capture script
// ---------------------------------------------------------------------------

export function ensureStoryCaptureHarness(root: string, stories: StoryEntry[], dirs: StorybookDirs): StoryCaptureResult {
  const frontendDir = resolve(dirs.frontendDir)
  const scopedStories = stories.filter((story) => isSubpath(frontendDir, story.filePath))
  const { logosDir, entryFile, htmlFile, storyMetas } = writeBrowserHarness(frontendDir, scopedStories, dirs.configDir)

  // Clean up legacy generated files
  rmSync(join(logosDir, "story-snapshots.test.tsx"), { force: true })
  rmSync(join(logosDir, "story-snapshots.test.ts"), { force: true })
  rmSync(join(logosDir, "vitest.story-snapshots.config.ts"), { force: true })
  rmSync(join(logosDir, "__snapshots__", "story-snapshots.test.tsx.snap"), { force: true })
  rmSync(join(logosDir, "__snapshots__", "story-snapshots.test.ts.snap"), { force: true })

  const aliases = tsconfigAliases(frontendDir)
  const aliasEntries = buildAliasEntries(aliases)
  const storyMetaSource = JSON.stringify(storyMetas, null, 2)
  const captureScript = join(logosDir, "story-capture.ts")

  writeFileSync(captureScript, [
    "/* This file is generated by Logos. Do not edit by hand. */",
    "import { mkdirSync, writeFileSync } from \"node:fs\"",
    "import { dirname, resolve } from \"node:path\"",
    "import { fileURLToPath } from \"node:url\"",
    "import { chromium } from \"playwright\"",
    "import { createServer, type ViteDevServer } from \"vite\"",
    "",
    "const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), \"..\")",
    `const stories = ${storyMetaSource} as { id: string; title: string; file: string }[]`,
    "const CONCURRENCY = Number(process.env.LOGOS_STORY_SNAPSHOT_CONCURRENCY ?? 4)",
    "const STORYBOOK_URL = process.env.LOGOS_STORYBOOK_URL ?? \"\"",
    "",
    "function snapshotDocument(): string {",
    "  const clone = document.documentElement.cloneNode(true) as HTMLElement",
    "  clone.querySelectorAll(\"script\").forEach((node) => node.remove())",
    "  clone.querySelectorAll(\"style\").forEach((node) => node.removeAttribute(\"data-vite-dev-id\"))",
    "  return `<!doctype html>${clone.outerHTML}`",
    "}",
    "",
    "async function main() {",
    "  let server: ViteDevServer | null = null",
    "  let baseUrl: string",
    "",
    "  if (STORYBOOK_URL) {",
    "    baseUrl = STORYBOOK_URL.replace(/\\/$/, \"\")",
    "  } else {",
    "    server = await createServer({",
    "      root: projectRoot,",
    "      cacheDir: resolve(projectRoot, \".logos\", \".vite-story-capture\"),",
    "      configFile: false,",
    "      server: { host: \"127.0.0.1\", port: 0 },",
    "      define: { \"process.env\": \"{}\" },",
    "      esbuild: { jsx: \"automatic\", jsxImportSource: \"react\" },",
    "      resolve: { alias: [",
    aliasEntries,
    "      ] },",
    "    })",
    "    await server.listen()",
    "    const local = server.resolvedUrls?.local[0]",
    "    if (!local) throw new Error(\"Vite dev server did not expose a local URL\")",
    "    baseUrl = local",
    "  }",
    "",
    "  const browser = await chromium.launch({ headless: true })",
    "  const results: { storyId: string; file: string; ok: boolean; error?: string }[] = []",
    "",
    "  for (let i = 0; i < stories.length; i += CONCURRENCY) {",
    "    const batch = stories.slice(i, i + CONCURRENCY)",
    "    await Promise.all(batch.map(async (story) => {",
    "      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })",
    "      const storyUrl = STORYBOOK_URL",
    "        ? `${baseUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`",
    "        : new URL(`.logos/story-snapshots.html?storyId=${encodeURIComponent(story.id)}`, baseUrl).toString()",
    "      try {",
    "        await page.goto(storyUrl, { waitUntil: STORYBOOK_URL ? \"networkidle\" : \"domcontentloaded\" })",
    "        if (STORYBOOK_URL) {",
    "          await page.locator(\"#storybook-root > *\").waitFor({ timeout: 30_000 })",
    "        } else {",
    "          await page.locator(`[data-logos-story-rendered='${story.id}']`).waitFor({ timeout: 30_000 })",
    "        }",
    "        await page.evaluate(() => document.fonts?.ready)",
    "        const html = await page.evaluate(snapshotDocument)",
    "        const snapshotFile = resolve(projectRoot, \".logos\", \"__snapshots__\", \"story-snapshots\", `${story.file}.html`)",
    "        const screenshotFile = resolve(projectRoot, \".logos\", \"__snapshots__\", \"story-snapshots\", `${story.file}.png`)",
    "        mkdirSync(dirname(snapshotFile), { recursive: true })",
    "        writeFileSync(snapshotFile, html)",
    "        await page.screenshot({ path: screenshotFile, fullPage: true })",
    "        results.push({ storyId: story.id, file: story.file, ok: true })",
    "      } catch (e) {",
    "        results.push({ storyId: story.id, file: story.file, ok: false, error: e instanceof Error ? e.message : String(e) })",
    "      } finally {",
    "        await page.close()",
    "      }",
    "    }))",
    "  }",
    "",
    "  await browser.close()",
    "  if (server) await server.close()",
    "",
    "  const failed = results.filter((r) => !r.ok)",
    "  process.stdout.write(JSON.stringify({ ok: failed.length === 0, results }))",
    "  process.exit(failed.length > 0 ? 1 : 0)",
    "}",
    "",
    "main().catch((e) => {",
    "  process.stderr.write(e instanceof Error ? e.message : String(e))",
    "  process.exit(1)",
    "})",
    "",
  ].join("\n"))

  // Vitest shim: reports snapshot comparisons as test cases.
  // Set LOGOS_SNAPSHOT_BASELINE to a directory to compare against; without it
  // the shim just asserts each snapshot file was captured.
  const snapshotTestShim = join(logosDir, "story-snapshots.test.ts")
  writeFileSync(snapshotTestShim, [
    "/* This file is generated by Logos. Do not edit by hand. */",
    "import { existsSync, readFileSync } from \"node:fs\"",
    "import { resolve } from \"node:path\"",
    "import { fileURLToPath } from \"node:url\"",
    "import { describe, expect, it } from \"vitest\"",
    "",
    "const projectRoot = resolve(fileURLToPath(import.meta.url), \"../..\") ",
    `const stories = ${storyMetaSource} as { id: string; title: string; file: string }[]`,
    "const snapshotDir = resolve(projectRoot, \".logos\", \"__snapshots__\", \"story-snapshots\")",
    "const baselineRoot = process.env.LOGOS_SNAPSHOT_BASELINE ?? \"\"",
    "const baselineDir = baselineRoot ? resolve(baselineRoot, \".logos\", \"__snapshots__\", \"story-snapshots\") : \"\"",
    "",
    "describe(\"logos story snapshots\", () => {",
    "  for (const story of stories) {",
    "    it(story.title, () => {",
    "      const liveFile = resolve(snapshotDir, `${story.file}.html`)",
    "      expect(existsSync(liveFile), `snapshot missing: ${story.file}`).toBe(true)",
    "      if (baselineDir) {",
    "        const baseFile = resolve(baselineDir, `${story.file}.html`)",
    "        if (existsSync(baseFile)) {",
    "          const baseline = readFileSync(baseFile, \"utf8\")",
    "          const live = readFileSync(liveFile, \"utf8\")",
    "          expect(live).toBe(baseline)",
    "        }",
    "      }",
    "    })",
    "  }",
    "})",
    "",
  ].join("\n"))

  return { frontendDir, captureScript, entryFile, htmlFile, snapshotTestShim, storyCount: scopedStories.length }
}

export function ensureStoryCaptureHarnessForRoot(root: string, dirs: StorybookDirs): StoryCaptureResult {
  const project = loadProject(root)
  const stories = indexStories(project.getSourceFiles().filter((source) => !source.getFilePath().includes("/node_modules/")))
  return ensureStoryCaptureHarness(root, stories, dirs)
}

// ---------------------------------------------------------------------------
// 2. Compare — structured baseline vs live diff
// ---------------------------------------------------------------------------

export function compareStorySnapshots(
  baselineRoot: string,
  liveRoot: string,
  stories: StoryEntry[],
): StorySnapshotComparison[] {
  return stories.map((story) => {
    const baselinePath = snapshotFilePath(baselineRoot, story.id)
    const livePath = snapshotFilePath(liveRoot, story.id)
    const baseline = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : null
    const live = existsSync(livePath) ? readFileSync(livePath, "utf8") : null
    return {
      storyId: story.id,
      title: `${story.component} / ${story.exportName}`,
      baseline,
      live,
      match: baseline === live,
    }
  })
}

// ---------------------------------------------------------------------------
// 3. View — read a single snapshot
// ---------------------------------------------------------------------------

export function getStorySnapshot(root: string, storyId: string): string | null {
  const file = snapshotFilePath(root, storyId)
  return existsSync(file) ? readFileSync(file, "utf8") : null
}

// ---------------------------------------------------------------------------
// Legacy snapshot store (used by build-index.ts)
// ---------------------------------------------------------------------------

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

  const screenshotHashes = new Map<string, string>()
  for (const file of files) {
    if (!file.endsWith(".png") || !file.split(sep).includes("story-snapshots")) continue
    const storyKey = file.slice(file.lastIndexOf(sep) + 1).replace(/\.png$/, "")
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex")
    screenshotHashes.set(`story-id:${storyKey}`, hash)
  }

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
    screenshotHash(story) {
      return screenshotHashes.get(`story-id:${safeStoryFileName(story.id)}`) ?? null
    },
  }
}

// ---------------------------------------------------------------------------
// Dependency check
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Deprecated — kept for backward compat during migration
// ---------------------------------------------------------------------------

/** @deprecated Use ensureStoryCaptureHarness instead. */
export function ensureStorySnapshotTest(root: string, stories: StoryEntry[], dirs: StorybookDirs): StorySnapshotTestResult {
  const result = ensureStoryCaptureHarness(root, stories, dirs)
  return {
    frontendDir: result.frontendDir,
    testFile: result.captureScript,
    entryFile: result.entryFile,
    htmlFile: result.htmlFile,
    configFile: result.captureScript,
    storyCount: result.storyCount,
  }
}

/** @deprecated Use ensureStoryCaptureHarnessForRoot instead. */
export function ensureStorySnapshotTestForRoot(root: string, dirs: StorybookDirs): StorySnapshotTestResult {
  const result = ensureStoryCaptureHarnessForRoot(root, dirs)
  return {
    frontendDir: result.frontendDir,
    testFile: result.captureScript,
    entryFile: result.entryFile,
    htmlFile: result.htmlFile,
    configFile: result.captureScript,
    storyCount: result.storyCount,
  }
}
