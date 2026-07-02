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
import { chromium, type Browser, type Page } from "playwright"

const STUDIO = dirname(fileURLToPath(import.meta.url))

let server: ChildProcess
let browser: Browser
let baseUrl: string
let projectRoot: string
let agentRuns: string
let runPid: number | null = null
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-run-project-"))
  const fakeVite = join(root, "fake-vite")
  mkdirSync(fakeVite, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    type: "module",
    logosFixture: "run-comments-v2",
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
    "  const rawPath = req.url.slice(base.length).split('?')[0] || '/'",
    "  const appPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`",
    "  const html = `<!doctype html><title>fake run</title><main data-logos-component=\"RunSearchPanel\" data-app-path=\"${appPath}\"><h1>fake run app</h1><a href=\"/details\">Details</a><button type=\"button\">Search jobs</button><span data-plain-target>Plain target</span></main><script>fetch('/api/env').then((res)=>res.json()).then((data)=>{document.body.dataset.apiRunBase=data.LOGOS_RUN_BASE||''}).catch(()=>{document.body.dataset.apiRunBase='failed'})</script>`",
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

async function resetPageWorkspace(page: Page): Promise<string> {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
  await page.evaluate(() => window.localStorage.clear())
  const resetRes = await api("/api/reset", { method: "POST" })
  expect(resetRes.ok).toBe(true)
  const reset = await resetRes.json() as { workspace: { id: string } }
  await page.reload({ waitUntil: "domcontentloaded" })
  return reset.workspace.id
}

function cleanup() {
  if (agentRuns) {
    try { rmSync(agentRuns, { recursive: true, force: true }) } catch {}
  }
  if (projectRoot) {
    try { rmSync(projectRoot, { recursive: true, force: true }) } catch {}
  }
}

describe("workspace + run integration", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    agentRuns = mkdtempSync(join(tmpdir(), "logos-run-agent-runs-"))
    server = spawn("pnpm", ["dev"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: projectRoot, LOGOS_AGENT_RUNS_DIR: agentRuns },
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
  }, 60_000)

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
  }, 60_000)

  it("keeps the selected app run open across browser refresh", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      const wsId = await resetPageWorkspace(page)
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })

      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).click()
      await page.waitForFunction(async () => {
        const res = await fetch("/api/runs")
        const data = await res.json()
        return Object.keys(data.urls || {}).some((key) => key.endsWith(":root-app"))
      }, null, { timeout: 30_000 })
      expect(await page.evaluate(() => window.localStorage.getItem("logos:selection:v1")))
        .toContain("\"view\":\"run\"")

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(async (expectedKey) => {
        const res = await fetch("/api/runs")
        const data = await res.json()
        return data.urls?.[expectedKey] != null
      }, `${wsId}:root-app`, { timeout: 90_000 })
      await page.waitForFunction(
        (expectedSrc) => document
          .querySelector("iframe.story-frame[title='App']")
          ?.getAttribute("src") === expectedSrc,
        `/runs/${encodeURIComponent(wsId)}/root-app/`,
        { timeout: 90_000 },
      )
      expect(await page.locator("iframe.story-frame[title='App']").getAttribute("src"))
        .toBe(`/runs/${encodeURIComponent(wsId)}/root-app/`)
      const frame = await pollFor(async () =>
        page.frame({ url: (url) => url.toString().includes(`/runs/${encodeURIComponent(wsId)}/root-app/`) }),
      90_000)
      expect(frame).not.toBeNull()
      await frame!.waitForFunction(
        () => document.body.dataset["apiRunBase"] != null,
        null,
        { timeout: 30_000 },
      )
      expect(await frame!.evaluate(() => document.body.dataset["apiRunBase"]))
        .toBe(`/runs/${wsId}/root-app/`)
      expect(await page.evaluate(() => window.localStorage.getItem("logos:selection:v1")))
        .toContain("\"view\":\"run\"")
    } finally {
      await page.close()
    }
  }, 90_000)

  it("lets users leave component comments inside the running app iframe", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      const wsId = await resetPageWorkspace(page)
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).click()
      await page.waitForFunction(
        (expectedKey) => fetch("/api/runs")
          .then((res) => res.json())
          .then((data) => Boolean(data.urls?.[expectedKey])),
        `${wsId}:root-app`,
        { timeout: 30_000 },
      )
      await page.waitForFunction(
        (expectedSrc) => document
          .querySelector("iframe.story-frame[title='App']")
          ?.getAttribute("src") === expectedSrc,
        `/runs/${encodeURIComponent(wsId)}/root-app/`,
        { timeout: 45_000 },
      )

      const appFrame = page.frameLocator("iframe.story-frame[title='App']")
      await appFrame.locator("main[data-logos-component='RunSearchPanel']").waitFor({ timeout: 30_000 })
      await appFrame.locator("button", { hasText: "Search jobs" }).click({ modifiers: ["Alt"] })
      await page.getByPlaceholder("Reply…").fill("Make this search typo tolerant.")
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")

      const goal = await pollFor(async () => {
        const res = await api("/api/workspaces")
        expect(res.ok).toBe(true)
        const workspaces = await res.json() as Array<{ goals?: Array<Record<string, unknown>> }>
        return workspaces
          .flatMap((workspace) => workspace.goals ?? [])
          .find((candidate) => candidate["text"] === "Make this search typo tolerant.") ?? null
      }, 30_000)
      expect(goal).not.toBeNull()
      expect(goal).toMatchObject({
        target: "component:RunSearchPanel",
        component: "RunSearchPanel",
        appPath: "/",
        runTargetId: "root-app",
      })
      expect(String(goal!["storyId"])).toBe("run:root-app:/")
      expect(String(goal!["selector"])).toContain("button")
      await appFrame.locator("[data-logos-run-comment-pin]").waitFor({ timeout: 30_000 })
      expect(await appFrame.locator("[data-logos-run-comment-pin]").textContent()).toBe("1")
    } finally {
      await page.close()
    }
  }, 90_000)

  it("records comments against the current app path after in-app navigation", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      const wsId = await resetPageWorkspace(page)
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).click()
      await page.waitForFunction(
        (expectedKey) => fetch("/api/runs")
          .then((res) => res.json())
          .then((data) => Boolean(data.urls?.[expectedKey])),
        `${wsId}:root-app`,
        { timeout: 30_000 },
      )
      await page.waitForFunction(
        (expectedSrc) => document
          .querySelector("iframe.story-frame[title='App']")
          ?.getAttribute("src") === expectedSrc,
        `/runs/${encodeURIComponent(wsId)}/root-app/`,
        { timeout: 45_000 },
      )

      const appFrame = page.frameLocator("iframe.story-frame[title='App']")
      await appFrame.locator("main[data-app-path='/']").waitFor({ timeout: 30_000 })
      await appFrame.locator("a", { hasText: "Details" }).click()
      await appFrame.locator("main[data-app-path='/details']").waitFor({ timeout: 30_000 })
      await appFrame.locator("[data-plain-target]").click({ modifiers: ["Alt"] })
      await page.getByPlaceholder("Reply…").fill("Tighten the details copy.")
      await page.getByRole("button", { name: "Create Change" }).click()

      const goal = await pollFor(async () => {
        const res = await api("/api/workspaces")
        expect(res.ok).toBe(true)
        const workspaces = await res.json() as Array<{ goals?: Array<Record<string, unknown>> }>
        return workspaces
          .flatMap((workspace) => workspace.goals ?? [])
          .find((candidate) => candidate["text"] === "Tighten the details copy.") ?? null
      }, 30_000)
      expect(goal).not.toBeNull()
      expect(goal).toMatchObject({
        target: "component:RunSearchPanel",
        component: "RunSearchPanel",
        appPath: "/details",
        runTargetId: "root-app",
      })
      expect(String(goal!["storyId"])).toBe("run:root-app:/details")
      expect(String(goal!["selector"])).toContain("span")
      await appFrame.locator("[data-logos-run-comment-pin]").waitFor({ timeout: 30_000 })
      expect(await appFrame.locator("[data-logos-run-comment-pin]").textContent()).toBe("1")
    } finally {
      await page.close()
    }
  }, 90_000)

  it("deleting the workspace shuts its app run down", async () => {
    const resetRes = await api("/api/reset", { method: "POST" })
    expect(resetRes.ok).toBe(true)
    const reset = await resetRes.json() as { workspace: { id: string } }
    const wsId = reset.workspace.id
    const key = `${wsId}:root-app`

    const startRes = await api(`/api/workspaces/${wsId}/runs/root-app`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(startRes.ok).toBe(true)
    const runs = await pollFor(async () => {
      const data = await getRuns()
      return data.entries[key] ? data : null
    }, 30_000)
    expect(runs).not.toBeNull()
    runPid = runs!.entries[key]?.pid ?? runPid

    const res = await api(`/api/workspaces/${wsId}`, { method: "DELETE" })
    expect(res.ok).toBe(true)

    const gone = await pollFor(async () => {
      const data = await getRuns()
      return data.urls[key!] == null && !isLiveProcess(runPid) ? true : null
    }, 30_000)
    expect(gone).toBe(true)
  }, 45_000)
})
