import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TsIndexCache } from "./ts-index-cache.js"

const LOGOS_TS_ROOT = resolve(import.meta.dirname, "..")
const TSX = resolve(LOGOS_TS_ROOT, "node_modules/.bin/tsx")

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-index-cache-test-"))
  tempDirs.push(dir)
  return dir
}

function initGitRepo(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" })
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" })
}

function gitCommit(dir: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" })
  execFileSync("git", ["commit", "--allow-empty", "-m", message], { cwd: dir, stdio: "ignore" })
}

function createProject(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content)
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("TsIndexCache", () => {
  it("produces different cache keys when PROJECT_SOURCE_EXCLUDES changes", async () => {
    const projectDir = tempDir()
    const cacheDir = tempDir()

    createProject(projectDir, {
      "src/app.ts": "export function hello() { return 'hi' }",
      "lib/generated/client.d.ts": "export declare function query(): void",
    })
    initGitRepo(projectDir)
    gitCommit(projectDir, "init")

    const cache = new TsIndexCache({
      logosTsRoot: LOGOS_TS_ROOT,
      tsx: TSX,
      cacheDir,
    })

    const index = cache.buildIndex(projectDir)
    const files = (index as { files: { file: string }[] }).files.map((f) => f.file)

    expect(files).not.toContain("lib/generated/client.d.ts")

    const entries = require("node:fs").readdirSync(cacheDir) as string[]
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatch(/-[0-9a-f]{8}$/)
  })

  it("does not serve a stale cache entry after excludes change", async () => {
    const projectDir = tempDir()
    const cacheDir = tempDir()

    createProject(projectDir, {
      "src/app.ts": "export function hello() { return 'hi' }",
      "lib/generated/client.d.ts": "export declare function query(): void",
    })
    initGitRepo(projectDir)
    gitCommit(projectDir, "init")

    const treeHash = execFileSync("git", ["-C", projectDir, "rev-parse", "HEAD:"], {
      encoding: "utf8",
    }).trim()

    const staleIndex = {
      root: projectDir,
      files: [
        { file: "src/app.ts", code: "...", items: [] },
        { file: "lib/generated/client.d.ts", code: "...", items: [] },
      ],
    }
    const staleCacheKey = treeHash
    mkdirSync(join(cacheDir, staleCacheKey), { recursive: true })
    writeFileSync(join(cacheDir, staleCacheKey, "index.json"), JSON.stringify(staleIndex))

    const cache = new TsIndexCache({
      logosTsRoot: LOGOS_TS_ROOT,
      tsx: TSX,
      cacheDir,
    })

    const index = cache.buildIndex(projectDir)
    const files = (index as { files: { file: string }[] }).files.map((f) => f.file)

    expect(files).not.toContain("lib/generated/client.d.ts")
    expect(files).toContain("src/app.ts")
  })
})
