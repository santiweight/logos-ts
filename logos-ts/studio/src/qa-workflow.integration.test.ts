// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser, type Page, type Route } from "playwright"
import type { FileEntry, Goal, RunState, RunTarget, SbState, StudioIndex, TestState, Workspace, WorkspaceKind, WorkspaceMeta } from "./types"

const STUDIO_SRC = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(STUDIO_SRC, "..")
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

let projectRoot: string
let server: ChildProcess
let baseUrl: string
let browser: Browser

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-qa-ui-project-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(root, "src", "index.ts"), "export const qaFixture = true\n")
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
    `exports[\`captured: JobCard/Default 1\`] = \`"${html}"\`;`,
  ].join("\n")
}

function indexFixture(variant: "project" | "base" | "active"): StudioIndex {
  const active = variant === "active"
  const label = active ? "Senior Platform Engineer" : "Platform Engineer"
  const salary = active ? "$180k-$220k" : "$150k-$190k"
  const componentCode = [
    "export function JobCard(props: JobCardProps) {",
    `  return <article className="job-card"><strong>${label}</strong><span>{props.company}</span></article>`,
    "}",
  ].join("\n")
  const file: FileEntry = {
    file: "src/components/JobCard.tsx",
    code: [
      "type JobCardProps = { company: string; salary: string }",
      componentCode,
      "export function formatSalary(value: string) { return value.trim() }",
    ].join("\n"),
    items: [
      {
        kind: "type",
        name: "JobCardProps",
        signature: "type JobCardProps = { company: string; salary: string }",
        code: "type JobCardProps = { company: string; salary: string }",
      },
      {
        kind: "function",
        name: "formatSalary",
        signature: "formatSalary(value: string): string",
        code: `export function formatSalary(value: string) { return "${salary}" || value.trim() }`,
        deps: [],
        tests: [
          {
            name: "formats salary ranges",
            file: "src/components/JobCard.test.ts",
            code: "expect(formatSalary('$180k')).toBe('$180k')",
          },
        ],
      },
    ],
    components: [
      {
        name: "JobCard",
        signature: "JobCard(props: JobCardProps)",
        componentCode,
        propsName: "JobCardProps",
        propsCode: "type JobCardProps = { company: string; salary: string }",
        propsFields: [
          { name: "company", type: "string" },
          { name: "salary", type: "string" },
        ],
        stories: [
          {
            id: "jobcard--default",
            exportName: "Default",
            storybookRoot: "frontend",
            snapshot: variant === "project"
              ? vitestSnapshot('<article class="job-card"><strong>Original index</strong></article>')
              : vitestSnapshot(`<article class="job-card"><strong>${label}</strong><span>${salary}</span></article>`),
          },
          {
            id: "jobcard--compact",
            exportName: "Compact",
            storybookRoot: "frontend",
            snapshot: null,
          },
        ],
      },
    ],
  }
  const helper: FileEntry = {
    file: "src/lib/money.ts",
    code: "export function formatMoney(value: number) { return `$${value}` }\n",
    items: [
      {
        kind: "function",
        name: "formatMoney",
        signature: "formatMoney(value: number): string",
        code: "export function formatMoney(value: number) { return `$${value}` }",
        deps: [],
        tests: [
          {
            name: "formatMoney handles USD",
            file: "src/lib/money.test.ts",
            code: "expect(formatMoney(5)).toBe('$5')",
          },
        ],
      },
    ],
  }
  return {
    root: "/qa/project",
    files: [file, helper],
    symbols: {
      JobCard: { file: "src/components/JobCard.tsx", line: 1 },
      formatMoney: { file: "src/lib/money.ts", line: 1 },
    },
  }
}

