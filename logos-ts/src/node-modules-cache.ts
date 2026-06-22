import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { basename, dirname, join, relative, resolve } from "node:path"

export interface NmCacheResult {
  cacheKey: string
  nodeModulesPath: string
  hit: boolean
}

export interface NmCacheOptions {
  cacheDir?: string
  maxEntries?: number
}

const DEFAULT_CACHE_DIR = join(homedir(), ".logos", "nm-cache")
const DEFAULT_MAX_ENTRIES = 20
const CACHE_FORMAT_VERSION = "pnpm-cache-v2"

interface PnpmInstall {
  installArgs: string[]
}

export class NodeModulesCache {
  private cacheDir: string
  private maxEntries: number

  constructor(opts?: NmCacheOptions) {
    this.cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  ensureFor(packageDir: string): NmCacheResult {
    if (!existsSync(join(packageDir, "package.json"))) {
      return { cacheKey: "", nodeModulesPath: join(packageDir, "node_modules"), hit: false }
    }

    const pnpmInstall = this.pnpmInstallFor(packageDir)
    if (pnpmInstall) return this.ensurePnpmInPlace(packageDir, pnpmInstall)

    const key = this.computeKey(packageDir)
    if (!key) {
      this.installInPlace(packageDir)
      return { cacheKey: "", nodeModulesPath: join(packageDir, "node_modules"), hit: false }
    }

    const entryDir = join(this.cacheDir, key)
    const cachedNm = join(entryDir, "node_modules")

    if (existsSync(cachedNm)) {
      this.touchEntry(entryDir)
      console.log(`[logos] nm-cache hit: ${key.slice(0, 12)} (${basename(packageDir)})`)
      return { cacheKey: key, nodeModulesPath: cachedNm, hit: true }
    }

    console.log(`[logos] nm-cache miss: installing ${basename(packageDir)}…`)
    mkdirSync(entryDir, { recursive: true })

    this.removeNodeModules(join(packageDir, "node_modules"))
    execFileSync("pnpm", ["install", "--no-lockfile"], {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, CI: "true", NODE_ENV: "" },
    })

    const sourceNm = join(packageDir, "node_modules")
    if (!existsSync(sourceNm)) mkdirSync(sourceNm, { recursive: true })
    // Preserve pnpm's internal symlink graph; flattening package links breaks
    // transitive dependency resolution for packages inside .pnpm.
    execFileSync("cp", ["-R", sourceNm, cachedNm])
    this.rebuildBinLinks(cachedNm)
    rmSync(sourceNm, { recursive: true, force: true })

    const lockSrc = join(packageDir, "package.json")
    writeFileSync(join(entryDir, "source-lock.yaml"), readFileSync(lockSrc))

    this.touchEntry(entryDir)
    this.evict()

    console.log(`[logos] nm-cache stored: ${key.slice(0, 12)}`)
    return { cacheKey: key, nodeModulesPath: cachedNm, hit: false }
  }

  linkTo(cachedNmPath: string, target: string): void {
    if (existsSync(target)) return
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(cachedNmPath, target)
  }

  relinkTo(cachedNmPath: string, target: string): void {
    if (resolve(cachedNmPath) === resolve(target)) return
    try {
      if (readlinkSync(target) === cachedNmPath) return
    } catch {
      // Missing or non-symlink targets are replaced below.
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(cachedNmPath, target)
  }

  ensureAndLink(packageDir: string, target: string): NmCacheResult {
    const result = this.ensureFor(packageDir)
    if (resolve(result.nodeModulesPath) === resolve(target)) return result
    this.linkTo(result.nodeModulesPath, target)
    return result
  }

  private computeKey(packageDir: string): string {
    const packageJson = join(packageDir, "package.json")

    if (!existsSync(packageJson)) return ""

    return createHash("sha256")
      .update(CACHE_FORMAT_VERSION)
      .update("\0")
      .update(readFileSync(packageJson, "utf8"))
      .digest("hex")
      .slice(0, 16)
  }

  private installInPlace(packageDir: string): void {
    if (!existsSync(join(packageDir, "package.json"))) return
    if (existsSync(join(packageDir, "node_modules"))) return
    console.log(`[logos] installing ${basename(packageDir)} (no lockfile, in-place)…`)
    execFileSync("pnpm", ["install", "--no-lockfile"], {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, CI: "true", NODE_ENV: "" },
    })
  }

