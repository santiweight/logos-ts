import { defineConfig, type Plugin, type Connect } from "vite"
import react from "@vitejs/plugin-react"
import { execFile, execFileSync, spawn } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, cpSync, symlinkSync, watch } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, relative, join } from "node:path"
import * as commentDb from "../src/comment-db"

const STUDIO = dirname(fileURLToPath(import.meta.url))
const LOGOS_TS = resolve(STUDIO, "..")
const HN = resolve(STUDIO, "../../hn-jobs")
const FRONTEND = resolve(HN, "frontend")
const tsx = resolve(LOGOS_TS, "node_modules/.bin/tsx")
const vitest = resolve(FRONTEND, "node_modules/.bin/vitest")
const LEGACY_COMMENTS = resolve(STUDIO, "comments.json")
const WS_DIR = resolve(STUDIO, ".workspaces")

type SqliteDb = Awaited<ReturnType<typeof commentDb.open>>
let _commentConn: SqliteDb | null = null
async function commentConn(): Promise<SqliteDb> {
  if (_commentConn) return _commentConn
  _commentConn = await commentDb.open(HN)
  await commentDb.migrateStudioJson(_commentConn, LEGACY_COMMENTS)
  return _commentConn
}

const loadWorkspaceMetas = () => {
  if (!existsSync(WS_DIR)) return []
  return readdirSync(WS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const { index, ...meta } = JSON.parse(readFileSync(resolve(WS_DIR, f), "utf8"))
      return meta
    })
}

// Snapshot the current architecture/index — the "fork".
const snapshotIndex = () =>
  JSON.parse(
    execFileSync(tsx, [resolve(LOGOS_TS, "src/build-index.ts"), HN, "-"], {
      cwd: LOGOS_TS,
      encoding: "utf8",
    })
  )

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => res(b))
  })
}