function workspaceFrom(meta: WorkspaceMeta, base: StudioIndex, active: StudioIndex): Workspace {
  return {
    ...meta,
    forkDir: `/qa/workspaces/${meta.id}`,
    index: active,
    instances: {
      [meta.baseInstanceId]: {
        id: meta.baseInstanceId,
        workspaceId: meta.id,
        materializedRoot: `/qa/workspaces/${meta.id}/base`,
        mutability: "immutable",
        createdAt: meta.createdAt,
        index: base,
      },
      [meta.activeInstanceId]: {
        id: meta.activeInstanceId,
        workspaceId: meta.id,
        materializedRoot: `/qa/workspaces/${meta.id}/active`,
        mutability: "writable",
        createdAt: meta.createdAt + 1,
        index: active,
      },
    },
  }
}

function testState(): TestState {
  return {
    status: "fail",
    runningSince: null,
    results: {
      total: 2,
      passed: 1,
      failed: 1,
      failures: [
        {
          file: "src/lib/money.test.ts",
          test: "formatMoney handles USD",
          message: "expected '$5' to equal 'USD 5'",
        },
      ],
    },
  }
}

function doneGoal(id: string, label: string, target: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    label,
    target,
    text: "Existing review note",
    mode: "code",
    createdAt: Date.now(),
    status: "done",
    mergePolicy: { autoMerge: false },
    replies: [],
    ...extra,
  }
}

class QaApi {
  readonly projectIndex = indexFixture("project")
  readonly baseIndex = indexFixture("base")
  readonly activeIndex = indexFixture("active")
  readonly runTargets: RunTarget[] = [
    { id: "root-app", label: "App", cwd: ".", command: "pnpm", args: ["dev"], framework: "vite" },
  ]
  readonly demos = [
    { id: "hn-jobs", name: "HN Jobs", root: "/qa/hn-jobs" },
    { id: "vinyl-collection", name: "Vinyl Collection", root: "/qa/vinyl-collection" },
    { id: "investment-portfolio", name: "Investment Portfolio", root: "/qa/investment-portfolio" },
    { id: "household-maintenance", name: "Household Maintenance", root: "/qa/household-maintenance" },
  ]
  workspaces = new Map<string, Workspace>()
  runUrls: Record<string, string> = {}
  runStates: Record<string, RunState> = {}
  storybookUrls: Record<string, string> = {}
  storybookStates: Record<string, SbState> = {}
  createdGoals: Array<{ workspaceId: string; body: Record<string, unknown> }> = []
  runStarts: Array<{ workspaceId: string; targetId: string; body: Record<string, unknown> }> = []
  storybookStarts: string[] = []
  demoPosts: string[] = []
  reindexCalls: string[] = []
  resetCount = 0
  workspaceCreates: Array<{ fromWorkspaceId?: string; kind?: WorkspaceKind; name?: string }> = []
  failDemoPosts = false

  constructor(options: { failedRuntimes?: boolean } = {}) {
    const meta: WorkspaceMeta = {
      id: "ws-main",
      name: "Main workspace",
      kind: "code",
      parentId: null,
      createdAt: 10,
      baseInstanceId: "inst-base",
      activeInstanceId: "inst-main",
      goals: [
        doneGoal("goal-existing", "Tighten JobCard copy", "component:JobCard", {
          storyId: "jobcard--default",
          selector: ":scope > article",
          component: "JobCard",
        }),
      ],
    }
    this.workspaces.set(meta.id, workspaceFrom(meta, this.baseIndex, this.activeIndex))
    if (options.failedRuntimes) {
      this.runStates["ws-main:root-app"] = {
        id: "ws-main:root-app",
        workspaceId: "ws-main",
        targetId: "root-app",
        status: "failed",
        startedAt: Date.now(),
        logs: ["vite failed to bind"],
        error: "port unavailable",
      }
      this.storybookStates["inst-main:frontend"] = {
        status: "failed",
        startedAt: Date.now(),
        logs: ["storybook failed"],
        error: "missing preview module",
      }
    }
  }

