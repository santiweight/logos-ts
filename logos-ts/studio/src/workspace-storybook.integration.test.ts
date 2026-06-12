/**
 * Integration test: boots the studio dev server against hn-jobs and verifies
 * the workspace → Storybook lifecycle end-to-end: creating a workspace
 * auto-starts a tagged Storybook, its URL serves, and deleting the
 * workspace reaps the process.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, execSync, type ChildProcess } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { rmSync } from "node:fs"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "../..")
const PROJECT_ROOT = resolve(LOGOS_TS, "../hn-jobs")
const WS_DIR = resolve(STUDIO, "../.workspaces")
const AGENT_RUNS = resolve(LOGOS_TS, ".agent-runs")

let server: ChildProcess
let baseUrl: string

function api(path: string, opts?: RequestInit) {
  return fetch(`${baseUrl}${path}`, opts)
}

async function waitForServer(proc: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start")), timeoutMs)
    let buf = ""
    proc.stdout?.on("data", (d: Buffer) => {
      buf += d.toString()
      // The studio binds host 127.0.0.1 explicitly, so vite prints that, not "localhost".
      const m = buf.match(/Local:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/)
      if (m?.[1] != null) {
        clearTimeout(timeout)
        resolve(m[1])
      }
    })
    proc.stderr?.on("data", (d: Buffer) => {
      buf += d.toString()
    })
    proc.on("close", (code) => {
      clearTimeout(timeout)
      reject(new Error(`server exited with code ${code}\n${buf}`))
    })
  })
}

async function getStorybookUrls(): Promise<Record<string, string>> {
  const res = await api("/api/storybooks")
  const data = await res.json() as { urls: Record<string, string> }
  return data.urls
}

async function pollFor<T>(fn: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v !== null) return v
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

/** Pid of the storybook process spawned for a workspace fork, if running. */
function storybookPid(wsId: string): number | null {
  try {
    const out = execSync(`pgrep -f "${AGENT_RUNS}/${wsId}/"`, { encoding: "utf8" }).trim()
    const pid = parseInt(out.split("\n")[0] ?? "", 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function cleanup() {
  try { rmSync(WS_DIR, { recursive: true, force: true }) } catch {}
  try { rmSync(AGENT_RUNS, { recursive: true, force: true }) } catch {}
}

describe("workspace + storybook integration", () => {
  beforeAll(async () => {
    cleanup()
    // detached → own process group, so teardown can kill the whole tree
    // (npm → vite → storybooks) without touching unrelated dev servers.
    server = spawn("npm", ["run", "dev"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: PROJECT_ROOT },
    })
    baseUrl = await waitForServer(server)
  }, 60_000)

  afterAll(() => {
    if (server.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    server.kill()
    cleanup()
  })

  let wsId: string

  it("creating a workspace auto-starts its storybook", async () => {
    const res = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.ok).toBe(true)
    const ws = await res.json() as { id: string }
    expect(ws.id).toBeDefined()
    wsId = ws.id

    const url = await pollFor(async () => (await getStorybookUrls())[wsId] ?? null, 90_000)
    expect(url).not.toBeNull()
    expect(url).toBe(`/storybooks/${wsId}`)

    const sbRes = await api(url!)
    expect(sbRes.ok).toBe(true)
  }, 120_000)

  it("the spawned storybook carries ownership tags", () => {
    const pid = storybookPid(wsId)
    expect(pid).not.toBeNull()
    const env = execSync(`ps eww -p ${pid!}`, { encoding: "utf8" })
    expect(env).toContain(`LOGOS_WS=${wsId}`)
    expect(env).toContain("LOGOS_SESSION=session-")
  })

  it("deleting the workspace shuts its storybook down", async () => {
    const res = await api(`/api/workspaces/${wsId}`, { method: "DELETE" })
    expect(res.ok).toBe(true)

    const gone = await pollFor(async () => {
      const urls = await getStorybookUrls()
      return urls[wsId] == null && storybookPid(wsId) === null ? true : null
    }, 30_000)
    expect(gone).toBe(true)
  }, 45_000)
})
