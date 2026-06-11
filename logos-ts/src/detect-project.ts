import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve, relative, dirname } from "node:path"

export interface StorybookCaps {
  configDir: string
  frontendDir: string
}

export interface TestCaps {
  command: string[]
  watchDirs: string[]
}

export interface ProjectCaps {
  root: string
  storybook: StorybookCaps | null
  tests: TestCaps | null
  nodeModulesDirs: string[]
}

export function detectProject(root: string): ProjectCaps {
  const absRoot = resolve(root)
  return {
    root: absRoot,
    storybook: detectStorybook(absRoot),
    tests: detectTests(absRoot),
    nodeModulesDirs: findNodeModules(absRoot),
  }
}

function detectStorybook(root: string): StorybookCaps | null {
  // Look for .storybook/ at depth 1 and 2
  for (const depth1 of safeReaddir(root)) {
    const d1 = join(root, depth1)
    if (depth1 === ".storybook") {
      return { configDir: d1, frontendDir: root }
    }
    if (depth1 === "node_modules" || depth1.startsWith(".")) continue
    try {
      for (const depth2 of safeReaddir(d1)) {
        if (depth2 === ".storybook") {
          return { configDir: join(d1, depth2), frontendDir: d1 }
        }
      }
    } catch { /* not a directory */ }
  }
  return null
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
        command: ["npx", "vitest", "run"],
        watchDirs: findSourceDirs(root),
      }
    }
  }

  // 3. jest.config.* at root
  for (const name of safeReaddir(root)) {
    if (/^jest\.config\.\w+$/.test(name)) {
      return {
        command: ["npx", "jest", "--json"],
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
          command: ["npm", "test"],
          watchDirs: findSourceDirs(root),
        }
      }
    } catch { /* malformed package.json */ }
  }

  return null
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
