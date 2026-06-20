import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
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
const CACHE_FORMAT_VERSION = "bin-relinked-v2"

export class NodeModulesCache {
  private cacheDir: string
  private maxEntries: number

  constructor(opts?: NmCacheOptions) {
    this.cacheDir = opts?.cacheDir ?? DEFAULT_CACHE_DIR
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  ensureFor(packageDir: string): NmCacheResult {
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

    const lockfile = join(packageDir, "package-lock.json")
    const installCmd = existsSync(lockfile) ? "ci" : "install"
    execFileSync("npm", [installCmd], {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "" },
    })

    const sourceNm = join(packageDir, "node_modules")
    if (!existsSync(sourceNm)) mkdirSync(sourceNm, { recursive: true })
    // -RL dereferences package symlinks so file: dependencies survive in the
    // cache; npm-style .bin symlinks are rebuilt below because some CLIs load
    // assets relative to their real package path.
    execFileSync("cp", ["-RL", sourceNm, cachedNm])
    this.rebuildBinLinks(cachedNm)
    rmSync(sourceNm, { recursive: true, force: true })

    const lockSrc = existsSync(lockfile) ? lockfile : join(packageDir, "package.json")
    writeFileSync(join(entryDir, "source-lock.json"), readFileSync(lockSrc))

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
    this.linkTo(result.nodeModulesPath, target)
    return result
  }

  private computeKey(packageDir: string): string {
    const lockfile = join(packageDir, "package-lock.json")
    const packageJson = join(packageDir, "package.json")

    let content: string
    if (existsSync(lockfile)) {
      content = readFileSync(lockfile, "utf8")
    } else if (existsSync(packageJson)) {
      content = readFileSync(packageJson, "utf8")
    } else {
      return ""
    }

    return createHash("sha256")
      .update(CACHE_FORMAT_VERSION)
      .update("\0")
      .update(content)
      .digest("hex")
      .slice(0, 16)
  }

  private installInPlace(packageDir: string): void {
    if (!existsSync(join(packageDir, "package.json"))) return
    if (existsSync(join(packageDir, "node_modules"))) return
    console.log(`[logos] installing ${basename(packageDir)} (no lockfile, in-place)…`)
    execFileSync("npm", ["install"], { cwd: packageDir, stdio: "inherit" })
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
