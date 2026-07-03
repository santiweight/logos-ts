import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  compareStorySnapshots,
  ensureStoryCaptureHarness,
  getStorySnapshot,
  loadStorySnapshotStore,
  missingStorySnapshotDependencies,
  parseSnapshotKeys,
  type StoryCaptureResult,
} from "./story-snapshots.js"
import type { StoryEntry } from "./stories.js"

const tempDirs: string[] = []
const LOGOS_TS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURE_NODE_MODULES = existsSync(resolve(LOGOS_TS_ROOT, "studio", "node_modules"))
  ? resolve(LOGOS_TS_ROOT, "studio", "node_modules")
  : resolve(LOGOS_TS_ROOT, "demos", "hn-jobs", "node_modules")
const TSX = resolve(LOGOS_TS_ROOT, "node_modules", ".bin", "tsx")

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-story-snapshots-"))
  tempDirs.push(root)
  mkdirSync(join(root, "app", "admin"), { recursive: true })
  writeFileSync(join(root, "package.json"), "{}")
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      paths: {
        "@/*": ["./*"],
      },
    },
  }))
  return root
}

function writeHarness(root: string): StoryCaptureResult {
  const storyFile = join(root, "app", "admin", "page.stories.tsx")
  writeFileSync(storyFile, `
    export default { title: "Admin/Page" }
    export const Default = {}
  `)
  const story: StoryEntry = {
    id: "admin-page--default",
    component: "AdminPage",
    exportName: "Default",
    storiesModule: "page.stories",
    filePath: storyFile,
    code: "export const Default = {}",
  }
  return ensureStoryCaptureHarness(root, [story], { frontendDir: root })
}

function linkProjectDependency(root: string, name: string): void {
  const target = join(root, "node_modules", name)
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(join(FIXTURE_NODE_MODULES, name), target, "dir")
}

function runCaptureScript(generated: StoryCaptureResult): void {
  execFileSync(TSX, [generated.captureScript], {
    cwd: generated.frontendDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: "test" },
  })
}

// ---------------------------------------------------------------------------
// Capture harness generation
// ---------------------------------------------------------------------------

