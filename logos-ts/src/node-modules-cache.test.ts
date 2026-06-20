import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { NodeModulesCache, findPackageDirs } from "./node-modules-cache.js"
import { createSessionProject } from "./session-project.js"
import { WorkspaceCodeService } from "./workspace-code-service.js"

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-nm-cache-"))
  tempDirs.push(dir)
  return dir
}

function makeProject(root: string, opts?: { lockfile?: boolean; seed?: string }): string {
  mkdirSync(root, { recursive: true })
  const seed = opts?.seed ?? "default"
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: `test-${seed}`, version: "1.0.0" }))
  if (opts?.lockfile !== false) {
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({
      name: `test-${seed}`,
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: `test-${seed}`, version: "1.0.0" } },
    }))
  }
  return root
}

function makeProjectWithDep(root: string): string {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "test-with-dep",
    version: "1.0.0",
    dependencies: { "is-odd": "3.0.1" },
  }))
  execFileSync("npm", ["install"], { cwd: root, stdio: "ignore" })
  const lockContent = readFileSync(join(root, "package-lock.json"), "utf8")
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
  writeFileSync(join(root, "package-lock.json"), lockContent)
  return root
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("NodeModulesCache", () => {
  it("finds nested package directories in demo-style repos", () => {
    const tmp = makeTempDir()
    makeProject(join(tmp, "project"))
    makeProject(join(tmp, "project", "studio"))
    makeProject(join(tmp, "project", "demos", "hn-jobs"))

    expect(findPackageDirs(join(tmp, "project")).map((dir) => dir.slice(join(tmp, "project").length + 1)).sort()).toEqual([
      "",
      "demos/hn-jobs",
      "studio",
    ])
  })

  it("installs on cache miss and returns hit on second call", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const miss = cache.ensureFor(project)
    expect(miss.hit).toBe(false)
    expect(miss.cacheKey).toBeTruthy()
    expect(existsSync(miss.nodeModulesPath)).toBe(true)

    const hit = cache.ensureFor(project)
    expect(hit.hit).toBe(true)
    expect(hit.cacheKey).toBe(miss.cacheKey)
    expect(hit.nodeModulesPath).toBe(miss.nodeModulesPath)
  })

  it("links cached node_modules into a target directory", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"))
    const target = join(tmp, "workspace", "node_modules")
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const result = cache.ensureAndLink(project, target)
    expect(existsSync(target)).toBe(true)
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(result.cacheKey).toBeTruthy()
  })

  it("produces different cache keys for different lockfiles", () => {
    const tmp = makeTempDir()
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const r1 = cache.ensureFor(makeProject(join(tmp, "p1"), { seed: "alpha" }))
    const r2 = cache.ensureFor(makeProject(join(tmp, "p2"), { seed: "beta" }))

    expect(r1.cacheKey).not.toBe(r2.cacheKey)
  })

  it("falls back to package.json hash when no lockfile exists", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"), { lockfile: false })
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const result = cache.ensureFor(project)
    expect(result.hit).toBe(false)
    expect(result.cacheKey).toBeTruthy()
    expect(existsSync(result.nodeModulesPath)).toBe(true)
  })

  it("evicts oldest entries when cache exceeds max", () => {
    const tmp = makeTempDir()
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir, maxEntries: 2 })

    cache.ensureFor(makeProject(join(tmp, "p0"), { seed: "zero" }))
    cache.ensureFor(makeProject(join(tmp, "p1"), { seed: "one" }))
    expect(readdirSync(cacheDir).length).toBe(2)

    cache.ensureFor(makeProject(join(tmp, "p2"), { seed: "two" }))
    expect(readdirSync(cacheDir).length).toBe(2)
  })

  it("skips caching for directories without package.json", () => {
    const tmp = makeTempDir()
    const noPackage = join(tmp, "empty")
    mkdirSync(noPackage, { recursive: true })
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const result = cache.ensureFor(noPackage)
    expect(result.cacheKey).toBe("")
    expect(existsSync(cacheDir)).toBe(false)
  })

  it("invalidates cache when lockfile content changes", () => {
    const tmp = makeTempDir()
    const project = join(tmp, "project")
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    makeProject(project, { seed: "v1" })
    const r1 = cache.ensureFor(project)

    writeFileSync(join(project, "package-lock.json"), JSON.stringify({
      name: "test-v2",
      version: "2.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "test-v2", version: "2.0.0" } },
    }))
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "test-v2", version: "2.0.0" }))
    const r2 = cache.ensureFor(project)

    expect(r2.cacheKey).not.toBe(r1.cacheKey)
    expect(r2.hit).toBe(false)
    expect(readdirSync(cacheDir).length).toBe(2)
  })

  it("recovers from a corrupt cache entry (missing node_modules dir)", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const r1 = cache.ensureFor(project)
    expect(r1.hit).toBe(false)

    rmSync(r1.nodeModulesPath, { recursive: true, force: true })

    const r2 = cache.ensureFor(project)
    expect(r2.hit).toBe(false)
    expect(existsSync(r2.nodeModulesPath)).toBe(true)
  })

  it("installs real deps and resolves them through the symlink", () => {
    const tmp = makeTempDir()
    const project = makeProjectWithDep(join(tmp, "project"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const result = cache.ensureFor(project)
    expect(result.hit).toBe(false)
    expect(existsSync(join(result.nodeModulesPath, "is-odd"))).toBe(true)

    const workspace = join(tmp, "workspace")
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, "test.js"), "console.log(require('is-odd')(3))")
    cache.linkTo(result.nodeModulesPath, join(workspace, "node_modules"))

    const output = execFileSync("node", ["test.js"], { cwd: workspace, encoding: "utf8" })
    expect(output.trim()).toBe("true")
  })

  it("preserves .bin symlinks so binaries resolve correctly", () => {
    const tmp = makeTempDir()
    const project = makeProjectWithDep(join(tmp, "project"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const result = cache.ensureFor(project)
    const binDir = join(result.nodeModulesPath, ".bin")
    if (existsSync(binDir)) {
      for (const entry of readdirSync(binDir)) {
        const full = join(binDir, entry)
        expect(lstatSync(full).isSymbolicLink()).toBe(true)
        const target = readlinkSync(full)
        const resolvedTarget = resolve(binDir, target)
        expect(existsSync(resolvedTarget)).toBe(true)
      }
    }
  })

  it("multiple workspaces share the same cache entry", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    cache.ensureFor(project)

    const targets = [1, 2, 3].map((i) => join(tmp, `ws-${i}`, "node_modules"))
    for (const target of targets) {
      cache.ensureAndLink(project, target)
    }

    const resolvedPaths = targets.map((t) => readlinkSync(t))
    expect(new Set(resolvedPaths).size).toBe(1)
    expect(readdirSync(cacheDir).length).toBe(1)
  })
})

