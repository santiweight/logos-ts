import { defineConfig, type Plugin, type Connect } from "vite"
import react from "@vitejs/plugin-react"
import { execFile, execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, watch, cpSync, existsSync, symlinkSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, join, relative } from "node:path"
import { detectProject } from "../src/detect-project"
import { StorybookManager } from "../src/storybook-manager"
import { WorkspaceManager, type WorkspaceKind } from "../src/workspace-manager"
import type { StudioIndex } from "../src/build-index"
import { ClaudeSessionManager } from "../src/claude-session-manager"
import { authPlugin } from "./server/auth"
import { publicStorybookUrl, storybookProxyPlugin } from "./server/storybook-proxy"
import { gcDevSessions, writeDevSessionPid } from "../src/dev-session-gc"

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

function copyProject(src: string): string {
  const sessionsDir = resolve(LOGOS_TS, ".dev-sessions")
  mkdirSync(sessionsDir, { recursive: true })
  const sessionId = `session-${Date.now()}`
  const ephDir = resolve(sessionsDir, sessionId)
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

const PROJECT_ROOT = copyProject(SOURCE_PROJECT)
const caps = detectProject(PROJECT_ROOT)
console.log(`[logos] project: ${caps.root}`)
console.log(`[logos] storybook: ${caps.storybook ? caps.storybook.configDir : "not found"}`)
console.log(`[logos] tests: ${caps.tests ? caps.tests.command.join(" ") : "not found"}`)
const tsx = resolve(LOGOS_TS, "node_modules/.bin/tsx")
const STUDIO_PORT_FILE = resolve(PROJECT_ROOT, ".logos", "studio-port")

const indexReady: Promise<StudioIndex> = new Promise((res, rej) => {
  const t0 = Date.now()
  console.log(`[logos] building index (background)…`)
  execFile(tsx, [resolve(LOGOS_TS, "src/build-index.ts"), PROJECT_ROOT, "-"], {
    cwd: LOGOS_TS, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }, (err, stdout) => {
    if (err) { rej(err); return }
    console.log(`[logos] index ready in ${Date.now() - t0}ms`)
    res(JSON.parse(stdout) as StudioIndex)
  })
})

const sbManager = new StorybookManager(
  resolve(PROJECT_ROOT, ".logos", "storybooks.json"),
  resolve(LOGOS_TS, "src"),
  PROJECT_ROOT,
)

const sessionMgr = new ClaudeSessionManager(resolve(PROJECT_ROOT, ".logos", "sessions.db"))

const wsMgr = new WorkspaceManager({
  wsDir: resolve(PROJECT_ROOT, ".workspaces"),
  runsDir: resolve(LOGOS_TS, ".agent-runs"),
  logosTsSrc: resolve(LOGOS_TS, "src"),
  logosTsRoot: LOGOS_TS,
  projectRoot: PROJECT_ROOT,
  caps,
  sbManager,
  sessions: sessionMgr,
  tsx,
  getIndex: () => indexReady,
})

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => res(b))
  })
}

function studioApi(): Plugin {
  return {
    name: "logos-ts-studio-api",
    configureServer(server) {
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
        res.end(JSON.stringify({ urls, states }))
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
        const wsId = new URL(req.url || "", "http://x").searchParams.get("workspace") || ""
        res.setHeader("content-type", "text/event-stream")
        res.setHeader("cache-control", "no-cache")
        res.setHeader("connection", "keep-alive")
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)

        const goalId = wsMgr.processNext(wsId, (evt) => {
          send(evt)
          if (evt.type === "done" || evt.type === "error") res.end()
        })
        if (!goalId) return res.end()

        req.on("close", () => wsMgr.abort(goalId))
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

function autoStorybook(): Plugin {
  return {
    name: "auto-storybook",
    configureServer() {
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

export default defineConfig({
  cacheDir: process.env.LOGOS_VITE_CACHE_DIR || undefined,
  plugins: [authPlugin(), react(), studioApi(), storybookProxyPlugin(sbManager), autoStorybook()],
  server: {
    // Bind a concrete address: the default "localhost" can end up IPv6-only,
    // and the page hangs whenever the browser resolves localhost to 127.0.0.1.
    host: process.env.LOGOS_HOST || "127.0.0.1",
    allowedHosts: ALLOWED_HOSTS,
    port: Number(process.env.PORT) || 0,
    strictPort: Boolean(process.env.PORT),
    hmr: process.env.LOGOS_DISABLE_HMR === "1" ? false : undefined,
    watch: { ignored: ["**/.workspaces/**", "**/.agent-runs/**"] },
  },
})
