/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, resolve, relative, dirname } from "node:path"

export interface StorybookCaps {
  configDir: string
  frontendDir: string
}

export interface TestCaps {
  command: string[]
  watchDirs: string[]
}

export interface RunTargetCaps {
  id: string
  label: string
  cwd: string
  command: string
  args: string[]
  framework: "vite" | "next"
  env?: Record<string, string>
}

export interface ProjectCaps {
  root: string
  storybook: StorybookCaps | null
  storybooks: StorybookCaps[]
  tests: TestCaps | null
  runs: RunTargetCaps[]
  nodeModulesDirs: string[]
}

export function detectProject(root: string): ProjectCaps {
  const absRoot = resolve(root)
  const storybooks = detectStorybooks(absRoot)
  return {
    root: absRoot,
    storybook: storybooks[0] ?? null,
    storybooks,
    tests: detectTests(absRoot),
    runs: detectRuns(absRoot),
    nodeModulesDirs: findNodeModules(absRoot),
  }
}

function detectStorybooks(root: string): StorybookCaps[] {
  const out: StorybookCaps[] = []
  const visit = (dir: string) => {
    if (existsSync(join(dir, ".storybook"))) {
      out.push({ configDir: join(dir, ".storybook"), frontendDir: dir })
      return
    }
    for (const entry of safeReaddir(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue
      const sub = join(dir, entry)
      try {
        if (readdirSync(sub, { withFileTypes: true })) visit(sub)
      } catch { /* not a directory */ }
    }
  }
  visit(root)
  return out.sort((a, b) => relative(root, a.frontendDir).localeCompare(relative(root, b.frontendDir)))
}

function detectTests(root: string): TestCaps | null {
  // 1. Logos-style healthcheck script
  const healthcheck = join(root, "scripts", "healthcheck.mjs")
  if (existsSync(healthcheck)) {
    return {
      command: ["node", "scripts/healthcheck.mjs"],
      watchDirs: findSourceDirs(root),
    }
  }

  // 2. vitest.config.* at root
  for (const name of safeReaddir(root)) {
    if (/^vitest\.config\.\w+$/.test(name)) {
      return {
        command: ["pnpm", "exec", "vitest", "run"],
        watchDirs: findSourceDirs(root),
      }
    }
  }

  // 3. jest.config.* at root
  for (const name of safeReaddir(root)) {
    if (/^jest\.config\.\w+$/.test(name)) {
      return {
        command: ["pnpm", "exec", "jest", "--json"],
        watchDirs: findSourceDirs(root),
      }
    }
  }

  // 4. "test" script in package.json
  const pkgPath = join(root, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
        return {
          command: ["pnpm", "test"],
          watchDirs: findSourceDirs(root),
        }
      }
    } catch { /* malformed package.json */ }
  }

  return null
}

function detectRuns(root: string): RunTargetCaps[] {
  const targets: RunTargetCaps[] = []
  const packageDirs = findPackageDirs(root)

  for (const dir of packageDirs) {
    const pkgPath = join(dir, "package.json")
    let pkg: any
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    } catch {
      continue
    }

    const rel = relative(root, dir)
    const idBase = rel ? rel.replace(/[^a-zA-Z0-9_-]+/g, "-") : "root"
    const labelBase = rel ? basenameSafe(rel) : "App"
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const hasVite = Boolean(deps["vite"])
    const hasNext = Boolean(deps["next"])
    const devScript = scripts["dev"]
    const hasViteEntrypoint = existsSync(join(dir, "index.html"))
    const hasNextEntrypoint = existsSync(join(dir, "next.config.js")) ||
      existsSync(join(dir, "next.config.mjs")) ||
      existsSync(join(dir, "next.config.ts")) ||
      existsSync(join(dir, "app")) ||
      existsSync(join(dir, "pages"))
    const env = runTargetEnv(pkg)

    if (hasNext && hasNextEntrypoint) {
      targets.push({
        id: `${idBase}-app`,
        label: targets.length === 0 ? "App" : `${labelBase} App`,
        cwd: dir,
        command: devScript ? "pnpm" : "node_modules/.bin/next",
        args: devScript
          ? ["dev", "--hostname", "127.0.0.1", "--port", "${PORT}"]
          : ["dev", "--hostname", "127.0.0.1", "--port", "${PORT}"],
        framework: "next",
        ...(env ? { env } : {}),
      })
      continue
    }

    if (devScript && hasViteEntrypoint && (hasVite || /\bvite\b/.test(devScript))) {
      targets.push({
        id: `${idBase}-app`,
        label: targets.length === 0 ? "App" : `${labelBase} App`,
        cwd: dir,
        command: "pnpm",
        args: ["dev", "--host", "127.0.0.1", "--port", "${PORT}", "--base", "${BASE}"],
        framework: "vite",
        ...(env ? { env } : {}),
      })
      continue
    }

    if (hasVite && hasViteEntrypoint) {
      targets.push({
        id: `${idBase}-app`,
        label: targets.length === 0 ? "App" : `${labelBase} App`,
        cwd: dir,
        command: "node_modules/.bin/vite",
        args: ["--host", "127.0.0.1", "--port", "${PORT}", "--base", "${BASE}"],
        framework: "vite",
        ...(env ? { env } : {}),
      })
    }
  }

  return targets
}

function runTargetEnv(pkg: { name?: unknown }): Record<string, string> | undefined {
  if (pkg.name === "logos-ts-studio") return { LOGOS_PROJECT: "${WORKSPACE_ROOT}" }
  return undefined
}

function findPackageDirs(root: string): string[] {
  const dirs: string[] = []
  const rootPkg = join(root, "package.json")
  if (existsSync(rootPkg)) dirs.push(root)

  for (const name of safeReaddir(root)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const dir = join(root, name)
    const pkg = join(dir, "package.json")
    if (existsSync(pkg)) dirs.push(dir)
  }

  return dirs
}

function basenameSafe(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  const base = parts[parts.length - 1] ?? path
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function findSourceDirs(root: string): string[] {
  const dirs: string[] = []
  for (const name of safeReaddir(root)) {
    if (name === "node_modules" || name === "dist" || name === ".git" || name.startsWith(".")) continue
    const full = join(root, name)
    try {
      const stat = readdirSync(full, { withFileTypes: true })
      const hasSrc = stat.some(e => /\.(tsx?|jsx?)$/.test(e.name) || e.isDirectory())
      if (hasSrc) dirs.push(name)
    } catch { /* not a directory */ }
  }
  return dirs.length ? dirs : ["."]
}

function findNodeModules(root: string): string[] {
  const results: string[] = []
  const rootNm = join(root, "node_modules")
  if (existsSync(rootNm)) results.push(rootNm)

  for (const name of safeReaddir(root)) {
    if (name === "node_modules" || name.startsWith(".")) continue
    const sub = join(root, name, "node_modules")
    if (existsSync(sub)) results.push(sub)
  }
  return results
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}
