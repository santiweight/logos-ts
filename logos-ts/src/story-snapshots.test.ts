import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { ensureStorySnapshotTest, loadStorySnapshotStore, parseSnapshotKeys, type StorySnapshotTestResult } from "./story-snapshots.js"
import type { StoryEntry } from "./stories.js"

const tempDirs: string[] = []
const LOGOS_TS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const STUDIO_NODE_MODULES = resolve(LOGOS_TS_ROOT, "studio", "node_modules")
const VITEST = resolve(LOGOS_TS_ROOT, "node_modules", ".bin", "vitest")

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

function writeHarness(root: string): StorySnapshotTestResult {
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
  return ensureStorySnapshotTest(root, [story], { frontendDir: root })
}

describe("story snapshot virtual storage", () => {
  it("generates a Vitest harness that supports Next-style automatic JSX runtime", () => {
    const root = createProject()
    const generated = writeHarness(root)
    const config = readFileSync(generated.configFile, "utf8")
    const testSource = readFileSync(generated.testFile, "utf8")
    const entrySource = readFileSync(generated.entryFile, "utf8")

    expect(config).toContain("jsx: \"automatic\"")
    expect(config).toContain("include: [\".logos/**/*.test.ts\"]")
    expect(config).toContain("fileURLToPath(import.meta.url)")
    expect(config).not.toContain(root)
    expect(testSource).toContain("chromium.launch")
    expect(testSource).toContain("toMatchFileSnapshot")
    expect(entrySource).toContain("createRoot")
  })

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

  it("still loads legacy generated Vitest snapshots by story file and export name", () => {
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

  it("captures browser snapshots when Storybook preview imports the Logos comment bridge", () => {
    const root = createProject()
    symlinkSync(STUDIO_NODE_MODULES, join(root, "node_modules"), "dir")
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
    const generated = ensureStorySnapshotTest(root, [{
      id: "admin-page--default",
      component: "AdminPage",
      exportName: "Default",
      storiesModule: "page.stories",
      filePath: storyFile,
      code: readFileSync(storyFile, "utf8"),
    }], { frontendDir: root, configDir: join(root, ".storybook") })

    execFileSync(VITEST, [
      "run",
      "--update",
      "--config",
      generated.configFile,
      ".logos/story-snapshots.test.ts",
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        LOGOS_VITEST_CACHE_DIR: join(root, ".logos_cache", "story-snapshots"),
        NODE_ENV: "test",
      },
    })

    const snapshotFile = join(root, ".logos", "__snapshots__", "story-snapshots", "admin-page--default.html")
    expect(existsSync(snapshotFile)).toBe(true)
    const snapshot = readFileSync(snapshotFile, "utf8")
    expect(snapshot).toContain("Wrapped preview works")
    expect(snapshot).toContain("data-logos-story-rendered")
    expect(snapshot).not.toContain("<script")
  }, 90_000)
})