// Expose logos-ts as a tiny dev API for the studio (index + capture).
function studioApi(): Plugin {
  return {
    name: "logos-ts-studio-api",
    configureServer(server) {
      server.middlewares.use("/api/index", (_req, res) => {
        const json = execFileSync(tsx, [resolve(LOGOS_TS, "src/build-index.ts"), HN, "-"], {
          cwd: LOGOS_TS,
          encoding: "utf8",
        })
        res.setHeader("content-type", "application/json")
        res.end(json)
      })

      // Persistent test runner — starts on boot, re-runs on file changes.
      type TestState = {
        status: "running" | "pass" | "fail" | "idle"
        results: { total: number; passed: number; failed: number; failures: { test: string; file: string; message: string }[] } | null
        runningSince: number | null
      }
      const testState: TestState = { status: "idle", results: null, runningSince: null }

      const runTests = () => {
        if (testState.status === "running") return
        testState.status = "running"
        testState.runningSince = Date.now()
        execFile("node", ["scripts/healthcheck.mjs"], { cwd: HN, timeout: 120_000 }, (_err, stdout) => {
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

      // Watch source dirs for changes and re-run.
      const DEBOUNCE_MS = 1500
      let debounce: ReturnType<typeof setTimeout> | null = null
      const onFileChange = (filename: string | null) => {
        if (!filename || !/\.(tsx?|jsx?)$/.test(filename)) return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(runTests, DEBOUNCE_MS)
      }
      for (const dir of ["frontend/src", "backend", "shared"]) {
        try { watch(resolve(HN, dir), { recursive: true }, (_ev, f) => onFileChange(f)) } catch { /* dir may not exist */ }
      }
      runTests() // kick off immediately on server start

      server.middlewares.use("/api/test-results", (_req, res) => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify(testState))
      })

      server.middlewares.use("/api/workspaces", async (req, res) => {
        res.setHeader("content-type", "application/json")
        const sub = (req.url || "/").replace(/^\//, "").split("?")[0] // "" or "ws-123"
        if (req.method === "GET") {
          if (sub) {
            const p = resolve(WS_DIR, `${sub}.json`)
            if (!existsSync(p)) {
              res.statusCode = 404
              res.end("{}")
              return
            }
            res.end(readFileSync(p, "utf8"))
            return
          }
          res.end(JSON.stringify(loadWorkspaceMetas()))
          return
        }
        if (req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}")
          const id = `ws-${Date.now()}`
          // Branch from an existing workspace's copy, or snapshot base.
          const fromId = body.fromWorkspaceId as string | undefined
          const fromPath = fromId ? resolve(WS_DIR, `${fromId}.json`) : null
          const index =
            fromPath && existsSync(fromPath) ? JSON.parse(readFileSync(fromPath, "utf8")).index : snapshotIndex()
          const ws = {
            id,
            name: String(body.name ?? "workspace"),
            parentId: fromId ?? null,
            createdAt: Date.now(),
            index,
          }
          if (!existsSync(WS_DIR)) mkdirSync(WS_DIR, { recursive: true })
          writeFileSync(resolve(WS_DIR, `${id}.json`), JSON.stringify(ws))
          const { index: _omit, ...meta } = ws
          res.end(JSON.stringify(meta))
          return
        }
        if (req.method === "DELETE" && sub) {
          rmSync(resolve(WS_DIR, `${sub}.json`), { force: true })
          const db = await commentConn()
          commentDb.removeByWorkspace(db, sub)
          res.end(JSON.stringify({ ok: true }))
          return
        }
        res.statusCode = 405
        res.end()
      })

      // Live agent run over SSE: materialize a real fork, spawn `claude` to
      // address the workspace's comments, and stream its tool-call events.
      server.middlewares.use("/api/agent/run", async (req, res) => {
        const wsId = new URL(req.url || "", "http://x").searchParams.get("workspace") || ""
        res.setHeader("content-type", "text/event-stream")
        res.setHeader("cache-control", "no-cache")
        res.setHeader("connection", "keep-alive")
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)

        const wsPath = resolve(WS_DIR, `${wsId}.json`)
        if (!wsId || !existsSync(wsPath)) {
          send({ type: "error", message: "no such workspace" })
          return res.end()
        }
        const ws = JSON.parse(readFileSync(wsPath, "utf8"))
        const db = await commentConn()
        const allComments = commentDb.list(db)
        const changes = allComments.filter((c) => c.workspaceId === wsId)
        if (!changes.length) {
          send({ type: "error", message: "this workspace has no changes to address" })
          return res.end()
        }

        // Fork OUTSIDE the studio root so Vite never watches/serves it.
        const RUNS = resolve(STUDIO, "..", ".agent-runs")
        const dir = resolve(RUNS, wsId)
        if (!existsSync(dir)) {
          send({ type: "status", message: "forking working copy…" })
          mkdirSync(RUNS, { recursive: true })
          cpSync(HN, dir, {
            recursive: true,
            filter: (s) => !/node_modules|\.workspaces|\.logos_cache|dist|__snapshots__/.test(s),
          })
          const deps = join(HN, "frontend/node_modules")
          symlinkSync(deps, join(dir, "frontend/node_modules"))
          symlinkSync(deps, join(dir, "node_modules"))
        }

        // Architecture mode: strip every function/method body to a stub so the
        // agent edits a signatures-only "architecture view".
        const mode = new URL(req.url || "", "http://x").searchParams.get("mode") || "code"
        const bodiesFile = resolve(RUNS, `${wsId}.bodies.json`)
        if (mode === "arch") {
          send({ type: "status", message: "stripping to architecture view…" })
          try {
            execFileSync(tsx, [resolve(LOGOS_TS, "src/archmode.ts"), "strip", dir, bodiesFile], {
              cwd: LOGOS_TS,
              encoding: "utf8",
            })
          } catch (e) {
            send({ type: "stderr", message: "strip failed: " + String(e) })
          }
        }

        // Pre-load architecture context (recursive descent over the change's deps)
        // so the agent skips discovery entirely.
        send({ type: "status", message: "building architecture context…" })
        const targets = [...new Set(changes.map((c: { target: string }) => c.target))]
        let context = ""
        try {
          context = execFileSync(tsx, [resolve(LOGOS_TS, "src/context.ts"), dir, "40000", ...targets], {
            cwd: LOGOS_TS,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
          })
        } catch (e) {
          send({ type: "stderr", message: "context build failed: " + String(e) })
        }

        const list = changes.map((c: { label: string; text: string }) => `- (${c.label}) ${c.text}`).join("\n")
        const prompt =
          mode === "arch"
            ? `${context}\n\n` +
              `You are in ARCHITECTURE MODE. The code is shown as pure SIGNATURES using \`declare\` — no bodies, no \`=\`, no values (e.g. \`export declare function parseJob(text: string): ParsedJob\`, \`export declare const TECH_KEYWORDS: TechKeyword[]\`, \`declare class JobStore { upsertJob(job: Job): Job }\`). The real implementations, values, and imports are filled back in automatically after you finish.\n\n` +
              `Restructure the ARCHITECTURE to satisfy the change: move / split / rename / add these \`declare\` signatures across files (you may create and delete files). Keep everything as bare \`declare\` declarations — do NOT write bodies, values, or import statements. Just shape the signatures and where they live. Do not run tests.\n\n` +
              `Change requests:\n${list}\n`
            : `${context}\n\n` +
              `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. Open a file only to read or edit an implementation body you must change (its path is the header in the context).\n\n` +
              `Address these change requests:\n${list}\n\n` +
              `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck. ` +
              `Do NOT run tests yourself. Tests auto-run on every file save via the test-runner MCP. ` +
              `After making changes, call \`test_results(wait_for_completion=true)\` to wait for the auto-triggered run to finish and see the results. ` +
              `Iterate until the tests relevant to your change pass; ignore pre-existing stub failures you didn't cause. ` +
              `Always check test_results before finishing — do not consider your work done until tests pass.`

        send({ type: "status", message: "starting agent…" })
        const testRunnerConfig = JSON.stringify({
          cwd: dir,
          command: ["node", "scripts/healthcheck.mjs"],
          watch: ["frontend/src", "backend", "shared"],
          filePattern: "\\.(tsx?|jsx?)$",
        })
        const mcpConfig = {
          mcpServers: {
            "test-runner": {
              command: tsx,
              args: [resolve(LOGOS_TS, "src/test-runner-mcp.ts"), testRunnerConfig],
            },
          },
        }
        const mcpConfigPath = resolve(RUNS, `${wsId}.mcp.json`)
        writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig))

        const child = spawn(
          "claude",
          ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--mcp-config", mcpConfigPath],
          { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }
        )
        let buf = ""
        child.stdout.on("data", (d) => {
          buf += d.toString()
          let i
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i)
            buf = buf.slice(i + 1)
            if (!line.trim()) continue
            try {
              send({ type: "event", event: JSON.parse(line) })
            } catch {
              send({ type: "raw", line })
            }
          }
        })
        child.stderr.on("data", (d) => send({ type: "stderr", message: d.toString() }))
        child.on("error", (e) => send({ type: "error", message: String(e) }))
        child.on("close", (code) => {
          if (mode === "arch") {
            send({ type: "status", message: "splicing implementations + inferring imports…" })
            try {
              execFileSync(tsx, [resolve(LOGOS_TS, "src/archmode.ts"), "splice", dir, bodiesFile], {
                cwd: LOGOS_TS,
                encoding: "utf8",
              })
            } catch (e) {
              send({ type: "stderr", message: "splice failed: " + String(e) })
            }
          }
          try {
            ws.index = JSON.parse(
              execFileSync(tsx, [resolve(LOGOS_TS, "src/build-index.ts"), dir, "-"], {
                cwd: LOGOS_TS,
                encoding: "utf8",
              })
            )
            writeFileSync(wsPath, JSON.stringify(ws))
          } catch {
            /* re-index best effort */
          }
          rmSync(mcpConfigPath, { force: true })
          send({ type: "done", code })
          res.end()
        })
        req.on("close", () => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
        })
      })

      server.middlewares.use("/api/comments", async (req, res) => {
        res.setHeader("content-type", "application/json")
        const sub = (req.url || "/").replace(/^\//, "").split("?")[0]
        try {
          const db = await commentConn()
          if (req.method === "GET") {
            res.end(JSON.stringify(commentDb.list(db)))
            return
          }
          if (req.method === "DELETE" && sub) {
            commentDb.remove(db, sub)
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (req.method === "POST") {
            const body = JSON.parse((await readBody(req)) || "{}")
            const row = commentDb.insert(db, {
              id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
              target: String(body.target ?? ""),
              label: String(body.label ?? ""),
              text: String(body.text ?? ""),
              workspaceId: body.workspaceId ?? null,
              mode: body.mode === "arch" ? "arch" : "code",
              createdAt: Date.now(),
              storyId: body.storyId ?? null,
              selector: body.selector ?? null,
              component: body.component ?? null,
            })
            res.end(JSON.stringify(row))
            return
          }
          res.statusCode = 405
          res.end()
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })

      server.middlewares.use("/api/capture", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          return res.end()
        }
        res.setHeader("content-type", "application/json")
        try {
          const { storyRef } = JSON.parse((await readBody(req)) || "{}")
          // 1) write the captured test
          const out = execFileSync(tsx, [resolve(LOGOS_TS, "src/capture.ts"), HN, storyRef], {
            cwd: LOGOS_TS,
            encoding: "utf8",
          })
          const testFile = (out.match(/captured -> (.+)/)?.[1] ?? "").trim()
          // 2) run vitest to write the snapshot (the oracle)
          execFileSync(vitest, ["run", relative(FRONTEND, testFile)], {
            cwd: FRONTEND,
            encoding: "utf8",
          })
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
  let child: ReturnType<typeof spawn> | null = null
  return {
    name: "auto-storybook",
    configureServer() {
      const npx = resolve(FRONTEND, "node_modules/.bin/storybook")
      child = spawn(npx, ["dev", "-p", "6006", "--no-open"], {
        cwd: FRONTEND,
        stdio: ["ignore", "pipe", "pipe"],
      })
      child.stdout?.on("data", (d) => {
        const s = d.toString()
        if (s.includes("Local:")) console.log("[storybook] ready on :6006")
      })
      child.stderr?.on("data", () => {})
      child.on("error", (e) => console.error("[storybook]", e.message))
      process.on("exit", () => child?.kill())
      process.on("SIGINT", () => { child?.kill(); process.exit() })
      process.on("SIGTERM", () => { child?.kill(); process.exit() })
    },
  }
}

export default defineConfig({
  plugins: [react(), studioApi(), autoStorybook()],
  server: {
    port: 5180,
    // never watch agent forks / workspace snapshots (they'd force full reloads)
    watch: { ignored: ["**/.workspaces/**", "**/.agent-runs/**"] },
  },
})
