import { defineConfig, type Plugin, type Connect } from "vite"
import react from "@vitejs/plugin-react"
import { execFile, execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join, relative, sep } from "node:path"
import type { StudioIndex } from "../src/build-index"
import { authPlugin } from "./server/auth"
import { publicStorybookUrl, storybookProxyPlugin } from "./server/storybook-proxy"
import { publicRunUrl, runProxyPlugin } from "./server/run-proxy"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "..")
const DEMO_STATE_FILE = resolve(LOGOS_TS, ".logos", "active-demo.json")
const DEMOS = [
  { id: "hn-jobs", name: "HN Jobs (Mini)", root: resolve(STUDIO, "../../hn-jobs") },
  { id: "vinyl-collection", name: "Vinyl Collection", root: resolve(STUDIO, "../../vinyl-collection") },
  { id: "investment-portfolio", name: "Investment Portfolio", root: resolve(STUDIO, "../../investment-portfolio") },
  { id: "logos-studio", name: "Logos Studio", root: LOGOS_TS },
] as const
type DemoId = typeof DEMOS[number]["id"]
const ALLOWED_HOSTS = [
  "logos-ts-santiweight.fly.dev",
  ...(process.env.LOGOS_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
]

type DetectProject = typeof import("../src/detect-project")["detectProject"]
type WorkspaceKind = import("../src/workspace-manager").WorkspaceKind

type StudioRuntime = {
  demoId: DemoId | "custom"
  sourceProject: string
  projectRoot: string
  caps: ReturnType<DetectProject>
  tsx: string
  studioPortFile: string
  indexReady: Promise<StudioIndex>
  sbManager: import("../src/storybook-manager").StorybookManager
  runManager: import("../src/run-manager").RunManager
  wsMgr: import("../src/workspace-manager").WorkspaceManager
  portableStories: import("../src/portable-stories").PortableStoryResolver
}

function demoById(id: string | null | undefined) {
  return DEMOS.find((demo) => demo.id === id) ?? null
}

function demoIdForSource(sourceProject: string): DemoId | "custom" {
  return DEMOS.find((demo) => resolve(demo.root) === resolve(sourceProject))?.id ?? "custom"
}

function storedDemoId(): DemoId | null {
  try {
    if (!existsSync(DEMO_STATE_FILE)) return null
    const data = JSON.parse(readFileSync(DEMO_STATE_FILE, "utf8")) as { id?: string }
    return demoById(data.id)?.id ?? null
  } catch {
    return null
  }
}

function sourceProjectForStartup(): { demoId: DemoId | "custom"; sourceProject: string } {
  const envProject = process.env.LOGOS_PROJECT
  if (envProject) {
    const sourceProject = resolve(envProject)
    return { demoId: demoIdForSource(sourceProject), sourceProject }
  }
  const stored = demoById(storedDemoId())
  const demo = stored ?? DEMOS[0]
  return { demoId: demo.id, sourceProject: demo.root }
}

function persistDemo(id: DemoId): void {
  mkdirSync(dirname(DEMO_STATE_FILE), { recursive: true })
  writeFileSync(DEMO_STATE_FILE, JSON.stringify({ id }, null, 2))
}

async function createStudioRuntime(): Promise<StudioRuntime> {
  const [
    { detectProject },
    { StorybookManager },
    { RunManager },
    { WorkspaceManager },
    { ClaudeSessionManager },
    { LogosRuntimeStore },
    { createPortableStoryResolver },
    { createSessionProject },
  ] = await Promise.all([
    import("../src/detect-project"),
    import("../src/storybook-manager"),
    import("../src/run-manager"),
    import("../src/workspace-manager"),
    import("../src/claude-session-manager"),
    import("../src/runtime-store"),
    import("../src/portable-stories"),
    import("../src/session-project"),
  ])

  const { demoId, sourceProject } = sourceProjectForStartup()
  const projectRoot = createSessionProject(sourceProject, resolve(LOGOS_TS, ".dev-sessions")).root
  const caps = detectProject(projectRoot)
  console.log(`[logos] source: ${sourceProject}`)
  console.log(`[logos] demo: ${demoId}`)
  console.log(`[logos] project: ${caps.root}`)
  console.log(`[logos] storybook: ${caps.storybook ? caps.storybook.configDir : "not found"}`)
  console.log(`[logos] runs: ${caps.runs.length ? caps.runs.map((run) => run.label).join(", ") : "not found"}`)
  console.log(`[logos] tests: ${caps.tests ? caps.tests.command.join(" ") : "not found"}`)
  const tsx = resolve(LOGOS_TS, "node_modules/.bin/tsx")
  const studioPortFile = resolve(projectRoot, ".logos", "studio-port")
  const runtimeStore = new LogosRuntimeStore(resolve(projectRoot, ".logos", "runtime.db"))

  const indexReady: Promise<StudioIndex> = new Promise((res, rej) => {
    const t0 = Date.now()
    console.log(`[logos] building index (background)...`)
    execFile(tsx, [resolve(LOGOS_TS, "src/build-index.ts"), projectRoot, "-"], {
      cwd: LOGOS_TS, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) { rej(err); return }
      console.log(`[logos] index ready in ${Date.now() - t0}ms`)
      res(JSON.parse(stdout) as StudioIndex)
    })
  })

  const sbManager = new StorybookManager(runtimeStore, resolve(LOGOS_TS, "src"), projectRoot)
  const runManager = new RunManager(runtimeStore, projectRoot)

  const sessionMgr = new ClaudeSessionManager(runtimeStore)

  const wsMgr = new WorkspaceManager({
    store: runtimeStore,
    runsDir: process.env.LOGOS_AGENT_RUNS_DIR ? resolve(process.env.LOGOS_AGENT_RUNS_DIR) : resolve(LOGOS_TS, ".agent-runs"),
    logosTsSrc: resolve(LOGOS_TS, "src"),
    logosTsRoot: LOGOS_TS,
    projectRoot,
    sourceProjectRoot: sourceProject,
    caps,
    sbManager,
    runManager,
    sessions: sessionMgr,
    tsx,
    getIndex: () => indexReady,
  })

  const portableStories = createPortableStoryResolver({
    projectRoot,
    storybook: caps.storybook,
    workspaceRoot: (id) => {
      if (!id) return projectRoot
      return wsMgr.get(id)?.forkDir ?? null
    },
  })

  return { demoId, sourceProject, projectRoot, caps, tsx, studioPortFile, indexReady, sbManager, runManager, wsMgr, portableStories }
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => res(b))
  })
}

