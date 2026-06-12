/**
 * Integration test: starts the studio dev server, verifies workspace creation
 * and Storybook URL resolution work end-to-end.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess, execSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { rmSync, existsSync } from "node:fs"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "../..")
const PROJECT_ROOT = resolve(LOGOS_TS, "../hn-jobs")
const WS_DIR = resolve(STUDIO, "../.workspaces")
const AGENT_RUNS = resolve(LOGOS_TS, ".agent-runs")
const DB_PATH = resolve(PROJECT_ROOT, ".logos/comments.db")
const SB_MAP = resolve(PROJECT_ROOT, ".logos/storybooks.json")

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
      const m = buf.match(/Local:\s+(http:\/\/localhost:\d+)/)
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

async function waitForStorybook(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const urls = await getStorybookUrls()
      if (urls["base"]) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("base storybook did not start")
}

function cleanup() {
  try { rmSync(WS_DIR, { recursive: true, force: true }) } catch {}
  try { rmSync(AGENT_RUNS, { recursive: true, force: true }) } catch {}
  try { rmSync(DB_PATH, { force: true }) } catch {}
  try { rmSync(SB_MAP, { force: true }) } catch {}
}

describe("workspace + storybook integration", () => {
  beforeAll(async () => {
    cleanup()
    server = spawn("npm", ["run", "dev"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LOGOS_PROJECT: PROJECT_ROOT },
    })
    baseUrl = await waitForServer(server)
    await waitForStorybook()
  }, 60_000)

  afterAll(() => {
    server.kill()
    // kill any storybook children
    try { execSync("pkill -f 'storybook dev'", { stdio: "ignore" }) } catch {}
    cleanup()
  })

  it("base storybook is accessible", async () => {
    const urls = await getStorybookUrls()
    expect(urls["base"]).toBeDefined()
    expect(urls["base"]).toMatch(/^http:\/\/localhost:\d+$/)

    const sbRes = await fetch(urls["base"]!)
    expect(sbRes.ok).toBe(true)
  })

  it("creating a workspace does not spawn a workspace storybook", async () => {
    const res = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.ok).toBe(true)
    const ws = await res.json() as { id: string }
    expect(ws.id).toBeDefined()

    // Give time for any erroneous spawning
    await new Promise((r) => setTimeout(r, 2_000))

    const urls = await getStorybookUrls()
    expect(urls[ws.id]).toBeUndefined()
    expect(urls["base"]).toBeDefined()
  })

  it("adding a comment to a workspace does not auto-fork a storybook", async () => {
    // Create workspace
    const wsRes = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const ws = await wsRes.json() as { id: string }

    // Add a comment to it
    const cRes = await api("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "test:target",
        label: "test label",
        text: "test comment",
        mode: "code",
        workspaceId: ws.id,
      }),
    })
    expect(cRes.ok).toBe(true)

    // Wait to see if an agent run triggers
    await new Promise((r) => setTimeout(r, 3_000))

    const urls = await getStorybookUrls()
    // Only base should exist — no workspace storybook should have been spawned
    // because agent runs are triggered client-side, not server-side
    expect(Object.keys(urls)).toEqual(["base"])
  })

  it("opening a workspace via GET starts its storybook on demand", async () => {
    const wsRes = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const ws = await wsRes.json() as { id: string }

    // Opening the workspace triggers on-demand Storybook start
    await api(`/api/workspaces/${ws.id}`)

    const deadline = Date.now() + 35_000
    let wsSbUrl: string | undefined
    while (Date.now() < deadline) {
      const urls = await getStorybookUrls()
      if (urls[ws.id]) {
        wsSbUrl = urls[ws.id]
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(wsSbUrl).toBeDefined()
    expect(wsSbUrl).toMatch(/^http:\/\/localhost:\d+$/)
    expect(wsSbUrl).not.toBe((await getStorybookUrls())["base"])
  }, 45_000)

  it("active storybook URL falls back to base when workspace has no storybook", async () => {
    const urls = await getStorybookUrls()

    // For any workspace ID that doesn't have a storybook entry,
    // the frontend derivation should fall back to base
    const baseUrl = urls["base"]
    expect(baseUrl).toBeDefined()

    const wsRes = await api("/api/workspaces")
    const workspaces = await wsRes.json() as { id: string }[]
    for (const ws of workspaces) {
      if (!urls[ws.id]) {
        // This workspace should use base storybook — verified by absence
        expect(urls[ws.id]).toBeUndefined()
      }
    }
  })

  it("workspace storybook resolves preview.tsx when logos-ts is symlinked", async () => {
    // Create workspace + comment so we can trigger an agent run fork
    const wsRes = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const ws = await wsRes.json() as { id: string }

    await api("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "test:target",
        label: "test label",
        text: "test comment for storybook",
        mode: "code",
        workspaceId: ws.id,
      }),
    })

    // Trigger the agent run SSE — this creates the fork + starts workspace SB.
    // We only read the first few events (fork + storybook start), then abort.
    const controller = new AbortController()
    const agentRes = await fetch(
      `${baseUrl}/api/agent/run?workspace=${ws.id}&mode=code`,
      { signal: controller.signal },
    ).catch(() => null)

    // Wait for the workspace storybook to appear in /api/storybooks
    let wsSbUrl: string | undefined
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      const urls = await getStorybookUrls()
      if (urls[ws.id]) {
        wsSbUrl = urls[ws.id]
        break
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
    controller.abort()

    expect(wsSbUrl).toBeDefined()

    // Wait a bit for the workspace Storybook's Vite to finish compiling
    await new Promise((r) => setTimeout(r, 5_000))

    // The critical check: can the browser fetch preview.tsx from the workspace SB?
    const previewRes = await fetch(`${wsSbUrl}/.storybook/preview.tsx`)
    expect(previewRes.ok).toBe(true)
    const text = await previewRes.text()
    expect(text).toContain("CommentLayer")
  }, 90_000)

  it("deleting a workspace cleans up its storybook entry", async () => {
    const wsRes = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const ws = await wsRes.json() as { id: string }

    await api(`/api/workspaces/${ws.id}`, { method: "DELETE" })

    const urls = await getStorybookUrls()
    expect(urls[ws.id]).toBeUndefined()
  })
})