describe("capture harness", () => {
  it("generates a standalone capture script with Vite + Playwright", () => {
    const root = createProject()
    const generated = writeHarness(root)
    const captureSource = readFileSync(generated.captureScript, "utf8")
    const entrySource = readFileSync(generated.entryFile, "utf8")

    expect(captureSource).toContain("from \"playwright\"")
    expect(captureSource).toContain("from \"vite\"")
    expect(captureSource).toContain("chromium.launch")
    expect(captureSource).toContain("createServer")
    expect(captureSource).toContain("cacheDir: resolve(projectRoot, \".logos\", \".vite-story-capture\")")
    expect(captureSource).toContain("Promise.all")
    expect(captureSource).toContain("CONCURRENCY")
    expect(captureSource).toContain("writeFileSync(snapshotFile, html)")
    expect(captureSource).toContain("waitUntil: \"domcontentloaded\"")
    expect(captureSource).not.toContain("vitest")
    expect(captureSource).not.toContain(root)
    expect(entrySource).toContain("createRoot")
  })

  it("generates a Vitest shim that reports snapshots as test cases", () => {
    const root = createProject()
    const generated = writeHarness(root)
    const shimSource = readFileSync(generated.snapshotTestShim, "utf8")

    expect(shimSource).toContain("from \"vitest\"")
    expect(shimSource).toContain("describe(\"logos story snapshots\"")
    expect(shimSource).toContain("LOGOS_SNAPSHOT_BASELINE")
    expect(shimSource).toContain("expect(existsSync(liveFile)")
    expect(shimSource).not.toContain("playwright")
    expect(shimSource).not.toContain("createServer")
  })

  it("cleans up legacy Vitest config files", () => {
    const root = createProject()
    const logosDir = join(root, ".logos")
    mkdirSync(logosDir, { recursive: true })
    writeFileSync(join(logosDir, "vitest.story-snapshots.config.ts"), "old config")
    writeFileSync(join(logosDir, "story-snapshots.test.tsx"), "old tsx test")

    writeHarness(root)

    expect(existsSync(join(logosDir, "vitest.story-snapshots.config.ts"))).toBe(false)
    expect(existsSync(join(logosDir, "story-snapshots.test.tsx"))).toBe(false)
    expect(existsSync(join(logosDir, "story-capture.ts"))).toBe(true)
    expect(existsSync(join(logosDir, "story-snapshots.test.ts"))).toBe(true)
  })

  it("captures browser snapshots with Storybook preview decorator", () => {
    const root = createProject()
    symlinkSync(FIXTURE_NODE_MODULES, join(root, "node_modules"), "dir")
    mkdirSync(join(root, ".storybook", ".logos"), { recursive: true })
    writeFileSync(join(root, ".storybook", "preview.ts"), [
      "import { withLogosComments } from './.logos/CommentLayer'",
      "export default { decorators: [withLogosComments] }",
      "",
    ].join("\n"))
    writeFileSync(join(root, ".storybook", ".logos", "CommentLayer.tsx"), [
      "import React from 'react'",
      "export const withLogosComments = (Story: any) => React.createElement(Story)",
      "",
    ].join("\n"))
    const storyFile = join(root, "app", "admin", "page.stories.tsx")
    writeFileSync(storyFile, [
      "import React from 'react'",
      "function AdminPage() { return <main className=\"wrapped-preview\">Wrapped preview works</main> }",
      "export default { title: 'Admin/Page', component: AdminPage }",
      "export const Default = {}",
      "",
    ].join("\n"))
    const generated = ensureStoryCaptureHarness(root, [{
      id: "admin-page--default",
      component: "AdminPage",
      exportName: "Default",
      storiesModule: "page.stories",
      filePath: storyFile,
      code: readFileSync(storyFile, "utf8"),
    }], { frontendDir: root, configDir: join(root, ".storybook") })

    runCaptureScript(generated)

    const snapshotFile = join(root, ".logos", "__snapshots__", "story-snapshots", "admin-page--default.html")
    expect(existsSync(snapshotFile)).toBe(true)
    const snapshot = readFileSync(snapshotFile, "utf8")
    expect(snapshot).toContain("Wrapped preview works")
    expect(snapshot).toContain("data-logos-story-rendered")
    expect(snapshot).not.toContain("<script")
  }, 90_000)

  it("captures 6+ stories in parallel without races", () => {
    const root = createProject()
    symlinkSync(FIXTURE_NODE_MODULES, join(root, "node_modules"), "dir")

    const storyFile1 = join(root, "app", "page.stories.tsx")
    writeFileSync(storyFile1, [
      "import React from 'react'",
      "function Page() { return <main>Page view</main> }",
      "export default { title: 'App/Page', component: Page }",
      "export const Default = {}",
      "export const Variant1 = {}",
      "export const Variant2 = {}",
      "export const Variant3 = {}",
      "",
    ].join("\n"))

    const storyFile2 = join(root, "app", "admin", "page.stories.tsx")
    writeFileSync(storyFile2, [
      "import React from 'react'",
      "function AdminPage() { return <main>Admin view</main> }",
      "export default { title: 'Admin/Page', component: AdminPage }",
      "export const Default = {}",
      "export const EmptyIndex = {}",
      "",
    ].join("\n"))

    const stories: StoryEntry[] = [
      { id: "app-page--default", component: "Page", exportName: "Default", storiesModule: "page.stories", filePath: storyFile1, code: "" },
      { id: "app-page--variant-1", component: "Page", exportName: "Variant1", storiesModule: "page.stories", filePath: storyFile1, code: "" },
      { id: "app-page--variant-2", component: "Page", exportName: "Variant2", storiesModule: "page.stories", filePath: storyFile1, code: "" },
      { id: "app-page--variant-3", component: "Page", exportName: "Variant3", storiesModule: "page.stories", filePath: storyFile1, code: "" },
      { id: "admin-page--default", component: "AdminPage", exportName: "Default", storiesModule: "page.stories", filePath: storyFile2, code: "" },
      { id: "admin-page--empty-index", component: "AdminPage", exportName: "EmptyIndex", storiesModule: "page.stories", filePath: storyFile2, code: "" },
    ]

    const generated = ensureStoryCaptureHarness(root, stories, { frontendDir: root })
    runCaptureScript(generated)

    for (const story of stories) {
      const snapshotFile = join(root, ".logos", "__snapshots__", "story-snapshots", `${story.id}.html`)
      expect(existsSync(snapshotFile)).toBe(true)
      expect(readFileSync(snapshotFile, "utf8")).toContain("data-logos-story-rendered")
    }
  }, 90_000)

  it("captures snapshots when project depends on Playwright", () => {
    const root = createProject()
    mkdirSync(join(root, "node_modules"), { recursive: true })
    linkProjectDependency(root, "react")
    linkProjectDependency(root, "react-dom")
    linkProjectDependency(root, "vite")
    linkProjectDependency(root, "@storybook/react")
    linkProjectDependency(root, "playwright")

    const storyFile = join(root, "app", "admin", "page.stories.tsx")
    writeFileSync(storyFile, [
      "import React from 'react'",
      "function AdminPage() { return <main>Project owns Playwright</main> }",
      "export default { title: 'Admin/Page', component: AdminPage }",
      "export const Default = {}",
      "",
    ].join("\n"))
    const generated = ensureStoryCaptureHarness(root, [{
      id: "admin-page--default",
      component: "AdminPage",
      exportName: "Default",
      storiesModule: "page.stories",
      filePath: storyFile,
      code: readFileSync(storyFile, "utf8"),
    }], { frontendDir: root })

    expect(missingStorySnapshotDependencies(root)).toEqual([])
    runCaptureScript(generated)

    const snapshotFile = join(root, ".logos", "__snapshots__", "story-snapshots", "admin-page--default.html")
    expect(readFileSync(snapshotFile, "utf8")).toContain("Project owns Playwright")
  }, 90_000)
})

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