  metas(): WorkspaceMeta[] {
    return [...this.workspaces.values()].map(({ forkDir: _forkDir, index: _index, instances: _instances, ...meta }) => meta)
  }

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
    const readBody = (): Record<string, unknown> => {
      const raw = request.postData() || "{}"
      try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
    }

    if (path === "/api/index") return json(this.projectIndex)
    if (path === "/api/test-results") return json(testState())
    if (path === "/api/storybooks") return json({ urls: this.storybookUrls, states: this.storybookStates, entries: {} })
    if (path === "/api/run-targets") return json({ targets: this.runTargets })
    if (path === "/api/runs") return json({ urls: this.runUrls, states: this.runStates, entries: {} })
    if (path === "/api/sessions") return json({ session: null, events: [] })
    if (path === "/api/demos" && request.method() === "GET") {
      return json({ active: "hn-jobs", sourceProject: "/qa/hn-jobs", sessionRoot: "/qa/session", demos: this.demos })
    }
    if (path === "/api/demos" && request.method() === "POST") {
      const body = readBody()
      this.demoPosts.push(String(body["id"] ?? ""))
      return this.failDemoPosts ? json({ ok: false, error: "demo unavailable" }, 500) : json({ ok: true, active: body["id"] })
    }
    if (path === "/api/reset" && request.method() === "POST") {
      this.resetCount += 1
      this.workspaces.clear()
      const meta: WorkspaceMeta = {
        id: `ws-reset-${this.resetCount}`,
        name: "Reset workspace",
        kind: "code",
        parentId: null,
        createdAt: 100 + this.resetCount,
        baseInstanceId: `inst-reset-base-${this.resetCount}`,
        activeInstanceId: `inst-reset-active-${this.resetCount}`,
        goals: [],
      }
      const ws = workspaceFrom(meta, this.baseIndex, this.activeIndex)
      this.workspaces.set(ws.id, ws)
      return json({ ok: true, workspace: this.meta(ws.id) })
    }

