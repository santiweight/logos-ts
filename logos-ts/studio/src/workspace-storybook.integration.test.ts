/**
 * Integration test: starts the studio dev server, verifies that workspace
 * creation spawns a per-workspace Storybook, that the retry endpoint works,
 * and that deletion cleans up.
 *
 * The server is spawned in its own process group; teardown kills the group,
 * which takes the vite server and every Storybook it spawned with it —
 * never anything outside this test run.
 */
/* eslint-disable functional/no-loop-statements, functional/no-let, functional/no-throw-statements, functional/immutable-data, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-condition */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { rmSync } from "node:fs"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "../..")
const PROJECT_ROOT = resolve(LOGOS_TS, "../hn-jobs")

let server: ChildProcess
let baseUrl: string
let sessionDir: string | null = null
const createdWorkspaces: string[] = []

function api(path: string, opts?: RequestInit) {
  return fetch(`${baseUrl}${path}`, opts)
}

async function createWorkspace(): Promise<string> {
  const res = await api("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(res.ok).toBe(true)
  const ws = await res.json() as { id: string }
  expect(ws.id).toBeDefined()
  createdWorkspaces.push(ws.id)
  return ws.id
}

async function getStorybooks(): Promise<{ urls: Record<string, string>; states: Record<string, { status: string; error?: string }> }> {
  const res = await api("/api/storybooks")
  return await res.json() as { urls: Record<string, string>; states: Record<string, { status: string; error?: string }> }
}

async function waitForStorybookUrl(wsId: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { urls, states } = await getStorybooks()
    if (urls[wsId]) return urls[wsId]
    if (states[wsId]?.status === "failed") {
      throw new Error(`storybook for ${wsId} failed: ${states[wsId].error}`)
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`storybook for ${wsId} did not become ready in ${timeoutMs}ms`)
}

async function waitForServer(proc: ChildProcess, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start")), timeoutMs)
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      const copied = buf.match(/\[logos\] copied .+ → (.+)/)
      if (copied) sessionDir = copied[1]!.trim()
      const m = buf.match(/Local:\s+(http:\/\/localhost:\d+)/)
      if (m) {
        clearTimeout(timeout)
        resolveUrl(m[1]!)
      }
    }
    proc.stdout?.on("data", onData)
    proc.stderr?.on("data", (d: Buffer) => { buf += d.toString() })
    proc.on("close", (code) => {
      clearTimeout(timeout)
      reject(new Error(`server exited with code ${code}\n${buf}`))
    })
  })
}

describe("workspace + storybook integration", () => {
  beforeAll(async () => {
    server = spawn("npm", ["run", "dev"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: PROJECT_ROOT },
    })
    baseUrl = await waitForServer(server)
  }, 90_000)

  afterAll(async () => {
    // Delete workspaces first so their Storybooks shut down gracefully.
    for (const id of createdWorkspaces) {
      try { await api(`/api/workspaces/${id}`, { method: "DELETE" }) } catch {}
    }
    // Kill the server's whole process group — only processes from this run.
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    await new Promise((r) => setTimeout(r, 1_000))
    if (sessionDir) {
      try { rmSync(sessionDir, { recursive: true, force: true }) } catch {}
    }
  }, 30_000)

  it("creating a workspace starts its own storybook", async () => {
    const wsId = await createWorkspace()
    const url = await waitForStorybookUrl(wsId)
    expect(url).toMatch(/^http:\/\/localhost:\d+$/)

    // Readiness means the server actually answers, not just that it spawned.
    const indexRes = await fetch(`${url}/index.json`)
    expect(indexRes.ok).toBe(true)

    const { states } = await getStorybooks()
    expect(states[wsId]?.status).toBe("ready")
  }, 120_000)

  it("workspace storybook resolves preview.tsx via the logos alias", async () => {
    const wsId = createdWorkspaces[0]!
    const url = (await getStorybooks()).urls[wsId]
    expect(url).toBeDefined()

    const previewRes = await fetch(`${url}/.storybook/preview.tsx`)
    expect(previewRes.ok).toBe(true)
    expect(await previewRes.text()).toContain("CommentLayer")
  }, 30_000)

  it("the storybook start endpoint is idempotent for a running storybook", async () => {
    const wsId = createdWorkspaces[0]!
    const before = (await getStorybooks()).urls[wsId]

    const res = await api(`/api/workspaces/${wsId}/storybook`, { method: "POST" })
    expect(res.ok).toBe(true)

    await new Promise((r) => setTimeout(r, 2_000))
    const after = (await getStorybooks()).urls[wsId]
    expect(after).toBe(before)
  }, 30_000)

  it("returns 404 for the storybook endpoint on an unknown workspace", async () => {
    const res = await api("/api/workspaces/ws-does-not-exist/storybook", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("deleting a workspace shuts down and forgets its storybook", async () => {
    const wsId = await createWorkspace()
    await waitForStorybookUrl(wsId)

    const del = await api(`/api/workspaces/${wsId}`, { method: "DELETE" })
    expect(del.ok).toBe(true)

    const { urls, states } = await getStorybooks()
    expect(urls[wsId]).toBeUndefined()
    expect(states[wsId]).toBeUndefined()
  }, 120_000)
})
