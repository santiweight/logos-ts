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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Frame, type Page } from "playwright"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g
const COMPONENT_REL = "src/AdminDashboard.tsx"
const STORY_REL = "stories/admin-page.stories.tsx"

let server: ChildProcess
let browser: Browser
let baseUrl: string
let projectRoot: string | null = null
let sessionDir: string | null = null
let runtimeDir: string | null = null

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts)
}

function componentSource(label: string): string {
  return [
    "import React from 'react'",
    "",
    "export function AdminDashboard() {",
    "  return <table className=\"fact-table\"><tbody><tr><th>Status</th><td>" + label + "</td></tr></tbody></table>",
    "}",
    "",
  ].join("\n")
}

function storySource(): string {
  return [
    "import './styles.css'",
    "import { AdminDashboard } from '../src/AdminDashboard'",
    "",
    "export default { title: 'Admin Page', component: AdminDashboard }",
    "export const Default = {}",
    "",
  ].join("\n")
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-portable-project-"))
  mkdirSync(join(root, ".storybook"), { recursive: true })
  mkdirSync(join(root, "src"), { recursive: true })
  mkdirSync(join(root, "stories"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "portable-story-fixture",
    version: "1.0.0",
    private: true,
    devDependencies: {
      "@storybook/react": "^10.4.6",
      playwright: "^1.60.0",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      vite: "^7.2.7",
      vitest: "^4.1.8",
    },
  }))
  writeFileSync(join(root, "pnpm-workspace.yaml"), [
    "packages:",
    "  - .",
    "onlyBuiltDependencies:",
    "  - esbuild",
    "allowBuilds:",
    "  esbuild: true",
    "",
  ].join("\n"))
  writeFileSync(join(root, ".storybook", "main.ts"), "export default {}\n")
  writeFileSync(join(root, ".storybook", "preview.ts"), "export default {}\n")
  writeFileSync(join(root, COMPONENT_REL), componentSource("Visible postings"))
  writeFileSync(join(root, "stories", "styles.css"), ".fact-table { border-collapse: collapse; }\n")
  writeFileSync(join(root, STORY_REL), storySource())
  return root
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
    projectRoot = createProject()
    runtimeDir = mkdtempSync(resolve(tmpdir(), "logos-studio-runtime-"))
    server = spawn("pnpm", ["dev", "--", "--host", "127.0.0.1"], {
      cwd: resolve(STUDIO, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: projectRoot, LOGOS_RUNTIME_DIR: runtimeDir, LOGOS_STUDIO_RUNTIME_DIR: runtimeDir },
    })
    baseUrl = await waitForServer(server)
    const index = await api("/api/index")
    expect(index.ok).toBe(true)
    browser = await chromium.launch({ headless: true })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    if (sessionDir) {
      try { rmSync(sessionDir, { recursive: true, force: true }) } catch {}
    }
    if (runtimeDir) {
      try { rmSync(runtimeDir, { recursive: true, force: true }) } catch {}
    }
    if (projectRoot) {
      try { rmSync(projectRoot, { recursive: true, force: true }) } catch {}
    }
  }, 60_000)

  it("renders a project story with real CSS applied", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(`${baseUrl}/portable-story.html?storyId=admin-page--default&logosReload=test`, {
        waitUntil: "domcontentloaded",
      })
      await page.locator("[data-portable-story-rendered='admin-page--default'] table.fact-table").waitFor({ timeout: 30_000 })
      expect(await page.locator("table.fact-table").textContent()).toContain("Visible postings")
      expect(await page.locator("table.fact-table").evaluate((el) => getComputedStyle(el).borderCollapse)).toBe("collapse")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders a Studio story iframe through the portable renderer", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode").first().waitFor({ timeout: 45_000 })
      await page.locator(".sidebar-tree .anode", { hasText: "AdminDashboard" }).first().click()

      const frameEl = page.locator("iframe.story-frame")
      await frameEl.waitFor({ timeout: 20_000 })
      expect(await frameEl.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-same-origin")
      expect(await frameEl.getAttribute("src")).toContain("/portable-story.html?storyId=admin-page--default")

      const frame = await waitForPortableFrame(page, "admin-page--default")
      await expect.poll(async () => await frame.locator("table.fact-table").count(), { timeout: 30_000 }).toBe(1)
      expect(await frame.locator("table.fact-table").textContent()).toContain("Visible postings")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders workspace edits through the portable iframe after reindex", async () => {
    const ws = await createWorkspace()
    const componentFile = resolve(ws.forkDir, COMPONENT_REL)
    const original = readFileSync(componentFile, "utf8")
    writeFileSync(componentFile, original.replace("Visible postings", "Published postings"))

    const reindex = await api(`/api/workspaces/${ws.id}/reindex`, { method: "POST" })
    expect(reindex.ok).toBe(true)

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    try {
      await page.goto(
        `${baseUrl}/portable-story.html?storyId=admin-page--default&workspaceId=${encodeURIComponent(ws.id)}&logosReload=test`,
        { waitUntil: "domcontentloaded" }
      )
      await page.locator("[data-portable-story-rendered='admin-page--default'] table.fact-table").waitFor({ timeout: 30_000 })
      await expect.poll(async () => page.locator("table.fact-table").textContent(), { timeout: 20_000 })
        .toContain("Published postings")
    } finally {
      await page.close()
    }
  }, 180_000)
})