describe("compareStorySnapshots", () => {
  it("detects matching, changed, added, and missing snapshots", () => {
    const baselineRoot = createProject()
    const liveRoot = createProject()
    const baseSnaps = join(baselineRoot, ".logos", "__snapshots__", "story-snapshots")
    const liveSnaps = join(liveRoot, ".logos", "__snapshots__", "story-snapshots")
    mkdirSync(baseSnaps, { recursive: true })
    mkdirSync(liveSnaps, { recursive: true })

    writeFileSync(join(baseSnaps, "story-a.html"), "<div>same</div>")
    writeFileSync(join(liveSnaps, "story-a.html"), "<div>same</div>")

    writeFileSync(join(baseSnaps, "story-b.html"), "<div>before</div>")
    writeFileSync(join(liveSnaps, "story-b.html"), "<div>after</div>")

    writeFileSync(join(baseSnaps, "story-c.html"), "<div>removed</div>")
    // story-c has no live snapshot

    // story-d has no baseline
    writeFileSync(join(liveSnaps, "story-d.html"), "<div>added</div>")

    const stories: StoryEntry[] = [
      { id: "story-a", component: "A", exportName: "Default", storiesModule: "a.stories", filePath: "/a.stories.tsx", code: "" },
      { id: "story-b", component: "B", exportName: "Default", storiesModule: "b.stories", filePath: "/b.stories.tsx", code: "" },
      { id: "story-c", component: "C", exportName: "Default", storiesModule: "c.stories", filePath: "/c.stories.tsx", code: "" },
      { id: "story-d", component: "D", exportName: "Default", storiesModule: "d.stories", filePath: "/d.stories.tsx", code: "" },
    ]

    const result = compareStorySnapshots(baselineRoot, liveRoot, stories)

    expect(result).toEqual([
      { storyId: "story-a", title: "A / Default", baseline: "<div>same</div>", live: "<div>same</div>", match: true },
      { storyId: "story-b", title: "B / Default", baseline: "<div>before</div>", live: "<div>after</div>", match: false },
      { storyId: "story-c", title: "C / Default", baseline: "<div>removed</div>", live: null, match: false },
      { storyId: "story-d", title: "D / Default", baseline: null, live: "<div>added</div>", match: false },
    ])
  })
})

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