describe("findPackageDirs", () => {
  it("finds root and nested package.json directories", () => {
    const tmp = makeTempDir()
    const root = join(tmp, "project")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "frontend"), { recursive: true })
    writeFileSync(join(root, "frontend", "package.json"), "{}")
    mkdirSync(join(root, "docs"), { recursive: true })

    const dirs = findPackageDirs(root)
    expect(dirs).toContain(root)
    expect(dirs).toContain(join(root, "frontend"))
    expect(dirs).not.toContain(join(root, "docs"))
  })

  it("skips node_modules and dot directories", () => {
    const tmp = makeTempDir()
    const root = join(tmp, "project")
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true })
    writeFileSync(join(root, "node_modules", "dep", "package.json"), "{}")
    mkdirSync(join(root, ".hidden"), { recursive: true })
    writeFileSync(join(root, ".hidden", "package.json"), "{}")

    const dirs = findPackageDirs(root)
    expect(dirs).toEqual([root])
  })
})

describe("session project integration", () => {
  it("creates a session with cached node_modules symlinked in", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "source")
    makeProject(sourceRoot)
    writeFileSync(join(sourceRoot, "app.ts"), "export const x = 1")
    const sessionsDir = join(tmp, "sessions")

    const session = createSessionProject(sourceRoot, sessionsDir)

    expect(session.root).not.toBe(sourceRoot)
    expect(readFileSync(join(session.root, "app.ts"), "utf8")).toContain("export const x")
    expect(existsSync(join(session.root, "node_modules"))).toBe(true)
    expect(lstatSync(join(session.root, "node_modules")).isSymbolicLink()).toBe(true)
  })

  it("handles a cold start where source has no node_modules", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "source")
    makeProject(sourceRoot)
    const sessionsDir = join(tmp, "sessions")

    expect(existsSync(join(sourceRoot, "node_modules"))).toBe(false)

    const session = createSessionProject(sourceRoot, sessionsDir)

    expect(existsSync(join(session.root, "node_modules"))).toBe(true)
    expect(lstatSync(join(session.root, "node_modules")).isSymbolicLink()).toBe(true)
  })

  it("caches across multiple session creations with the same lockfile", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "source")
    makeProject(sourceRoot)

    const s1 = createSessionProject(sourceRoot, join(tmp, "sessions"))
    const s2 = createSessionProject(sourceRoot, join(tmp, "sessions"))

    const link1 = readlinkSync(join(s1.root, "node_modules"))
    const link2 = readlinkSync(join(s2.root, "node_modules"))
    expect(link1).toBe(link2)
  })

  it("handles nested package dirs in a monorepo-style project", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "source")
    makeProject(sourceRoot)
    const frontend = join(sourceRoot, "frontend")
    makeProject(frontend, { seed: "frontend" })
    const sessionsDir = join(tmp, "sessions")

    const session = createSessionProject(sourceRoot, sessionsDir)

    expect(existsSync(join(session.root, "node_modules"))).toBe(true)
    expect(lstatSync(join(session.root, "node_modules")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(session.root, "frontend", "node_modules"))).toBe(true)
    expect(lstatSync(join(session.root, "frontend", "node_modules")).isSymbolicLink()).toBe(true)

    const rootLink = readlinkSync(join(session.root, "node_modules"))
    const frontendLink = readlinkSync(join(session.root, "frontend", "node_modules"))
    expect(rootLink).not.toBe(frontendLink)
  })
})

