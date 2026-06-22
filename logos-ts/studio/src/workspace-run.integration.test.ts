/**
 * Integration test: boots Studio against a temp Vite-like app and verifies the
 * workspace → run lifecycle end-to-end. Runs are lazy: creating a workspace
 * should not spawn the app; selecting/playing it posts to the run endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, execSync, type ChildProcess } from "node:child_process"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { chromium, type Browser } from "playwright"

const STUDIO = dirname(fileURLToPath(import.meta.url))

let server: ChildProcess
let browser: Browser
let baseUrl: string
let projectRoot: string
let agentRuns: string
let runtimeDir: string
let runPid: number | null = null
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-run-project-"))
  const fakeVite = join(root, "fake-vite")
  mkdirSync(fakeVite, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: { dev: "vite" },
    dependencies: { vite: "file:./fake-vite" },
  }))
  writeFileSync(join(root, "index.html"), "<div id=\"root\"></div>\n")
  writeFileSync(join(fakeVite, "package.json"), JSON.stringify({
    name: "vite",
    version: "0.0.0-test",
    bin: { vite: "vite.js" },
  }))

  const script = join(fakeVite, "vite.js")
  writeFileSync(script, [
    "#!/usr/bin/env node",
    "const http = require('node:http')",
    "const zlib = require('node:zlib')",
    "const args = process.argv.slice(2)",
    "const valueAfter = (name, fallback) => {",
    "  const i = args.indexOf(name)",
    "  return i >= 0 && args[i + 1] ? args[i + 1] : fallback",
    "}",
    "const port = Number(valueAfter('--port', process.env.PORT || '0'))",
    "const base = valueAfter('--base', '/')",
    "const server = http.createServer((req, res) => {",
    "  if (req.url === `${base}env` || req.url === '/api/env') {",
    "    res.writeHead(200, { 'content-type': 'application/json' })",
    "    res.end(JSON.stringify({ LOGOS_PROJECT: process.env.LOGOS_PROJECT || null, LOGOS_RUN_BASE: process.env.LOGOS_RUN_BASE || null }))",
    "    return",
    "  }",
    "  if (!req.url.startsWith(base)) {",
    "    res.writeHead(404, { 'content-type': 'text/plain' })",
    "    res.end('outside base')",
    "    return",
    "  }",
    "  const html = `<!doctype html><title>fake run</title><main>fake run app</main><a id=\"root-thread-link\" href=\"/threads\">Threads</a><script>fetch('/api/env').then((res)=>res.json()).then((data)=>{document.body.dataset.apiRunBase=data.LOGOS_RUN_BASE||''}).catch(()=>{document.body.dataset.apiRunBase='failed'})</script>`",
    "  const acceptsGzip = req.headers['accept-encoding'] && req.headers['accept-encoding'].includes('gzip')",
    "  if (acceptsGzip && req.headers['accept-encoding'] !== 'identity') {",
    "    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })",
    "    res.end(zlib.gzipSync(html))",
    "    return",
    "  }",
    "  res.writeHead(200, { 'content-type': 'text/html' })",
    "  res.end(html)",
    "})",
    "server.listen(port, '127.0.0.1', () => {",
    "  const address = server.address()",
    "  console.log(`VITE v5.0.0 ready in 1 ms`)",
    "  console.log(`  Local:   http://127.0.0.1:${address.port}${base}`)",
    "})",
    "",
  ].join("\n"))
  chmodSync(script, 0o755)

  return root
}

function api(path: string, opts?: RequestInit) {
  return fetch(`${baseUrl}${path}`, opts)
}

async function waitForServer(proc: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start\n${buf}`)), timeoutMs)
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      const m = buf.replace(ANSI_RE, "").match(/Local:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/)
      if (m?.[1] != null) {
        clearTimeout(timeout)
        resolveUrl(m[1])
      }
    }
    proc.stdout?.on("data", onData)
    proc.stderr?.on("data", onData)
    proc.on("close", (code) => {
      clearTimeout(timeout)
      reject(new Error(`server exited with code ${code}\n${buf}`))
    })
  })
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

async function getRuns(): Promise<{
  urls: Record<string, string>
  entries: Record<string, { pid?: number }>
  states: Record<string, { status: string }>
}> {
  const res = await api("/api/runs")
  expect(res.ok).toBe(true)
  return await res.json() as {
    urls: Record<string, string>
    entries: Record<string, { pid?: number }>
    states: Record<string, { status: string }>
  }
}

function isLiveProcess(pid: number | null): boolean {
  if (pid == null) return false
  try {
    const stat = execSync(`ps -o stat= -p ${pid}`, { encoding: "utf8" }).trim()
    return stat !== "" && !stat.startsWith("Z")
  } catch {
    return false
  }
}

function cleanup() {
  if (agentRuns) {
    try { rmSync(agentRuns, { recursive: true, force: true }) } catch {}
  }
  if (runtimeDir) {
    try { rmSync(runtimeDir, { recursive: true, force: true }) } catch {}
  }
  if (projectRoot) {
    try { rmSync(projectRoot, { recursive: true, force: true }) } catch {}
  }
}

describe("workspace + run integration", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    runtimeDir = mkdtempSync(join(tmpdir(), "logos-run-runtime-"))
    agentRuns = mkdtempSync(join(tmpdir(), "logos-run-agent-runs-"))
    server = spawn("pnpm", ["run", "dev"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: projectRoot, LOGOS_RUNTIME_DIR: runtimeDir, LOGOS_AGENT_RUNS_DIR: agentRuns },
    })
    baseUrl = await waitForServer(server, 60_000)
    browser = await chromium.launch({ headless: true })
  }, 90_000)

  afterAll(async () => {
    await browser?.close()
    if (server.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    server.kill()
    cleanup()
  })

  it("lazy-starts a workspace run on request and proxies the app", async () => {
    const targetsRes = await api("/api/run-targets")
    expect(targetsRes.ok).toBe(true)
    const targets = await targetsRes.json() as { targets: { id: string; label: string }[] }
    expect(targets.targets).toContainEqual(expect.objectContaining({ id: "root-app", label: "App" }))

    const wsRes = await api("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(wsRes.ok).toBe(true)
    const ws = await wsRes.json() as { id: string }

    const beforeStart = await getRuns()
    expect(beforeStart.urls[`${ws.id}:root-app`]).toBeUndefined()
    expect(beforeStart.states[`${ws.id}:root-app`]).toBeUndefined()

    const startRes = await api(`/api/workspaces/${ws.id}/runs/root-app`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(startRes.ok).toBe(true)
    expect(await startRes.json()).toMatchObject({
      ok: true,
      state: {
        id: `${ws.id}:root-app`,
        workspaceId: ws.id,
        targetId: "root-app",
        status: "starting",
      },
    })

    const runs = await pollFor(async () => {
      const data = await getRuns()
      return data.urls[`${ws.id}:root-app`] ? data : null
    }, 30_000)
    expect(runs).not.toBeNull()
    expect(runs!.states[`${ws.id}:root-app`]).toMatchObject({ status: "ready" })
    runPid = runs!.entries[`${ws.id}:root-app`]?.pid ?? null
    expect(runPid).not.toBeNull()

    const appRes = await fetch(`${baseUrl}${runs!.urls[`${ws.id}:root-app`]}`)
    expect(appRes.ok).toBe(true)
    expect(await appRes.text()).toContain("fake run app")

    const envRes = await fetch(`${baseUrl}${runs!.urls[`${ws.id}:root-app`]}env`)
    expect(envRes.ok).toBe(true)
    expect(await envRes.json()).toEqual({
      LOGOS_PROJECT: null,
      LOGOS_RUN_BASE: `/runs/${ws.id}/root-app/`,
    })

    const deleteRes = await api(`/api/workspaces/${ws.id}`, { method: "DELETE" })
    expect(deleteRes.ok).toBe(true)
    const stopped = await pollFor(async () => {
      const data = await getRuns()
      return data.urls[`${ws.id}:root-app`] == null && !isLiveProcess(runPid) ? true : null
    }, 30_000)
    expect(stopped).toBe(true)
    runPid = null
  }, 60_000)

  it("keeps the selected app run open across browser refresh", async () => {
    const resetRes = await api("/api/reset", { method: "POST" })
    expect(resetRes.ok).toBe(true)
    const reset = await resetRes.json() as { workspace: { id: string } }
    const wsId = reset.workspace.id

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.evaluate(() => window.localStorage.clear())
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })
      await page.waitForFunction(async () => {
        const res = await fetch("/api/runs")
        const data = await res.json()
        return Object.keys(data.urls || {}).some((key) => key.endsWith(":root-app"))
      }, null, { timeout: 30_000 })
      expect(await page.evaluate(() => window.localStorage.getItem("logos:selection:v1")))
        .toContain("\"view\":\"run\"")

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(
        (expectedSrc) => document
          .querySelector("iframe.story-frame[title='App']")
          ?.getAttribute("src") === expectedSrc,
        `/runs/${encodeURIComponent(wsId)}/root-app/`,
        { timeout: 45_000 },
      )
      expect(await page.locator("iframe.story-frame[title='App']").getAttribute("src"))
        .toBe(`/runs/${encodeURIComponent(wsId)}/root-app/`)
      const frame = page.frame({ url: (url) => url.toString().includes(`/runs/${wsId}/root-app/`) })
      expect(frame).not.toBeNull()
      await frame!.waitForFunction(
        () => document.body.dataset["apiRunBase"] != null,
        null,
        { timeout: 30_000 },
      )
      expect(await frame!.evaluate(() => document.body.dataset["apiRunBase"]))
        .toBe(`/runs/${wsId}/root-app/`)
      await frame!.locator("#root-thread-link").click()
      await page.waitForFunction(
        (expectedPath) => document
          .querySelector<HTMLIFrameElement>("iframe.story-frame[title='App']")
          ?.contentWindow?.location.pathname === expectedPath,
        `/runs/${encodeURIComponent(wsId)}/root-app/threads`,
        { timeout: 30_000 },
      )
      const threadedFrame = page.frame({
        url: (url) => url.pathname === `/runs/${encodeURIComponent(wsId)}/root-app/threads`,
      })
      expect(threadedFrame).not.toBeNull()
      expect(await threadedFrame!.locator("main").textContent()).toContain("fake run app")
      expect(await page.evaluate(() => window.localStorage.getItem("logos:selection:v1")))
        .toContain("\"view\":\"run\"")
    } finally {
      await page.close()
    }
  }, 90_000)

  it("deleting the workspace shuts its app run down", async () => {
    const runs = await getRuns()
    const key = Object.keys(runs.entries).find((entryKey) => entryKey.endsWith(":root-app"))
    expect(key).toBeDefined()
    const wsId = key!.slice(0, key!.indexOf(":"))
    runPid = runs.entries[key!]?.pid ?? runPid

    const res = await api(`/api/workspaces/${wsId}`, { method: "DELETE" })
    expect(res.ok).toBe(true)

    const gone = await pollFor(async () => {
      const data = await getRuns()
      return data.urls[key!] == null && !isLiveProcess(runPid) ? true : null
    }, 30_000)
    expect(gone).toBe(true)
  }, 45_000)
})
