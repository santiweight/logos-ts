import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { resolve, dirname } from "node:path"

export interface SbEntry {
  id: string
  pid: number
  port: number
  url: string
  cwd: string
  startedAt: number
}

type Registry = Record<string, SbEntry>

export class StorybookManager {
  private registry: Registry = {}
  private live = new Map<string, ChildProcess>()
  private mapFile: string
  private logosSrc: string
  private projectRoot: string

  constructor(mapFile: string, logosSrc: string, projectRoot: string) {
    this.mapFile = mapFile
    this.logosSrc = logosSrc
    this.projectRoot = projectRoot
    mkdirSync(dirname(mapFile), { recursive: true })
    try {
      this.registry = JSON.parse(readFileSync(mapFile, "utf8"))
    } catch {
      this.registry = {}
    }
  }

  private save(): void {
    writeFileSync(this.mapFile, JSON.stringify(this.registry, null, 2))
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** On startup, reconnect to still-alive processes and purge dead ones. */
  cleanupAll(): void {
    for (const [id, entry] of Object.entries(this.registry)) {
      if (this.isAlive(entry.pid)) {
        console.log(`[storybook-mgr] reconnected ${id} on port ${entry.port} (pid ${entry.pid})`)
      } else {
        console.log(`[storybook-mgr] purging stale ${id} (pid ${entry.pid} dead)`)
        delete this.registry[id]
      }
    }
    this.save()
  }

  /** Get the URL for a workspace, or null if not running. */
  get(id: string): string | null {
    const entry = this.registry[id]
    if (!entry) return null
    if (!this.isAlive(entry.pid)) {
      delete this.registry[id]
      this.live.delete(id)
      this.save()
      return null
    }
    return entry.url
  }

  /** Get all entries (for the API). */
  all(): Record<string, SbEntry> {
    return { ...this.registry }
  }

  /**
   * Ensure a Storybook is running for the given workspace.
   * Returns a promise that resolves with the URL once the port is detected.
   * If already running, resolves immediately.
   */
  ensure(id: string, frontendDir: string): Promise<string> {
    const existing = this.get(id)
    if (existing) return Promise.resolve(existing)

    return new Promise((resolve_, reject) => {
      const npx = resolve(frontendDir, "node_modules/.bin/storybook")
      const child = spawn(npx, ["dev", "--ci", "--no-open"], {
        cwd: frontendDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LOGOS_TS_SRC: this.logosSrc, LOGOS_PROJECT_ROOT: this.projectRoot },
      })

      if (!child.pid) {
        reject(new Error(`failed to spawn storybook for ${id}`))
        return
      }

      this.live.set(id, child)
      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          reject(new Error(`storybook for ${id} did not print a port within 30s`))
        }
      }, 30_000)

      child.stdout?.on("data", (d: Buffer) => {
        const s = d.toString()
        const m = s.match(/https?:\/\/localhost:(\d+)/)
        if (m && !resolved) {
          resolved = true
          clearTimeout(timeout)
          const port = parseInt(m[1], 10)
          const url = `http://localhost:${port}`
          const entry: SbEntry = {
            id,
            pid: child.pid!,
            port,
            url,
            cwd: frontendDir,
            startedAt: Date.now(),
          }
          this.registry[id] = entry
          this.save()
          console.log(`[storybook-mgr] ${id} ready on ${url} (pid ${child.pid})`)
          resolve_(url)
        }
      })
      child.stderr?.on("data", () => {})
      child.on("error", (e) => {
        console.error(`[storybook-mgr] ${id} error:`, e.message)
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(e)
        }
      })
      child.on("close", (code) => {
        console.log(`[storybook-mgr] ${id} exited (code ${code})`)
        delete this.registry[id]
        this.live.delete(id)
        this.save()
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(`storybook for ${id} exited with code ${code}`))
        }
      })
    })
  }

  /** Kill a specific workspace's Storybook. */
  shutdown(id: string): void {
    const entry = this.registry[id]
    if (entry) {
      try { process.kill(entry.pid, "SIGTERM") } catch {}
      delete this.registry[id]
      this.save()
    }
    const child = this.live.get(id)
    if (child) {
      try { child.kill() } catch {}
      this.live.delete(id)
    }
  }

  /** Kill all tracked Storybook processes. */
  shutdownAll(): void {
    for (const id of Object.keys(this.registry)) {
      this.shutdown(id)
    }
  }
}