describe("workspace code service integration", () => {
  it("creates workspace instances with cached node_modules", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    makeProject(projectRoot)
    const runsDir = join(tmp, "runs")
    const service = new WorkspaceCodeService({ runsDir, projectRoot, nodeModulesDirs: [] })

    const instance = service.createInstance("ws", projectRoot, {})

    expect(existsSync(join(instance.materializedRoot, "node_modules"))).toBe(true)
    expect(lstatSync(join(instance.materializedRoot, "node_modules")).isSymbolicLink()).toBe(true)
  })

  it("shares the same cache entry across multiple workspace instances", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    makeProject(projectRoot)
    const runsDir = join(tmp, "runs")
    const service = new WorkspaceCodeService({ runsDir, projectRoot, nodeModulesDirs: [] })

    const i1 = service.createInstance("ws", projectRoot, {})
    const i2 = service.createInstance("ws", projectRoot, {})

    const link1 = readlinkSync(join(i1.materializedRoot, "node_modules"))
    const link2 = readlinkSync(join(i2.materializedRoot, "node_modules"))
    expect(link1).toBe(link2)
  })

  it("full lifecycle: session → workspace fork with require() resolution", () => {
    const tmp = makeTempDir()
    const sourceRoot = makeProjectWithDep(join(tmp, "source"))
    writeFileSync(join(sourceRoot, "index.js"), "console.log(require('is-odd')(3))")

    const session = createSessionProject(sourceRoot, join(tmp, "sessions"))
    const output1 = execFileSync("node", ["index.js"], { cwd: session.root, encoding: "utf8" })
    expect(output1.trim()).toBe("true")

    const runsDir = join(tmp, "runs")
    const service = new WorkspaceCodeService({ runsDir, projectRoot: session.root, nodeModulesDirs: [] })
    const instance = service.createInstance("ws", session.root, {})
    const output2 = execFileSync("node", ["index.js"], { cwd: instance.materializedRoot, encoding: "utf8" })
    expect(output2.trim()).toBe("true")
  })
})
