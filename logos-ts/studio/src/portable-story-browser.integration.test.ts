/**
 * Browser-level integration coverage for the portable story renderer.
 *
 * These tests intentionally run the real Studio dev server and inspect the
 * actual iframe in Chromium. Unit tests can prove URL construction and module
 * resolution, but they will not catch Vite iframe import failures, missing CSS,
 * sandbox mistakes, or stale workspace renders.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Frame, type Page } from "playwright"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "../..")
const PROJECT_ROOT = resolve(LOGOS_TS, "demos/hn-jobs")
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

let server: ChildProcess
let browser: Browser
let baseUrl: string
let sessionDir: string | null = null

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts)
}

async function waitForServer(proc: ChildProcess, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start")), timeoutMs)
    let buf = ""
    proc.stdout?.on("data", (d: Buffer) => {
      buf += d.toString()
      const clean = buf.replace(ANSI_RE, "")
      const copied = clean.match(/\[logos\] copied .+ → (.+)/)
      if (copied?.[1]) sessionDir = copied[1].trim()
      const m = clean.match(/Local:\s+(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/)
      if (m?.[1] != null) {
        clearTimeout(timeout)
        resolveUrl(m[1])
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

async function createWorkspace(): Promise<{ id: string; forkDir: string }> {
  const create = await api("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(create.ok).toBe(true)
  const meta = await create.json() as { id: string }
  const read = await api(`/api/workspaces/${meta.id}`)
  expect(read.ok).toBe(true)
  return await read.json() as { id: string; forkDir: string }
}

async function waitForPortableFrame(page: Page, storyId: string, timeoutMs = 30_000): Promise<Frame> {
  await expect.poll(
    async () => {
      const frame = page.frames().find((f) => f.url().includes("/portable-story.html"))
      if (!frame) return 0
      return await frame.locator(`[data-portable-story-rendered='${storyId}']`).count()
    },
    { timeout: timeoutMs }
  ).toBe(1)
  const frame = page.frames().find((f) => f.url().includes("/portable-story.html"))
  if (!frame) throw new Error("portable story frame disappeared")
  return frame
}

describe("portable story browser integration", () => {
  beforeAll(async () => {
    server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: PROJECT_ROOT },
    })
    baseUrl = await waitForServer(server)
    browser = await chromium.launch({ headless: true })
  }, 90_000)

  afterAll(async () => {
    await browser?.close()
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    if (sessionDir) {
      try { rmSync(sessionDir, { recursive: true, force: true }) } catch {}
    }
  }, 30_000)

  it("renders DirectoryView with real CSS applied", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(`${baseUrl}/portable-story.html?storyId=views-directoryview--default&logosReload=test`, {
        waitUntil: "domcontentloaded",
      })
      await page.locator("[data-portable-story-rendered='views-directoryview--default'] table.data").waitFor({ timeout: 30_000 })
      expect(await page.locator("table.data").textContent()).toContain("Acme")
      expect(await page.locator(".layout").evaluate((el) => getComputedStyle(el).display)).toBe("grid")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders a Studio story iframe through the portable renderer", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode").first().waitFor({ timeout: 45_000 })
      await page.locator(".sidebar-tree .anode", { hasText: "JobTable" }).first().click()
      await page.locator("button.tab", { hasText: "Story" }).click()

      const frameEl = page.locator("iframe.story-frame")
      await frameEl.waitFor({ timeout: 20_000 })
      expect(await frameEl.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin")
      expect(await frameEl.getAttribute("src")).toContain("/portable-story.html?storyId=components-jobtable--default")

      const frame = await waitForPortableFrame(page, "components-jobtable--default")
      await expect.poll(async () => await frame.locator("table.data").count(), { timeout: 30_000 }).toBe(1)
      expect(await frame.locator("table.data").textContent()).toContain("Acme")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders workspace edits through the portable iframe after reindex", async () => {
    const ws = await createWorkspace()
    const componentFile = resolve(ws.forkDir, "frontend/components/JobRow.tsx")
    const original = readFileSync(componentFile, "utf8")
    writeFileSync(
      componentFile,
      original.replace("{role}</div>)", "<strong>{role}</strong></div>)")
    )

    const reindex = await api(`/api/workspaces/${ws.id}/reindex`, { method: "POST" })
    expect(reindex.ok).toBe(true)

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(
        `${baseUrl}/portable-story.html?storyId=components-jobtable--default&workspaceId=${encodeURIComponent(ws.id)}&logosReload=test`,
        { waitUntil: "domcontentloaded" }
      )
      await page.locator("[data-portable-story-rendered='components-jobtable--default'] table.data").waitFor({ timeout: 30_000 })
      await expect.poll(async () => page.locator("tbody td").nth(1).innerHTML(), { timeout: 20_000 })
        .toContain("<strong>Senior Engineer</strong>")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders captured output through the portable iframe", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode").first().waitFor({ timeout: 45_000 })
      await page.locator(".sidebar-tree .anode", { hasText: "FactTable" }).first().click()
      await page.locator("button.tab", { hasText: "Captured" }).click()

      const frameEl = page.locator("iframe.story-frame")
      await frameEl.waitFor({ timeout: 20_000 })
      expect(await frameEl.getAttribute("src")).toContain("/portable-story.html?storyId=components-facttable--complete")

      const frame = page.frameLocator("iframe.story-frame")
      await frame.locator("table.fact-table").waitFor({ timeout: 30_000 })
      expect(await frame.locator("table.fact-table").textContent()).toContain("Acme")
      expect(await frame.locator("table.fact-table").evaluate((el) => getComputedStyle(el).borderCollapse)).toBe("collapse")
    } finally {
      await page.close()
    }
  }, 60_000)
})