describe("getStorySnapshot", () => {
  it("reads a snapshot by story id", () => {
    const root = createProject()
    const snapDir = join(root, ".logos", "__snapshots__", "story-snapshots")
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, "my-story.html"), "<div>hello</div>")

    expect(getStorySnapshot(root, "my-story")).toBe("<div>hello</div>")
  })

  it("returns null for missing snapshots", () => {
    const root = createProject()
    expect(getStorySnapshot(root, "nonexistent")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Legacy snapshot store
// ---------------------------------------------------------------------------

describe("snapshot store", () => {
  it("loads generated browser snapshots by story id", () => {
    const root = createProject()
    writeHarness(root)
    const snapDir = join(root, ".logos", "__snapshots__")
    mkdirSync(join(snapDir, "story-snapshots"), { recursive: true })
    writeFileSync(join(snapDir, "story-snapshots", "admin-page--default.html"), "<!doctype html><html><body><div>Default</div></body></html>")

    const storyFile = join(root, "app", "admin", "page.stories.tsx")
    const store = loadStorySnapshotStore(root)

    expect(store.get({
      id: "admin-page--default",
      component: "AdminPage",
      exportName: "Default",
      storiesModule: "page.stories",
      filePath: storyFile,
      code: "export const Default = {}",
    })).toBe("<!doctype html><html><body><div>Default</div></body></html>")
  })

  it("still loads legacy Vitest snapshots by story file and export name", () => {
    const root = createProject()
    writeHarness(root)
    const snapDir = join(root, ".logos", "__snapshots__")
    mkdirSync(snapDir, { recursive: true })
    writeFileSync(join(snapDir, "story-snapshots.test.tsx.snap"), [
      "exports[`logos story snapshots > AdminPage / Default > captured: ./app/admin/page.stories.tsx / Default 1`] = `<div>Default</div>`;",
      "",
    ].join("\n"))

    const storyFile = join(root, "app", "admin", "page.stories.tsx")
    const store = loadStorySnapshotStore(root)

    expect(store.get({
      id: "admin-page--default",
      component: "AdminPage",
      exportName: "Default",
      storiesModule: "page.stories",
      filePath: storyFile,
      code: "export const Default = {}",
    })).toBe("<div>Default</div>")
  })

  it("parses Vitest snapshot records with their source file", () => {
    expect(parseSnapshotKeys("exports[`a 1`] = `value`;", ".logos/__snapshots__/x.snap")).toEqual([
      { key: "a 1", value: "value", snapshotFile: ".logos/__snapshots__/x.snap" },
    ])
  })
})

// ---------------------------------------------------------------------------
// Dependency check
// ---------------------------------------------------------------------------

describe("dependency check", () => {
  it("reports Playwright as missing", () => {
    const root = createProject()
    mkdirSync(join(root, "node_modules"), { recursive: true })
    linkProjectDependency(root, "react")
    linkProjectDependency(root, "react-dom")
    linkProjectDependency(root, "vite")
    linkProjectDependency(root, "@storybook/react")

    expect(missingStorySnapshotDependencies(root)).toEqual(["playwright"])
  })

  it("reports Storybook React as missing", () => {
    const root = createProject()
    mkdirSync(join(root, "node_modules"), { recursive: true })
    linkProjectDependency(root, "react")
    linkProjectDependency(root, "react-dom")
    linkProjectDependency(root, "playwright")

    expect(missingStorySnapshotDependencies(root)).toEqual(["@storybook/react"])
  })
})