    if (path === "/api/agent/run") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          "data: {\"type\":\"status\",\"message\":\"qa agent started\"}",
          "",
          "data: {\"type\":\"done\",\"code\":0}",
          "",
          "",
        ].join("\n"),
      })
    }

    const workspaceMatch = path.match(/^\/api\/workspaces(?:\/(.+))?$/)
    if (!workspaceMatch) return json({})
    const sub = workspaceMatch[1] ?? ""

    const goalPost = sub.match(/^([^/]+)\/goals$/)
    if (request.method() === "POST" && goalPost?.[1]) {
      const workspaceId = decodeURIComponent(goalPost[1])
      const body = readBody()
      this.createdGoals.push({ workspaceId, body })
      const ws = this.workspaces.get(workspaceId)
      const goal = doneGoal(`goal-${this.createdGoals.length}`, String(body["goalName"] ?? body["label"] ?? "QA goal"), String(body["target"] ?? ""), {
        text: String(body["text"] ?? ""),
        mode: body["mode"] === "arch" ? "arch" : "code",
        storyId: typeof body["storyId"] === "string" ? body["storyId"] : null,
        selector: typeof body["selector"] === "string" ? body["selector"] : null,
        component: typeof body["component"] === "string" ? body["component"] : null,
        mergePolicy: { autoMerge: false },
        lifecycle: { stage: "impl", state: "ready_to_merge" },
        baseInstanceId: ws?.baseInstanceId ?? null,
        workingInstanceId: ws?.activeInstanceId ?? null,
      })
      ws?.goals.push(goal)
      return json({ ...goal, workspaceId })
    }

    const runPost = sub.match(/^([^/]+)\/runs\/([^/]+)$/)
    if (request.method() === "POST" && runPost?.[1] && runPost[2]) {
      const workspaceId = decodeURIComponent(runPost[1])
      const targetId = decodeURIComponent(runPost[2])
      const body = readBody()
      this.runStarts.push({ workspaceId, targetId, body })
      const key = `${workspaceId}:${targetId}`
      this.runUrls[key] = `/runs/${encodeURIComponent(workspaceId)}/${encodeURIComponent(targetId)}/`
      this.runStates[key] = {
        id: key,
        workspaceId,
        targetId,
        status: "ready",
        startedAt: Date.now(),
        logs: ["ready"],
      }
      return json({ ok: true, state: this.runStates[key] })
    }

    const storybookPost = sub.match(/^([^/]+)\/storybook$/)
    if (request.method() === "POST" && storybookPost?.[1]) {
      const workspaceId = decodeURIComponent(storybookPost[1])
      this.storybookStarts.push(workspaceId)
      const ws = this.workspaces.get(workspaceId)
      if (ws) {
        const key = `${ws.activeInstanceId}:frontend`
        this.storybookUrls[key] = `/storybooks/${encodeURIComponent(key)}`
        this.storybookStates[key] = { status: "ready", startedAt: Date.now(), logs: ["ready"] }
      }
      return json({ ok: true })
    }

    const reindexPost = sub.match(/^([^/]+)\/reindex$/)
    if (request.method() === "POST" && reindexPost?.[1]) {
      const workspaceId = decodeURIComponent(reindexPost[1])
      this.reindexCalls.push(workspaceId)
      return json(this.workspaces.get(workspaceId) ?? {})
    }

    const goalDelete = sub.match(/^([^/]+)\/goals\/([^/]+)$/)
    if (request.method() === "DELETE" && goalDelete?.[1] && goalDelete[2]) {
      const workspaceId = decodeURIComponent(goalDelete[1])
      const goalId = decodeURIComponent(goalDelete[2])
      const ws = this.workspaces.get(workspaceId)
      if (ws) ws.goals = ws.goals.filter((goal) => goal.id !== goalId)
      return json({ ok: true })
    }

    if (request.method() === "GET" && sub) return json(this.workspaces.get(decodeURIComponent(sub)) ?? {}, this.workspaces.has(decodeURIComponent(sub)) ? 200 : 404)
    if (request.method() === "GET" && !sub) return json(this.metas())
    if (request.method() === "POST" && !sub) {
      const body = readBody()
      const fromWorkspaceId = typeof body["fromWorkspaceId"] === "string" ? body["fromWorkspaceId"] : undefined
      const kind = body["kind"] === "arch" ? "arch" : "code"
      const name = typeof body["name"] === "string" ? body["name"] : undefined
      this.workspaceCreates.push({ ...(fromWorkspaceId ? { fromWorkspaceId } : {}), kind, ...(name ? { name } : {}) })
      const n = this.workspaceCreates.length
      const meta: WorkspaceMeta = {
        id: `ws-created-${n}`,
        name: name ?? (fromWorkspaceId ? `Branch ${n}` : `Workspace ${n}`),
        kind,
        parentId: fromWorkspaceId ?? null,
        createdAt: 20 + n,
        baseInstanceId: `inst-created-base-${n}`,
        activeInstanceId: `inst-created-active-${n}`,
        goals: [],
      }
      const ws = workspaceFrom(meta, this.baseIndex, this.activeIndex)
      this.workspaces.set(ws.id, ws)
      return json(this.meta(ws.id))
    }
    if (request.method() === "DELETE" && sub) {
      this.workspaces.delete(decodeURIComponent(sub))
      return json({ ok: true })
    }
    return json({ error: "method not allowed" }, 405)
  }

  meta(id: string): WorkspaceMeta {
    const ws = this.workspaces.get(id)
    if (!ws) throw new Error(`missing workspace ${id}`)
    const { forkDir: _forkDir, index: _index, instances: _instances, ...meta } = ws
    return meta
  }
}

async function newPage(api: QaApi): Promise<{ page: Page; consoleErrors: string[]; pageErrors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => pageErrors.push(err.message))
  await page.route("**/runs/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><main>QA run target</main>",
  }))
  await page.route("**/storybooks/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><main>QA Storybook iframe</main>",
  }))
  await page.route("**/api/**", (route) => api.handle(route))
  await page.addInitScript(() => window.localStorage.clear())
  return { page, consoleErrors, pageErrors }
}

