import { defineConfig, type Plugin, type Connect } from "vite"
import react from "@vitejs/plugin-react"
import { execFile, execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, watch, cpSync, existsSync, symlinkSync, readdirSync, mkdtempSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, resolve, join, relative } from "node:path"
import type { StudioIndex } from "../src/build-index"
import { authPlugin } from "./server/auth"
import { publicStorybookUrl, storybookProxyPlugin } from "./server/storybook-proxy"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "..")
const SOURCE_PROJECT = resolve(process.env.LOGOS_PROJECT || resolve(STUDIO, "../../hn-jobs"))
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
  projectRoot: string
  caps: ReturnType<DetectProject>
  tsx: string
  studioPortFile: string
  indexReady: Promise<StudioIndex>
  sbManager: import("../src/storybook-manager").StorybookManager
  wsMgr: import("../src/workspace-manager").WorkspaceManager
  portableStories: import("../src/portable-stories").PortableStoryResolver
}

async function copyProject(src: string): Promise<string> {
  const { gcDevSessions, writeDevSessionPid } = await import("../src/dev-session-gc")
  const sessionsDir = resolve(LOGOS_TS, ".dev-sessions")
  mkdirSync(sessionsDir, { recursive: true })
  const ephDir = mkdtempSync(resolve(sessionsDir, "session-"))
  const sessionId = basename(ephDir)
  const gcResult = gcDevSessions(sessionsDir, { currentSessionId: sessionId })
  if (gcResult.removed.length > 0) {
    console.log(`[logos] removed stale sessions: ${gcResult.removed.join(", ")}`)
  }
  if (gcResult.failed.length > 0) {
    console.warn(`[logos] failed to remove stale sessions: ${gcResult.failed.map((f) => f.sessionId).join(", ")}`)
  }
  cpSync(src, ephDir, {
    recursive: true,
    filter: (s) => !/node_modules|\.logos_cache|\.logos$|\.vite-logos|dist$/.test(s),
  })
  writeDevSessionPid(ephDir)
  for (const entry of readdirSync(src)) {
    const full = join(src, entry)
    if (entry === "node_modules" && existsSync(full)) {
      symlinkSync(full, join(ephDir, entry))
    }
  }
  const frontendNm = join(src, "frontend", "node_modules")
  if (existsSync(frontendNm)) {
    mkdirSync(join(ephDir, "frontend"), { recursive: true })
    symlinkSync(frontendNm, join(ephDir, "frontend", "node_modules"))
  }
  console.log(`[logos] session: ${sessionId}`)
  console.log(`[logos] copied ${src} → ${ephDir}`)
  return ephDir
}

async function createStudioRuntime(): Promise<StudioRuntime> {
  const [
    { detectProject },
    { StorybookManager },
    { WorkspaceManager },
    { ClaudeSessionManager },
    { LogosRuntimeStore },
    { createPortableStoryResolver },
  ] = await Promise.all([
    import("../src/detect-project"),
    import("../src/storybook-manager"),
    import("../src/workspace-manager"),
    import("../src/claude-session-manager"),
    import("../src/runtime-store"),
    import("../src/portable-stories"),
  ])

  const projectRoot = await copyProject(SOURCE_PROJECT)
  const caps = detectProject(projectRoot)
  console.log(`[logos] project: ${caps.root}`)
  console.log(`[logos] storybook: ${caps.storybook ? caps.storybook.configDir : "not found"}`)
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

  const sessionMgr = new ClaudeSessionManager(runtimeStore)

  const wsMgr = new WorkspaceManager({
    store: runtimeStore,
    runsDir: resolve(LOGOS_TS, ".agent-runs"),
    logosTsSrc: resolve(LOGOS_TS, "src"),
    logosTsRoot: LOGOS_TS,
    projectRoot,
    caps,
    sbManager,
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

  return { projectRoot, caps, tsx, studioPortFile, indexReady, sbManager, wsMgr, portableStories }
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

      server.middlewares.use("/api/storybooks", (_req, res) => {
        res.setHeader("content-type", "application/json")
        const entries = sbManager.all()
        const states = sbManager.allStates()
        const urls: Record<string, string> = {}
        for (const id of Object.keys(entries)) urls[id] = publicStorybookUrl(id)
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
          const workspace = await wsMgr.create({ name: "workspace" })
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

      server.middlewares.use("/api/capture", async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end() }
        res.setHeader("content-type", "application/json")
        if (!caps.storybook) {
          res.statusCode = 501
          return res.end(JSON.stringify({ ok: false, error: "Storybook is not configured for this project" }))
        }
        try {
          const { storyRef, workspaceId } = JSON.parse((await readBody(req)) || "{}")
          const workspace = typeof workspaceId === "string" ? wsMgr.get(workspaceId) : null
          const captureRoot = workspace?.forkDir ?? PROJECT_ROOT
          const out = execFileSync(tsx, [resolve(LOGOS_TS, "src/capture.ts"), captureRoot, storyRef], {
            cwd: LOGOS_TS, encoding: "utf8",
          })
          const testFile = (out.match(/captured -> (.+)/)?.[1] ?? "").trim()
          const frontendDir = resolve(captureRoot, relative(PROJECT_ROOT, caps.storybook.frontendDir))
          const frontendVitest = resolve(frontendDir, "node_modules/.bin/vitest")
          const vitestCacheDir = resolve(captureRoot, ".logos_cache", "vitest")
          mkdirSync(vitestCacheDir, { recursive: true })
          execFileSync(frontendVitest, ["run", "--update", resolve(frontendDir, testFile)], {
            cwd: frontendDir,
            encoding: "utf8",
            env: {
              ...process.env,
              LOGOS_VITEST_CACHE_DIR: vitestCacheDir,
              NODE_ENV: "test",
            },
          })
          if (workspace) wsMgr.reindex(workspace.id)
          res.end(JSON.stringify({ ok: true, testFile }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: String(e) }))
        }
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

function autoStorybook(runtime: StudioRuntime): Plugin {
  return {
    name: "auto-storybook",
    configureServer() {
      const { caps, sbManager, wsMgr } = runtime
      sbManager.cleanupAll()
      // Ensure Storybooks are running for all existing workspaces
      for (const wsMeta of wsMgr.list()) {
        if (!sbManager.get(wsMeta.id) && caps.storybook) {
          const ws = wsMgr.get(wsMeta.id)
          if (!ws) continue
          const wsFrontend = join(ws.forkDir, "frontend")
          sbManager.ensure(wsMeta.id, wsFrontend).catch((e: any) =>
            console.error(`[storybook-mgr] failed to restart ${wsMeta.id}:`, e.message)
          )
        }
      }
      const cleanup = () => { wsMgr.abortAll(); sbManager.shutdownAll() }
      process.on("exit", cleanup)
      process.on("SIGINT", () => { cleanup(); process.exit() })
      process.on("SIGTERM", () => { cleanup(); process.exit() })
    },
  }
}

export default defineConfig(async ({ command }) => {
  const runtime = command === "serve" ? await createStudioRuntime() : null

  return {
    cacheDir: process.env.LOGOS_VITE_CACHE_DIR || undefined,
    plugins: runtime
      ? [authPlugin(), portableStoriesPlugin(runtime), react(), studioApi(runtime), storybookProxyPlugin(runtime.sbManager), autoStorybook(runtime)]
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
