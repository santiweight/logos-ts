// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Page } from "playwright"
import type { FileEntry, StudioIndex, TestState, Workspace, WorkspaceMeta } from "./types"

const STUDIO_SRC = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(STUDIO_SRC, "..")
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

let projectRoot: string
let server: ChildProcess
let baseUrl: string
let browser: Browser

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-review-ui-project-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(root, "src", "index.ts"), "export const fixture = true\n")
  return root
}

async function waitForServer(proc: ChildProcess, timeoutMs = 90_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let buf = ""
    const timeout = setTimeout(() => reject(new Error(`server did not start\n${buf}`)), timeoutMs)
    const onData = (d: Buffer) => {
      buf += d.toString()
      const m = buf.replace(ANSI_RE, "").match(/Local:\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+)/)
      if (m?.[1]) {
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

function vitestSnapshot(html: string): string {
  return [
    "// Vitest Snapshot v1",
    "",
    `exports[\`captured: JobRow/Default 1\`] = \`"${html}"\`;`,
  ].join("\n")
}

function indexWithCapture(snapshot: string | null): StudioIndex {
  const file: FileEntry = {
    file: "frontend/src/JobRow.tsx",
    code: "export function JobRow() { return null }\n",
    items: [],
    component: {
      name: "JobRow",
      signature: "JobRow()",
      componentCode: "export function JobRow() { return null }\n",
      propsFields: [],
      stories: [{ id: "jobrow--default", exportName: "Default", snapshot }],
    },
  }
  return { root: "/mock/project", files: [file] }
}

function createWorkspace(base: StudioIndex, active: StudioIndex): Workspace {
  return {
    id: "ws-review",
    name: "Review fixture",
    kind: "code",
    parentId: null,
    createdAt: 1,
    baseInstanceId: "inst-base",
    activeInstanceId: "inst-active",
    goals: [],
    forkDir: "/mock/workspace",
    index: active,
    instances: {
      "inst-base": {
        id: "inst-base",
        workspaceId: "ws-review",
        materializedRoot: "/mock/workspace/base",
        mutability: "immutable",
        createdAt: 1,
        index: base,
      },
      "inst-active": {
        id: "inst-active",
        workspaceId: "ws-review",
        materializedRoot: "/mock/workspace/active",
        mutability: "writable",
        createdAt: 2,
        index: active,
      },
    },
  }
}

function workspaceMeta(workspace: Workspace): WorkspaceMeta {
  return {
    id: workspace.id,
    name: workspace.name,
    kind: workspace.kind,
    parentId: workspace.parentId,
    createdAt: workspace.createdAt,
    baseInstanceId: workspace.baseInstanceId,
    activeInstanceId: workspace.activeInstanceId,
    goals: workspace.goals,
  }
}

function idleTests(): TestState {
  return { status: "idle", results: null, runningSince: null }
}

async function seedCodeSelection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("logos:selection:v1", JSON.stringify({
      file: "frontend/src/JobRow.tsx",
      component: "JobRow",
      view: "code",
    }))
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("timed out waiting for condition")
}

describe("review UI", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    server = spawn("pnpm", ["dev", "--", "--host", "127.0.0.1", "--port", "0"], {
      cwd: STUDIO,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, LOGOS_PROJECT: projectRoot },
    })
    baseUrl = await waitForServer(server)
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    server?.kill()
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true })
  }, 60_000)

  it("shows captured snapshot diffs against the workspace base instance", async () => {
    const projectIndex = indexWithCapture(vitestSnapshot('<article class="job-row">Original index</article>'))
    const baseIndex = indexWithCapture(vitestSnapshot('<article class="job-row"><span>Senior Engineer</span></article>'))
    const activeIndex = indexWithCapture(vitestSnapshot('<article class="job-row"><strong>Senior Engineer</strong></article>'))
    const workspace = createWorkspace(baseIndex, activeIndex)
    const page = await browser.newPage()
    await seedCodeSelection(page)

    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (body: unknown) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      })

      if (path === "/api/index") return json(projectIndex)
      if (path === "/api/test-results") return json(idleTests())
      if (path === "/api/storybooks") return json({ urls: {}, states: {} })
      if (path === "/api/run-targets") return json({ targets: [] })
      if (path === "/api/runs") return json({ urls: {}, states: {} })
      if (path === "/api/demos") return json({ active: "", demos: [] })
      if (path === "/api/workspaces") return json([workspaceMeta(workspace)])
      if (path === "/api/workspaces/ws-review") return json(workspace)

      return json({})
    })

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => document.body.innerText.includes("Changes 1"))
      await page.getByRole("button", { name: "Changes 1" }).click()
      await page.waitForFunction(() => document.body.innerText.includes("JobRow / Default"))

      let bodyText = await page.locator("body").innerText()
      expect(bodyText).toContain("JobRow / Default")
      expect(bodyText).not.toContain("No snapshots changed in this workspace.")

      await page.getByRole("button", { name: "Snapshot diff" }).click()
      await page.waitForFunction(() => document.body.innerText.includes("<strong>Senior Engineer</strong>"))

      bodyText = await page.locator("body").innerText()
      expect(bodyText).toContain('<span>Senior Engineer</span>')
      expect(bodyText).toContain('<strong>Senior Engineer</strong>')
      expect(bodyText).not.toContain("Original index")
    } finally {
      await page.close()
    }
  }, 60_000)

  it("renders before and after snapshot visuals from stored HTML without starting Storybook", async () => {
    const projectIndex = indexWithCapture(vitestSnapshot('<article class="job-row">Original index</article>'))
    const baseIndex = indexWithCapture(vitestSnapshot('<article class="job-row"><span>Senior Engineer</span></article>'))
    const activeIndex = indexWithCapture(vitestSnapshot('<article class="job-row"><strong>Senior Engineer</strong></article>'))
    const workspace = createWorkspace(baseIndex, activeIndex)
    const page = await browser.newPage()
    await seedCodeSelection(page)
    let storybookStarts = 0

    await page.route("**/api/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const json = (body: unknown) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      })

      if (path === "/api/index") return json(projectIndex)
      if (path === "/api/test-results") return json(idleTests())
      if (path === "/api/run-targets") return json({ targets: [] })
      if (path === "/api/runs") return json({ urls: {}, states: {} })
      if (path === "/api/demos") return json({ active: "", demos: [] })
      if (path === "/api/storybooks") {
        return json({
          urls: {},
          states: {
            "ws-review": { status: "starting", startedAt: Date.now(), logs: [] },
          },
        })
      }
      if (path === "/api/workspaces") return json([workspaceMeta(workspace)])
      if (path === "/api/workspaces/ws-review/storybook" && request.method() === "POST") {
        storybookStarts += 1
        return json({ ok: true })
      }
      if (path === "/api/workspaces/ws-review") return json(workspace)

      return json({})
    })

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => document.body.innerText.includes("Changes 1"))
      await page.getByRole("button", { name: "Changes 1" }).click()
      await page.waitForSelector("iframe.capture-preview-frame")

      const frames = await page.locator("iframe.capture-preview-frame").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("srcdoc") ?? "")
      )
      expect(frames).toHaveLength(2)
      expect(frames[0]).toContain("<span>Senior Engineer</span>")
      expect(frames[0]).not.toContain("<strong>Senior Engineer</strong>")
      expect(frames[1]).toContain("<strong>Senior Engineer</strong>")
      expect(storybookStarts).toBe(0)
    } finally {
      await page.close()
    }
  }, 60_000)
})