  private ensurePnpmInPlace(packageDir: string, install: PnpmInstall): NmCacheResult {
    const nodeModulesPath = join(packageDir, "node_modules")
    if (this.isPnpmInstallUsable(packageDir)) {
      console.log(`[logos] pnpm install present: ${basename(packageDir)}`)
      return { cacheKey: "", nodeModulesPath, hit: true }
    }

    console.log(`[logos] pnpm install: ${basename(packageDir)}…`)
    this.removeNodeModules(nodeModulesPath)
    execFileSync("pnpm", install.installArgs, {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, CI: "true", NODE_ENV: "" },
    })
    return { cacheKey: "", nodeModulesPath, hit: false }
  }

  private isPnpmInstallUsable(packageDir: string): boolean {
    const nodeModulesPath = join(packageDir, "node_modules")
    try {
      if (lstatSync(nodeModulesPath).isSymbolicLink()) return false
      if (!statSync(nodeModulesPath).isDirectory()) return false
    } catch {
      return false
    }

    const pkg = readPackageJson(packageDir)
    const depNames = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })
    if (depNames.length === 0) return true
    try {
      if (!statSync(join(nodeModulesPath, ".pnpm")).isDirectory()) return false
    } catch {
      return false
    }
    const binDir = join(nodeModulesPath, ".bin")
    for (const name of depNames) {
      try {
        const depPkg = JSON.parse(readFileSync(join(nodeModulesPath, name, "package.json"), "utf8")) as { name?: string; bin?: string | Record<string, string> }
        const bins = typeof depPkg.bin === "string"
          ? [basename(depPkg.name ?? name)]
          : Object.keys(depPkg.bin ?? {})
        if (bins.some((bin) => !existsSync(join(binDir, bin)))) return false
      } catch {
        return false
      }
    }
    return true
  }

  private removeNodeModules(nodeModulesPath: string): void {
    try {
      if (lstatSync(nodeModulesPath).isSymbolicLink()) {
        unlinkSync(nodeModulesPath)
        return
      }
    } catch {
      return
    }
    rmSync(nodeModulesPath, { recursive: true, force: true })
  }

  private pnpmInstallFor(packageDir: string): PnpmInstall | null {
    const directLockfile = join(packageDir, "pnpm-lock.yaml")
    if (existsSync(directLockfile)) {
      return {
        installArgs: ["install", "--frozen-lockfile"],
      }
    }

    let dir = resolve(packageDir)
    for (;;) {
      if (existsSync(join(dir, "pnpm-lock.yaml"))) {
        return { installArgs: ["install"] }
      }
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { packageManager?: string }
        if (pkg.packageManager?.startsWith("pnpm@")) {
          return { installArgs: ["install"] }
        }
      } catch { /* missing or malformed package.json */ }

      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  private touchEntry(entryDir: string): void {
    const now = new Date()
    try { utimesSync(entryDir, now, now) } catch { /* best effort */ }
  }

  private rebuildBinLinks(nodeModulesPath: string): void {
    const binDir = join(nodeModulesPath, ".bin")
    rmSync(binDir, { recursive: true, force: true })
    mkdirSync(binDir, { recursive: true })

    for (const pkgDir of this.packageDirs(nodeModulesPath)) {
      const packageJson = join(pkgDir, "package.json")
      let parsed: { name?: string; bin?: string | Record<string, string> }
      try {
        parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { name?: string; bin?: string | Record<string, string> }
      } catch {
        continue
      }

      const bins = typeof parsed.bin === "string"
        ? (parsed.name ? { [basename(parsed.name)]: parsed.bin } : {})
        : (parsed.bin ?? {})
      for (const [name, target] of Object.entries(bins)) {
        if (!name || !target) continue
        const linkPath = join(binDir, name)
        const packageRel = this.packageRelativePath(nodeModulesPath, pkgDir)
        const targetPath = join("..", packageRel, target)
        try { unlinkSync(linkPath) } catch {}
        try { symlinkSync(targetPath, linkPath) } catch {}
      }
    }
  }

  private packageDirs(nodeModulesPath: string): string[] {
    const dirs: string[] = []
    for (const entry of safeReaddir(nodeModulesPath)) {
      if (entry === ".bin") continue
      const full = join(nodeModulesPath, entry)
      if (entry.startsWith("@")) {
        for (const scopedEntry of safeReaddir(full)) {
          const scopedFull = join(full, scopedEntry)
          if (existsSync(join(scopedFull, "package.json"))) dirs.push(scopedFull)
        }
      } else if (existsSync(join(full, "package.json"))) {
        dirs.push(full)
      }
    }
    return dirs
  }

  private packageRelativePath(nodeModulesPath: string, pkgDir: string): string {
    return relative(nodeModulesPath, pkgDir)
  }

  private evict(): void {
    if (!existsSync(this.cacheDir)) return
    const entries: { name: string; mtime: number }[] = []
    for (const name of readdirSync(this.cacheDir)) {
      const full = join(this.cacheDir, name)
      try {
        const st = statSync(full)
        if (st.isDirectory()) entries.push({ name, mtime: st.mtimeMs })
      } catch { /* skip */ }
    }

    if (entries.length <= this.maxEntries) return

    entries.sort((a, b) => a.mtime - b.mtime)
    const toRemove = entries.slice(0, entries.length - this.maxEntries)
    for (const entry of toRemove) {
      const full = join(this.cacheDir, entry.name)
      console.log(`[logos] nm-cache evict: ${entry.name.slice(0, 12)}`)
      try { rmSync(full, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}

export function findPackageDirs(root: string): string[] {
  const dirs: string[] = []
  const visit = (dir: string) => {
    if (existsSync(join(dir, "package.json"))) dirs.push(dir)
    for (const entry of safeReaddir(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue
      const sub = join(dir, entry)
      try {
        if (statSync(sub).isDirectory()) visit(sub)
      } catch { /* skip */ }
    }
  }
  visit(root)
  return dirs
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function readPackageJson(packageDir: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  try {
    return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
  } catch {
    return {}
  }
}