function actionableConsoleErrors(errors: string[]): string[] {
  return errors.filter((error) => !error.startsWith("Failed to load resource:"))
}

function actionablePageErrors(errors: string[]): string[] {
  return errors.filter((error) => !error.includes("The document is sandboxed and lacks the 'allow-same-origin' flag"))
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("timed out waiting for condition")
}

describe("Studio QA workflow", () => {
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

  it("exercises the main workspace, run, story, comment, review, reindex, fork, and reset workflow", async () => {
    const api = new QaApi()
    const { page, consoleErrors, pageErrors } = await newPage(api)
    page.on("dialog", (dialog) => dialog.accept())

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })
      await page.waitForSelector("iframe.story-frame[title='App']", { timeout: 30_000 })
      expect(api.runStarts.some((start) =>
        start.workspaceId === "ws-main" && start.targetId === "root-app" && start.body["restart"] === false
      )).toBe(true)
      expect(await page.locator("iframe.story-frame[title='App']").getAttribute("src")).toBe("/runs/ws-main/root-app/")

      await page.getByRole("button", { name: "↻ Restart" }).click()
      await waitFor(() => api.runStarts.some((start) => start.body["restart"] === true))

      await page.locator(".sidebar-tree .anode.comp", { hasText: "JobCard" }).click()
      await page.waitForSelector("iframe.story-frame[title='jobcard--default']", { timeout: 30_000 })
      await waitFor(() => api.storybookStarts.includes("ws-main"))
      const storySrc = await page.locator("iframe.story-frame[title='jobcard--default']").getAttribute("src")
      expect(storySrc).toContain("/storybooks/inst-main%3Afrontend/iframe.html?id=jobcard--default")

      await page.locator(".sidebar-tree .anode.comp", { hasText: "JobCard" }).click({ modifiers: ["Alt"] })
      await page.getByRole("textbox").fill("Make the title more specific and keep salary visible")
      await page.getByRole("button", { name: "Create Change" }).click()
      await waitFor(() => api.workspaceCreates.length === 1)
      expect(api.workspaceCreates[0]).toEqual({ fromWorkspaceId: "ws-main", kind: "code", name: "JobCard" })
      await waitFor(() => api.createdGoals.length === 1)
      expect(api.createdGoals[0]).toMatchObject({
        workspaceId: "ws-created-1",
        body: {
          target: "component:JobCard",
          label: "JobCard",
          text: "Make the title more specific and keep salary visible",
          mode: "code",
          fork: true,
        },
      })
      await page.locator(".rail-row.ws[title^='JobCard (']").waitFor({ timeout: 15_000 })

      await page.evaluate(() => {
        window.postMessage({
          type: "logos:story-comment",
          clientEventId: "qa-story-comment-1",
          storyId: "jobcard--default",
          component: "JobCard",
          selector: ":scope > article > strong",
          label: "strong Senior Platform Engineer",
          text: "Check that the story comment creates a targeted goal",
          mode: "code",
          htmlContext: "selected: <strong>Senior Platform Engineer</strong>",
        }, "*")
      })
      await waitFor(() => api.workspaceCreates.length === 2)
      expect(api.workspaceCreates[1]).toEqual({ fromWorkspaceId: "ws-created-1", kind: "code", name: "strong Senior Platform Engineer" })
      await waitFor(() => api.createdGoals.length === 2)
      expect(api.createdGoals[1]).toMatchObject({
        workspaceId: "ws-created-2",
        body: {
          target: "component:JobCard",
          label: "strong Senior Platform Engineer",
          text: "Check that the story comment creates a targeted goal",
          storyId: "jobcard--default",
          selector: ":scope > article > strong",
          component: "JobCard",
          htmlContext: "selected: <strong>Senior Platform Engineer</strong>",
          fork: true,
        },
      })

      await page.getByRole("tab", { name: /Changes/ }).click()
      await page.getByRole("button", { name: /Snapshots/ }).click()
      await page.getByRole("button", { name: "Snapshot diff" }).click()
      const reviewText = await page.locator(".review-panel").innerText()
      expect(reviewText).toContain("JobCard / Default")
      expect(reviewText).toContain("Senior Platform Engineer")
      expect(reviewText).toContain("Platform Engineer")

      await page.locator(".refresh-btn", { hasText: "↻" }).click()
      await waitFor(() => api.reindexCalls.includes("ws-created-2"))

      await page.locator("button[title='New workspace']").click()
      await waitFor(() => api.workspaceCreates.length === 3)
      expect(api.workspaceCreates[2]).toEqual({ kind: "code" })
      await page.locator(".rail-row.ws", { hasText: "Workspace 3" }).waitFor({ timeout: 15_000 })

      await page.locator("button[title='Reset all workspaces']").click()
      await waitFor(() => api.resetCount === 1)
      await page.locator(".rail-row.ws", { hasText: "Reset workspace" }).waitFor({ timeout: 15_000 })

      expect(actionablePageErrors(pageErrors)).toEqual([])
      expect(actionableConsoleErrors(consoleErrors)).toEqual([])
    } finally {
      await page.close()
    }
  }, 90_000)

  it("surfaces failed app runs while preserving portable story fallback when Storybook has no URL", async () => {
    const api = new QaApi({ failedRuntimes: true })
    const { page, consoleErrors, pageErrors } = await newPage(api)

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".sidebar-tree .anode.run", { hasText: "App" }).waitFor({ timeout: 45_000 })
      expect(await page.locator(".sb-startup-header.sb-failed").innerText()).toContain("App failed to start")
      expect(await page.locator(".sb-startup-error").innerText()).toContain("port unavailable")
      await page.getByRole("button", { name: "▶ Play" }).click()
      await waitFor(() => api.runStarts.some((start) => start.workspaceId === "ws-main" && start.targetId === "root-app"))

      await page.locator(".sidebar-tree .anode.comp", { hasText: "JobCard" }).click()
      const frameEl = page.locator("iframe.story-frame[title='jobcard--default']")
      await frameEl.waitFor({ timeout: 30_000 })
      expect(await frameEl.getAttribute("src")).toContain("/portable-story.html?storyId=jobcard--default")
      expect(api.storybookStarts).toEqual([])

      expect(actionablePageErrors(pageErrors)).toEqual([])
      expect(actionableConsoleErrors(consoleErrors)).toEqual([])
    } finally {
      await page.close()
    }
  }, 60_000)

  it("opens the demo menu and reports failed demo switches without losing the active workspace", async () => {
    const api = new QaApi()
    api.failDemoPosts = true
    const { page, consoleErrors, pageErrors } = await newPage(api)

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" })
      await page.locator(".rail-row.ws", { hasText: "Main workspace" }).waitFor({ timeout: 45_000 })
      await page.getByRole("button", { name: "Open project menu" }).click()
      const demoMenu = await page.locator(".demo-menu").innerText()
      expect(demoMenu).toContain("OPEN PROJECT")
      expect(demoMenu).toContain("Vinyl Collection")
      expect(demoMenu).toContain("Household Maintenance")

      await page.locator(".demo-menu-item", { hasText: "Vinyl Collection" }).click()
      await waitFor(() => api.demoPosts.includes("vinyl-collection"))
      await page.locator(".rail-row.ws", { hasText: "Main workspace" }).waitFor({ timeout: 15_000 })

      expect(actionablePageErrors(pageErrors)).toEqual([])
      expect(actionableConsoleErrors(consoleErrors)).toEqual([])
    } finally {
      await page.close()
    }
  }, 60_000)
})
