import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
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
  if (opts?.lockfile === true) {
    writeFileSync(join(root, "pnpm-lock.yaml"), [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .: {}",
      "",
    ].join("\n"))
  }
  return root
}

function makePnpmProject(root: string, opts?: { lockfile?: boolean; seed?: string }): string {
  mkdirSync(root, { recursive: true })
  const seed = opts?.seed ?? "default"
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: `pnpm-test-${seed}`, version: "1.0.0", packageManager: "pnpm@11.8.0" }))
  if (opts?.lockfile !== false) {
    writeFileSync(join(root, "pnpm-lock.yaml"), [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .: {}",
      "",
    ].join("\n"))
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
  execFileSync("pnpm", ["install"], { cwd: root, stdio: "ignore" })
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
  rmSync(join(root, "pnpm-lock.yaml"), { force: true })
  return root
}

function makeProjectWithCliDep(root: string, packageRoot: string): string {
  mkdirSync(join(packageRoot, "bin"), { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "asset-cli",
    version: "1.0.0",
    bin: { "asset-cli": "bin/cli.js" },
  }))
  writeFileSync(join(packageRoot, "bin", "asset.txt"), "asset ok")
  writeFileSync(join(packageRoot, "bin", "cli.js"), [
    "#!/usr/bin/env node",
    "const { readFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "console.log(readFileSync(join(__dirname, 'asset.txt'), 'utf8'))",
    "",
  ].join("\n"))

  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "test-with-cli-dep",
    version: "1.0.0",
    dependencies: { "asset-cli": `file:${packageRoot}` },
  }))
  execFileSync("pnpm", ["install"], { cwd: root, stdio: "ignore" })
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
  rmSync(join(root, "pnpm-lock.yaml"), { force: true })
  return root
}

