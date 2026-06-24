import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { PROJECT_SOURCE_EXCLUDES } from "./project.js"

export interface TsIndexCacheOptions {
  logosTsRoot: string
  tsx: string
  cacheDir?: string
  maxEntries?: number
  maxBuffer?: number
}

const DEFAULT_CACHE_DIR = join(homedir(), ".logos", "index-cache")
const DEFAULT_MAX_ENTRIES = 30
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024

export class TsIndexCache {
  private logosTsRoot: string
  private tsx: string
  private cacheDir: string
  private maxEntries: number
  private maxBuffer: number

  constructor(opts: TsIndexCacheOptions) {
    this.logosTsRoot = opts.logosTsRoot
    this.tsx = opts.tsx
    this.cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
  }

  buildIndex(root: string): unknown {
    const key = this.computeKey(root)
    if (key) {
      const cached = this.load(key)
      if (cached !== undefined) {
        console.log(`[logos] index-cache hit: ${key.slice(0, 12)}`)
        return cached
      }
    }

    const args = [resolve(this.logosTsRoot, "src/build-index.ts"), root, "-"]
    const t0 = Date.now()
    const result = JSON.parse(
      execFileSync(this.tsx, args, { cwd: this.logosTsRoot, encoding: "utf8", maxBuffer: this.maxBuffer })
    ) as unknown

    console.log(`[logos] index built in ${Date.now() - t0}ms`)

    if (key) {
      this.store(key, result)
      this.evict()
    }

    return result
  }

  private computeKey(root: string): string | null {
    try {
      const treeHash = execFileSync("git", ["-C", root, "rev-parse", "HEAD:"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      const configHash = createHash("sha1")
        .update(PROJECT_SOURCE_EXCLUDES.join("\0"))
        .digest("hex")
        .slice(0, 8)
      return `${treeHash}-${configHash}`
    } catch {
      return null
    }
  }

  private load(key: string): unknown | undefined {
    const file = join(this.cacheDir, key, "index.json")
    if (!existsSync(file)) return undefined
    try {
      this.touchEntry(join(this.cacheDir, key))
      return JSON.parse(readFileSync(file, "utf8")) as unknown
    } catch {
      return undefined
    }
  }

  private store(key: string, index: unknown): void {
    const dir = join(this.cacheDir, key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "index.json"), JSON.stringify(index))
    this.touchEntry(dir)
  }

  private touchEntry(entryDir: string): void {
    const now = new Date()
    try { utimesSync(entryDir, now, now) } catch { /* best effort */ }
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
      console.log(`[logos] index-cache evict: ${entry.name.slice(0, 12)}`)
      try { rmSync(join(this.cacheDir, entry.name), { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
}