function studioApi(runtime: StudioRuntime): Plugin {
  return {
    name: "logos-ts-studio-api",
    configureServer(server) {
      const {
        projectRoot: PROJECT_ROOT,
        caps,
        tsx,
        studioPortFile: STUDIO_PORT_FILE,
        indexReady,
        sbManager,
        runManager,
        wsMgr,
      } = runtime

      server.httpServer?.once("listening", () => {
        const addr = server.httpServer!.address()
        if (addr && typeof addr === "object") {
          mkdirSync(resolve(PROJECT_ROOT, ".logos"), { recursive: true })
          writeFileSync(STUDIO_PORT_FILE, String(addr.port))
        }
      })

      server.middlewares.use("/api/index", async (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify(await indexReady))
      })

      server.middlewares.use("/api/demos", async (req, res) => {
        res.setHeader("content-type", "application/json")
        if (req.method === "GET") {
          res.end(JSON.stringify({
            active: runtime.demoId,
            sourceProject: runtime.sourceProject,
            sessionRoot: runtime.projectRoot,
            demos: DEMOS,
          }))
          return
        }
        if (req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}") as { id?: string }
          const demo = demoById(body.id)
          if (!demo) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: "unknown demo" }))
            return
          }
          persistDemo(demo.id)
          process.env.LOGOS_PROJECT = demo.root
          res.end(JSON.stringify({ ok: true, active: demo.id }))
          setTimeout(() => {
            try { runtime.wsMgr.abortAll() } catch {}
            try { runtime.sbManager.shutdownAll() } catch {}
            try { runtime.runManager.shutdownAll() } catch {}
            void (server as { restart?: () => Promise<void> }).restart?.()
          }, 50)
          return
        }
        res.statusCode = 405
        res.end(JSON.stringify({ error: "method not allowed" }))
      })

      server.middlewares.use("/api/capabilities", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({
          root: caps.root,
          hasStorybook: !!caps.storybook,
          hasTests: !!caps.tests,
        }))
      })

      // Persistent test runner
      type TestState = {
        status: "running" | "pass" | "fail" | "idle"
        results: { total: number; passed: number; failed: number; failures: { test: string; file: string; message: string }[] } | null
        runningSince: number | null
      }
      const testState: TestState = { status: "idle", results: null, runningSince: null }

      if (caps.tests) {
        const [testCmd, ...testArgs] = caps.tests.command
        const testCacheDir = resolve(PROJECT_ROOT, ".logos_cache", "test-runner")
        const runTests = () => {
          if (testState.status === "running") return
          testState.status = "running"
          testState.runningSince = Date.now()
          mkdirSync(testCacheDir, { recursive: true })
          execFile(testCmd, testArgs, {
            cwd: PROJECT_ROOT,
            timeout: 120_000,
            env: {
              ...process.env,
              LOGOS_VITEST_CACHE_DIR: testCacheDir,
              NODE_ENV: "test",
            },
          }, (_err, stdout) => {
            try {
              const parsed = JSON.parse(stdout)
              testState.results = parsed
              testState.status = (parsed.failed ?? 0) > 0 ? "fail" : "pass"
            } catch {
              testState.status = testState.results ? (testState.results.failed > 0 ? "fail" : "pass") : "idle"
            }
            testState.runningSince = null
          })
        }
        const DEBOUNCE_MS = 1500
        let debounce: ReturnType<typeof setTimeout> | null = null
        const onFileChange = (filename: string | null) => {
          if (!filename || !/\.(tsx?|jsx?)$/.test(filename)) return
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(runTests, DEBOUNCE_MS)
        }
        for (const dir of caps.tests.watchDirs) {
          try { watch(resolve(PROJECT_ROOT, dir), { recursive: true }, (_ev, f) => onFileChange(f)) } catch {}
        }
        runTests()
      }

      server.middlewares.use("/api/test-results", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify(testState))
      })

      server.middlewares.use("/api/graph", (_req, res) => {
        const json = execFileSync(tsx, [resolve(LOGOS_TS, "src/build-graph.ts"), PROJECT_ROOT], {
          cwd: LOGOS_TS, encoding: "utf8",
        })
        res.setHeader("content-type", "application/json")
        res.end(json)
      })

      server.middlewares.use("/api/open", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end() }
        const body = JSON.parse((await readBody(req)) || "{}")
        const file = body.file as string | undefined
        if (!file) { res.statusCode = 400; return res.end(JSON.stringify({ error: "file required" })) }
        const abs = resolve(PROJECT_ROOT, file)
        const target = body.line ? `${abs}:${body.line}` : abs
        execFile("code", ["--goto", target], (err) => {
          res.setHeader("content-type", "application/json")
          if (err) { res.statusCode = 500; res.end(JSON.stringify({ error: String(err) })) }
          else res.end(JSON.stringify({ ok: true }))
        })
      })

      server.middlewares.use("/api/storybooks", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        const entries = sbManager.all()
        const states = sbManager.allStates()
        const urls: Record<string, string> = {}
        for (const id of Object.keys(entries)) urls[id] = publicStorybookUrl(id)
        res.end(JSON.stringify({ urls, states, entries }))
      })

      server.middlewares.use("/api/run-targets", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        res.end(JSON.stringify({ targets: caps.runs }))
      })

      server.middlewares.use("/api/runs", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        for (const ws of wsMgr.list()) {
          for (const target of caps.runs) runManager.get(ws.id, target.id)
        }
        const entries = runManager.all()
        const states = runManager.allStates()
        const urls: Record<string, string> = {}
        for (const entry of Object.values(entries)) {
          urls[entry.id] = publicRunUrl(entry.workspaceId, entry.targetId)
        }
        res.end(JSON.stringify({ urls, states, entries }))
      })

      server.middlewares.use("/api/workspace-policy-events", (req, res) => {
        res.setHeader("content-type", "application/json")
        if (req.method !== "GET") {
          res.statusCode = 405
          res.end(JSON.stringify({ error: "method not allowed" }))
          return
        }
        const params = new URL(req.url || "", "http://x").searchParams
        const workspaceId = params.get("workspace") ?? undefined
        const rawLimit = Number(params.get("limit") ?? "200")
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 200
        res.end(JSON.stringify({ events: wsMgr.listPolicyEvents({ workspaceId, limit }) }))
      })

      server.middlewares.use("/api/reset", async (req, res) => {
        res.setHeader("content-type", "application/json")
        if (req.method !== "POST") {
          res.statusCode = 405
          res.end(JSON.stringify({ error: "method not allowed" }))
          return
        }
        try {
          wsMgr.resetAll()
          const workspace = await wsMgr.create()
          res.end(JSON.stringify({ ok: true, workspace }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
      })

      // --- Workspace CRUD ---
      server.middlewares.use("/api/workspaces", async (req, res) => {
        res.setHeader("content-type", "application/json")
        const sub = (req.url || "/").replace(/^\//, "").split("?")[0]

        // POST /api/workspaces/:id/goals — add a goal
        if (req.method === "POST" && sub.endsWith("/goals")) {
          const wsId = sub.replace(/\/goals$/, "")
          const body = JSON.parse((await readBody(req)) || "{}")
          const result = await wsMgr.addGoal(wsId, {
            id: `goal-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
            text: String(body.text ?? ""),
            label: String(body.label ?? ""),
            target: String(body.target ?? ""),
            mode: body.mode === "arch" ? "arch" : "code",
            createdAt: Date.now(),
            storyId: body.storyId ?? null,
            selector: body.selector ?? null,
            component: body.component ?? null,
          }, { fork: body.fork === true })
          if ("error" in result) {
            res.statusCode = result.status
            res.end(JSON.stringify({ error: result.error }))
            return
          }
          res.end(JSON.stringify({ ...result.goal, workspaceId: result.workspaceId }))
          return
        }

        // POST /api/workspaces/:id/storybook — start (or restart after failure) its Storybook
        if (req.method === "POST" && sub.endsWith("/storybook")) {
          const wsId = sub.replace(/\/storybook$/, "")
          if (!wsMgr.get(wsId)) { res.statusCode = 404; res.end(JSON.stringify({ error: "workspace not found" })); return }
          wsMgr.ensureStorybook(wsId).catch((e: any) => {
            console.error(`[logos] storybook for ${wsId} failed to start:`, e.message)
          })
          res.end(JSON.stringify({ ok: true, state: sbManager.state(wsId) }))
          return
        }

        // POST /api/workspaces/:id/runs/:targetId — start or restart a run target
        const runMatch = sub.match(/^(.+)\/runs\/([^/]+)$/)
        if (req.method === "POST" && runMatch?.[1] && runMatch[2]) {
          const wsId = runMatch[1]
          const targetId = decodeURIComponent(runMatch[2])
          const body = JSON.parse((await readBody(req)) || "{}") as { restart?: boolean }
          if (!wsMgr.get(wsId)) { res.statusCode = 404; res.end(JSON.stringify({ error: "workspace not found" })); return }
          wsMgr.ensureRun(wsId, targetId, { restart: body.restart === true }).catch((e: any) => {
            console.error(`[logos] run ${targetId} for ${wsId} failed to start:`, e.message)
          })
          res.end(JSON.stringify({ ok: true, state: runManager.state(wsId, targetId) }))
          return
        }

        // POST /api/workspaces/:id/reindex — rebuild workspace index from disk
        if (req.method === "POST" && sub.endsWith("/reindex")) {
          const wsId = sub.replace(/\/reindex$/, "")
          try {
            const ws = wsMgr.reindex(wsId)
            if (!ws) { res.statusCode = 404; res.end(JSON.stringify({ error: "workspace not found" })); return }
            res.end(JSON.stringify(ws))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(e) }))
          }
          return
        }

        // POST /api/workspaces/:id/push-branch — publish active workspace as a git branch and PR
        if (req.method === "POST" && sub.endsWith("/push-branch")) {
          const wsId = sub.replace(/\/push-branch$/, "")
          try {
            const body = JSON.parse((await readBody(req)) || "{}")
            const branchName = String(body.branchName ?? "")
            console.log(`[workspace-publish-api] request: ${JSON.stringify({ workspaceId: wsId, branchName })}`)
            const result = wsMgr.pushAsBranch(wsId, String(body.branchName ?? ""), {
              remote: typeof body.remote === "string" ? body.remote : undefined,
              createPullRequest: true,
              baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : undefined,
              title: typeof body.title === "string" ? body.title : `Logos workspace: ${branchName}`,
              body: "Created automatically from a Logos workspace.",
            })
            console.log(`[workspace-publish-api] success: ${JSON.stringify({
              workspaceId: wsId,
              branchName: result.branchName,
              remote: result.remote,
              commit: result.commit,
              pullRequest: result.pullRequest,
            })}`)
            res.end(JSON.stringify({ ok: true, ...result }))
          } catch (e) {
            console.error(`[workspace-publish-api] failed: ${e instanceof Error ? e.message : String(e)}`)
            res.statusCode = /workspace not found/.test(String(e)) ? 404 : 400
            res.end(JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }))
          }
          return
        }

        // DELETE /api/workspaces/:id/goals/:goalId
        if (req.method === "DELETE" && sub.includes("/goals/")) {
          const [wsId, , goalId] = sub.split("/")
          wsMgr.removeGoal(wsId, goalId)
          res.end(JSON.stringify({ ok: true }))
          return
        }

        if (req.method === "GET") {
          if (sub) {
            const ws = wsMgr.get(sub)
            if (!ws) { res.statusCode = 404; res.end("{}"); return }
            res.end(JSON.stringify(ws))
            return
          }
          res.end(JSON.stringify(wsMgr.list()))
          return
        }

        if (req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}")
          const kind: WorkspaceKind = body.kind === "arch" ? "arch" : "code"
          const meta = await wsMgr.create({
            name: body.name,
            fromWorkspaceId: body.fromWorkspaceId,
            kind,
          })
          res.end(JSON.stringify(meta))
          return
        }

        if (req.method === "DELETE" && sub) {
          wsMgr.delete(sub)
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.statusCode = 405
        res.end()
      })

      // --- Agent run (SSE) — process next pending goal in a workspace ---
      server.middlewares.use("/api/agent/run", async (req, res) => {
        const params = new URL(req.url || "", "http://x").searchParams
        const wsId = params.get("workspace") || ""
        const requestedGoalId = params.get("goal")
        res.setHeader("content-type", "text/event-stream")
        res.setHeader("cache-control", "no-cache")
        res.setHeader("connection", "keep-alive")
        let closed = false
        let ended = false
        let activeGoalId: string | null = null
        let activeHandler: ((evt: { type: string; [key: string]: unknown }) => void) | null = null
        const cleanup = () => {
          if (activeGoalId && activeHandler) wsMgr.unsubscribeGoalEvents(activeGoalId, activeHandler)
          activeGoalId = null
          activeHandler = null
        }
        req.on("close", () => { closed = true; cleanup() })
        const send = (o: unknown) => {
          if (!closed) res.write(`data: ${JSON.stringify(o)}\n\n`)
        }
        const end = () => {
          if (!closed && !ended) {
            ended = true
            cleanup()
            res.end()
          }
        }

        activeHandler = (evt) => {
          send(evt)
          if (evt.type === "done" || evt.type === "error") end()
        }
        const goalId = requestedGoalId
          ? wsMgr.processById(wsId, requestedGoalId, activeHandler)
          : wsMgr.processNext(wsId, activeHandler)
        activeGoalId = goalId
        if (!goalId) end()
      })

      // --- Continue a completed goal (SSE) — resume the Claude session ---
      server.middlewares.use("/api/agent/continue", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return }
        const body = JSON.parse((await readBody(req)) || "{}")
        const wsId = String(body.workspace ?? "")
        const goalId = String(body.goal ?? "")
        const text = String(body.text ?? "")
        if (!wsId || !goalId || !text) { res.statusCode = 400; res.end(JSON.stringify({ error: "missing workspace, goal, or text" })); return }

        res.setHeader("content-type", "text/event-stream")
        res.setHeader("cache-control", "no-cache")
        res.setHeader("connection", "keep-alive")
        let closed = false
        let ended = false
        req.on("close", () => { closed = true })
        const send = (o: unknown) => { if (!closed) res.write(`data: ${JSON.stringify(o)}\n\n`) }
        const end = () => { if (!closed && !ended) { ended = true; res.end() } }

        const handler = (evt: { type: string; [key: string]: unknown }) => {
          send(evt)
          if (evt.type === "done" || evt.type === "error") end()
        }
        const ok = wsMgr.continueGoal(wsId, goalId, text, handler)
        if (!ok) end()
      })

      // --- Session log retrieval ---
      server.middlewares.use("/api/sessions", (req, res) => {
        res.setHeader("content-type", "application/json")
        const sub = (req.url || "/").replace(/^\//, "").split("?")[0]
        const params = new URL(req.url || "", "http://x").searchParams

        if (params.has("goal")) {
          const session = wsMgr.sessionManager.getByGoalId(params.get("goal")!)
          if (!session) { res.statusCode = 404; res.end(JSON.stringify({ error: "no session for goal" })); return }
          const events = wsMgr.sessionManager.getEvents(session.id)
          res.end(JSON.stringify({ session, events }))
          return
        }

        if (sub) {
          const session = wsMgr.sessionManager.get(sub)
          if (!session) { res.statusCode = 404; res.end(JSON.stringify({ error: "session not found" })); return }
          const events = wsMgr.sessionManager.getEvents(session.id)
          res.end(JSON.stringify({ session, events }))
          return
        }

        res.statusCode = 400
        res.end(JSON.stringify({ error: "provide session id or ?goal= param" }))
      })

    },
  }
}

function portableStoriesPlugin(runtime: StudioRuntime): Plugin {
  const prefix = "virtual:logos-portable-story"
  const resolvedPrefix = `\0${prefix}`
  return {
    name: "logos-portable-stories",
    resolveId(id) {
      if (id.startsWith(prefix)) return `\0${id}`
      return null
    },
    load(id) {
      if (!id.startsWith(resolvedPrefix)) return null
      return runtime.portableStories.moduleFor(id.slice(1))
    },
    handleHotUpdate(ctx) {
      if (/\.stories\.(t|j)sx?$/.test(ctx.file) || /[/\\]\.storybook[/\\]preview\.(t|j)sx?$/.test(ctx.file)) {
        runtime.portableStories.clearCache()
      }
    },
  }
}

function stripViteQuery(path: string): string {
  return path.replace(/[?#].*$/, "")
}

function containsPath(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))
}

function resolveSourceAlias(root: string, source: string): string | null {
  const base = resolve(root, source.slice(2))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.jsx"),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function workspaceAliasPlugin(runtime: StudioRuntime): Plugin {
  const workspaceRoots = () => {
    const roots = [runtime.projectRoot]
    for (const ws of runtime.wsMgr.list()) {
      const state = runtime.wsMgr.get(ws.id)
      if (state) roots.push(state.forkDir)
    }
    return roots
  }

  return {
    name: "logos-workspace-source-alias",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.startsWith("@/") || !importer) return null
      const importerPath = resolve(stripViteQuery(importer))
      const root = workspaceRoots().find((candidate) => containsPath(candidate, importerPath))
      if (!root) return null
      return resolveSourceAlias(root, source)
    },
  }
}

function autoStorybook(runtime: StudioRuntime): Plugin {
  return {
    name: "auto-workspace-runtimes",
    configureServer() {
      const { caps, sbManager, runManager, wsMgr } = runtime
      sbManager.cleanupAll()
      runManager.cleanupAll()
      // Ensure Storybooks are running for all existing workspaces
      for (const wsMeta of wsMgr.list()) {
        const ws = wsMgr.get(wsMeta.id)
        if (!ws) continue
        if (!sbManager.get(wsMeta.id) && caps.storybook) {
          const wsFrontend = join(ws.forkDir, relative(runtime.projectRoot, caps.storybook.frontendDir))
          sbManager.ensure(wsMeta.id, wsFrontend).catch((e: any) =>
            console.error(`[storybook-mgr] failed to restart ${wsMeta.id}:`, e.message)
          )
        }
        for (const target of caps.runs) {
          if (runManager.get(wsMeta.id, target.id)) continue
          runManager.ensure(wsMeta.id, ws.forkDir, target).catch((e: any) =>
            console.error(`[run-mgr] failed to restart ${wsMeta.id}:${target.id}:`, e.message)
          )
        }
      }
      const cleanup = () => { wsMgr.abortAll(); sbManager.shutdownAll(); runManager.shutdownAll() }
      process.on("exit", cleanup)
      process.on("SIGINT", () => { cleanup(); process.exit() })
      process.on("SIGTERM", () => { cleanup(); process.exit() })
    },
  }
}

function shouldCreateStudioRuntime(command: string): boolean {
  if (command !== "serve") return false
  if (process.env.LOGOS_STORYBOOK_BASE) return false
  if (process.env.npm_lifecycle_event === "storybook") return false
  return true
}

export default defineConfig(async ({ command }) => {
  const runtime = shouldCreateStudioRuntime(command) ? await createStudioRuntime() : null

  return {
    cacheDir: process.env.LOGOS_VITE_CACHE_DIR || undefined,
    plugins: runtime
      ? [authPlugin(), workspaceAliasPlugin(runtime), portableStoriesPlugin(runtime), react(), studioApi(runtime), storybookProxyPlugin(runtime.sbManager), runProxyPlugin(runtime.runManager), autoStorybook(runtime)]
      : [react()],
    server: {
      // Bind a concrete address: the default "localhost" can end up IPv6-only,
      // and the page hangs whenever the browser resolves localhost to 127.0.0.1.
      host: process.env.LOGOS_HOST || "127.0.0.1",
      allowedHosts: ALLOWED_HOSTS,
      port: Number(process.env.PORT) || 0,
      strictPort: Boolean(process.env.PORT),
      hmr: process.env.LOGOS_DISABLE_HMR === "1" ? false : undefined,
      watch: { ignored: ["**/.agent-runs/**"] },
    },
    resolve: {
      alias: {
        "@logos-studio": resolve(STUDIO, "src"),
        "@logos-src": resolve(LOGOS_TS, "src"),
      },
    },
  }
})