function makePnpmProjectWithCliDep(root: string, packageRoot: string): string {
  mkdirSync(join(packageRoot, "bin"), { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "asset-cli",
    version: "1.0.0",
    bin: { "asset-cli": "bin/cli.js" },
  }))
  writeFileSync(join(packageRoot, "bin", "asset.txt"), "asset ok")
  writeFileSync(join(packageRoot, "bin", "cli.js"), [
    "#!/usr/bin/env node",
    "const { readFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "console.log(readFileSync(join(__dirname, 'asset.txt'), 'utf8'))",
    "",
  ].join("\n"))

  mkdirSync(root, { recursive: true })
  const packageRel = relative(root, packageRoot).split("\\").join("/")
  const packageSpec = packageRel && packageRel !== ".." && !packageRel.startsWith("../")
    ? `file:./${packageRel}`
    : `file:${packageRoot}`
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "pnpm-test-with-cli-dep",
    version: "1.0.0",
    packageManager: "pnpm@11.8.0",
    dependencies: { "asset-cli": packageSpec },
  }))
  execFileSync("pnpm", ["install"], { cwd: root, stdio: "ignore" })
  const lockContent = readFileSync(join(root, "pnpm-lock.yaml"), "utf8")
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
  writeFileSync(join(root, "pnpm-lock.yaml"), lockContent)
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

  it("produces different cache keys for different manifests", () => {
    const tmp = makeTempDir()
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const r1 = cache.ensureFor(makeProject(join(tmp, "p1"), { seed: "alpha" }))
    const r2 = cache.ensureFor(makeProject(join(tmp, "p2"), { seed: "beta" }))

    expect(r1.cacheKey).not.toBe(r2.cacheKey)
  })

  it("uses package.json hash when no lockfile exists", () => {
    const tmp = makeTempDir()
    const project = makeProject(join(tmp, "project"), { lockfile: false })
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const result = cache.ensureFor(project)
    expect(result.hit).toBe(false)
    expect(result.cacheKey).toBeTruthy()
    expect(existsSync(result.nodeModulesPath)).toBe(true)
  })

  it("uses an ancestor PNPM project for nested packages without lockfiles", () => {
    const tmp = makeTempDir()
    const root = join(tmp, "project")
    makePnpmProject(root)
    const nested = join(root, "lib", "generated", "snapshot")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "package.json"), JSON.stringify({ name: "generated-snapshot", version: "1.0.0" }))
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const result = cache.ensureFor(nested)

    expect(result.hit).toBe(false)
    expect(existsSync(result.nodeModulesPath)).toBe(true)
    expect(result.nodeModulesPath).toBe(join(nested, "node_modules"))
    expect(result.cacheKey).toBe("")

    const hit = cache.ensureFor(nested)
    expect(hit.hit).toBe(true)
    expect(hit.nodeModulesPath).toBe(result.nodeModulesPath)
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

  it("invalidates cache when package metadata changes", () => {
    const tmp = makeTempDir()
    const project = join(tmp, "project")
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    makeProject(project, { seed: "v1" })
    const r1 = cache.ensureFor(project)

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

  it("installs PNPM projects in place instead of linking shared cached node_modules", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const result = cache.ensureFor(project)

    expect(result.hit).toBe(false)
    expect(result.cacheKey).toBe("")
    expect(result.nodeModulesPath).toBe(join(project, "node_modules"))
    expect(lstatSync(result.nodeModulesPath).isDirectory()).toBe(true)
    expect(existsSync(cacheDir)).toBe(false)

    const output = execFileSync(join(project, "node_modules", ".bin", "asset-cli"), { cwd: project, encoding: "utf8" })
    expect(output.trim()).toBe("asset ok")
  })

  it("replaces stale node_modules symlinks when installing PNPM projects in place", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })
    const stale = join(tmp, "stale-node-modules")
    mkdirSync(stale, { recursive: true })
    symlinkSync(stale, join(project, "node_modules"))

    const result = cache.ensureFor(project)

    expect(result.nodeModulesPath).toBe(join(project, "node_modules"))
    expect(lstatSync(result.nodeModulesPath).isDirectory()).toBe(true)
    expect(existsSync(join(result.nodeModulesPath, ".bin", "asset-cli"))).toBe(true)
  })

  it("recovers from self-referential PNPM node_modules symlinks", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })
    const target = join(project, "node_modules")
    symlinkSync(target, target)

    const result = cache.ensureFor(project)

    expect(result.nodeModulesPath).toBe(target)
    expect(lstatSync(target).isDirectory()).toBe(true)
    expect(lstatSync(target).isSymbolicLink()).toBe(false)
    expect(existsSync(join(target, ".bin", "asset-cli"))).toBe(true)
  })

  it("replaces valid-looking PNPM node_modules symlinks with workspace-local installs", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "source")
    const projectRoot = join(tmp, "project")
    const source = makePnpmProjectWithCliDep(sourceRoot, join(sourceRoot, ".fixtures", "asset-cli"))
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: source, stdio: "ignore" })
    symlinkSync(join(source, "node_modules"), join(project, "node_modules"))
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })

    const result = cache.ensureFor(project)

    expect(result.nodeModulesPath).toBe(join(project, "node_modules"))
    expect(lstatSync(result.nodeModulesPath).isDirectory()).toBe(true)
    expect(lstatSync(result.nodeModulesPath).isSymbolicLink()).toBe(false)
    expect(existsSync(join(result.nodeModulesPath, ".bin", "asset-cli"))).toBe(true)
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

  it("rebuilds .bin links so package-relative CLI assets resolve", () => {
    const tmp = makeTempDir()
    const project = makeProjectWithCliDep(join(tmp, "project"), join(tmp, "asset-cli"))
    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    const result = cache.ensureFor(project)
    const bin = join(result.nodeModulesPath, ".bin", "asset-cli")

    expect(lstatSync(bin).isSymbolicLink()).toBe(true)
    expect(readlinkSync(bin)).toBe("../asset-cli/bin/cli.js")

    const output = execFileSync(bin, { cwd: project, encoding: "utf8" })
    expect(output.trim()).toBe("asset ok")
  })

  it("relinks stale node_modules symlinks to the current cache entry", () => {
    const tmp = makeTempDir()
    const project = makeProjectWithCliDep(join(tmp, "project"), join(tmp, "asset-cli"))
    const cache = new NodeModulesCache({ cacheDir: join(tmp, "cache") })
    const result = cache.ensureFor(project)
    const stale = join(tmp, "stale-node-modules")
    mkdirSync(stale, { recursive: true })
    const target = join(project, "node_modules")
    symlinkSync(stale, target)

    cache.relinkTo(result.nodeModulesPath, target)

    expect(readlinkSync(target)).toBe(result.nodeModulesPath)
    const output = execFileSync(join(target, ".bin", "asset-cli"), { cwd: project, encoding: "utf8" })
    expect(output.trim()).toBe("asset ok")
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

  it("does not crash on dependencies with unapproved build scripts", () => {
    const tmp = makeTempDir()
    const localPkg = join(tmp, "local-pkg")
    mkdirSync(localPkg, { recursive: true })
    writeFileSync(join(localPkg, "package.json"), JSON.stringify({
      name: "build-pkg",
      version: "1.0.0",
      scripts: { postinstall: "echo built" },
    }))

    const project = join(tmp, "project")
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, "package.json"), JSON.stringify({
      name: "test-build-scripts",
      version: "1.0.0",
      dependencies: { "build-pkg": `file:${localPkg}` },
    }))

    const cacheDir = join(tmp, "cache")
    const cache = new NodeModulesCache({ cacheDir })

    expect(() => cache.ensureFor(project)).not.toThrow()
    expect(existsSync(join(project, "node_modules")) || readdirSync(cacheDir).length > 0).toBe(true)
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

  it("keeps PNPM workspace instance node_modules local when dependency ensure runs again", () => {
    const tmp = makeTempDir()
    const sourceRoot = join(tmp, "project")
    const projectRoot = makePnpmProjectWithCliDep(sourceRoot, join(sourceRoot, ".fixtures", "asset-cli"))
    const runsDir = join(tmp, "runs")
    const service = new WorkspaceCodeService({ runsDir, projectRoot, nodeModulesDirs: [] })

    const instance = service.createInstance("ws", projectRoot, {})
    service.ensureCachedNodeModules(instance)

    const nodeModules = join(instance.materializedRoot, "node_modules")
    expect(existsSync(nodeModules)).toBe(true)
    expect(lstatSync(nodeModules).isDirectory()).toBe(true)
    expect(lstatSync(nodeModules).isSymbolicLink()).toBe(false)
    expect(existsSync(join(nodeModules, ".bin", "asset-cli"))).toBe(true)
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
