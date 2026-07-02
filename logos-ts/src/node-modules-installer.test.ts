import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { NodeModulesInstaller, findPackageDirs } from "./node-modules-installer.js"
import { createSessionProject } from "./session-project.js"
import { WorkspaceCodeService } from "./workspace-code-service.js"

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-nm-install-"))
  tempDirs.push(dir)
  return dir
}

function makePnpmProject(root: string, opts?: { seed?: string }): string {
  mkdirSync(root, { recursive: true })
  const seed = opts?.seed ?? "default"
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: `pnpm-test-${seed}`,
    version: "1.0.0",
    packageManager: "pnpm@11.8.0",
  }))
  execFileSync("pnpm", ["install"], { cwd: root, stdio: "ignore" })
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
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
  rmSync(join(root, "node_modules"), { recursive: true, force: true })
  return root
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("NodeModulesInstaller", () => {
  it("runs pnpm in place and does not create a Logos node_modules symlink", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    const installer = new NodeModulesInstaller()

    const result = installer.ensureFor(project)

    expect(result.nodeModulesPath).toBe(join(project, "node_modules"))
    expect(lstatSync(result.nodeModulesPath).isDirectory()).toBe(true)
    expect(lstatSync(result.nodeModulesPath).isSymbolicLink()).toBe(false)
    const output = execFileSync(join(project, "node_modules", ".bin", "asset-cli"), { cwd: project, encoding: "utf8" })
    expect(output.trim()).toBe("asset ok")
  })

  it("replaces stale Logos node_modules symlinks with a local pnpm install", () => {
    const tmp = makeTempDir()
    const projectRoot = join(tmp, "project")
    const project = makePnpmProjectWithCliDep(projectRoot, join(projectRoot, ".fixtures", "asset-cli"))
    const stale = join(tmp, "stale-node-modules")
    mkdirSync(stale, { recursive: true })
    symlinkSync(stale, join(project, "node_modules"))

    new NodeModulesInstaller().ensureFor(project)

    const nodeModules = join(project, "node_modules")
    expect(lstatSync(nodeModules).isDirectory()).toBe(true)
    expect(lstatSync(nodeModules).isSymbolicLink()).toBe(false)
    expect(existsSync(join(nodeModules, ".bin", "asset-cli"))).toBe(true)
  })
})

describe("findPackageDirs", () => {
  it("finds package directories and skips generated directories", () => {
    const tmp = makeTempDir()
    const root = join(tmp, "project")
    makePnpmProject(root)
    makePnpmProject(join(root, "frontend"), { seed: "frontend" })
    mkdirSync(join(root, "node_modules", "dep"), { recursive: true })
    writeFileSync(join(root, "node_modules", "dep", "package.json"), "{}")
    mkdirSync(join(root, ".hidden"), { recursive: true })
    writeFileSync(join(root, ".hidden", "package.json"), "{}")

    expect(findPackageDirs(root).map((dir) => relative(root, dir)).sort()).toEqual(["", "frontend"])
  })
})

describe("session project integration", () => {
  it("creates sessions with local pnpm node_modules", () => {
    const tmp = makeTempDir()
    const sourceRoot = makePnpmProjectWithCliDep(join(tmp, "source"), join(tmp, "source", ".fixtures", "asset-cli"))
    writeFileSync(join(sourceRoot, "app.ts"), "export const x = 1")

    const session = createSessionProject(sourceRoot, join(tmp, "sessions"))

    const nodeModules = join(session.root, "node_modules")
    expect(existsSync(join(session.root, "app.ts"))).toBe(true)
    expect(lstatSync(nodeModules).isDirectory()).toBe(true)
    expect(lstatSync(nodeModules).isSymbolicLink()).toBe(false)
    expect(existsSync(join(nodeModules, ".bin", "asset-cli"))).toBe(true)
  })

  it("handles nested package dirs with local pnpm installs", () => {
    const tmp = makeTempDir()
    const sourceRoot = makePnpmProject(join(tmp, "source"))
    makePnpmProject(join(sourceRoot, "frontend"), { seed: "frontend" })

    const session = createSessionProject(sourceRoot, join(tmp, "sessions"))

    expect(lstatSync(join(session.root, "node_modules")).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(session.root, "frontend", "node_modules")).isSymbolicLink()).toBe(false)
  })
})

describe("workspace code service integration", () => {
  it("creates workspace instances with local pnpm node_modules", () => {
    const tmp = makeTempDir()
    const projectRoot = makePnpmProjectWithCliDep(join(tmp, "project"), join(tmp, "project", ".fixtures", "asset-cli"))
    const service = new WorkspaceCodeService({ runsDir: join(tmp, "runs"), projectRoot, nodeModulesDirs: [] })

    const instance = service.createInstance("ws", projectRoot, {})

    const nodeModules = join(instance.materializedRoot, "node_modules")
    expect(lstatSync(nodeModules).isDirectory()).toBe(true)
    expect(lstatSync(nodeModules).isSymbolicLink()).toBe(false)
    expect(existsSync(join(nodeModules, ".bin", "asset-cli"))).toBe(true)
  })

  it("can defer and then run a local pnpm install", () => {
    const tmp = makeTempDir()
    const projectRoot = makePnpmProject(join(tmp, "project"))
    const service = new WorkspaceCodeService({ runsDir: join(tmp, "runs"), projectRoot, nodeModulesDirs: [] })
    const instance = service.createInstance("ws", projectRoot, {}, { installNodeModules: false })

    expect(existsSync(join(instance.materializedRoot, "node_modules"))).toBe(false)
    service.ensureNodeModules(instance)
    expect(lstatSync(join(instance.materializedRoot, "node_modules")).isSymbolicLink()).toBe(false)
  })
})
