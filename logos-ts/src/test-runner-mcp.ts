#!/usr/bin/env node
// Generic test-runner MCP server. Watches for file changes, auto-runs a
// command, exposes results via test_results(). Fully declarative — all
// config comes from a JSON blob on argv[2]:
//
//   { "cwd": "/path/to/project",
//     "command": ["node", "scripts/healthcheck.mjs"],
//     "watch": ["frontend/src", "backend"],
//     "filePattern": "\\.(tsx?|jsx?)$" }
//
/* eslint-disable functional/no-let, functional/immutable-data, functional/no-loop-statements, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-confusing-void-expression, @typescript-eslint/no-deprecated, @typescript-eslint/no-unsafe-argument */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { execFile } from "node:child_process"
import { watch } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

const config = JSON.parse(process.argv[2] || "{}")
const cwd: string = config.cwd
const commandArray: string[] = config.command ?? ["echo", "no command configured"]
const cmdValue = commandArray[0]
const cmdArgs = commandArray.slice(1)
const watchDirs: string[] = config.watch ?? []
const filePattern = new RegExp(config.filePattern ?? "\\.(tsx?|jsx?)$")

if (!cwd) {
  process.stderr.write("test-runner-mcp: config.cwd is required\n")
  process.exit(1)
}

if (cmdValue == null) {
  process.stderr.write("test-runner-mcp: config.command is required\n")
  process.exit(1)
}

const cmd: string = cmdValue

// --- state ---

type Run = {
  id: number
  status: "running" | "passed" | "failed" | "error"
  startedAt: number
  finishedAt: number | null
  output: string | null
  error: string | null
}

let runCounter = 0
let currentRun: Run | null = null
let lastCompleted: Run | null = null
const waiters: (() => void)[] = []

function startRun() {
  if (currentRun?.status === "running") return

  const run: Run = {
    id: ++runCounter,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    output: null,
    error: null,
  }
  currentRun = run

  execFile(cmd, cmdArgs, { cwd, timeout: 120_000 }, (err: Error | null, stdout: string, stderr: string) => {
    run.finishedAt = Date.now()
    run.output = stdout || null
    if (err && !stdout) {
      run.status = "error"
      run.error = stderr || err.message
    } else {
      try {
        const parsed = JSON.parse(stdout)
        run.status = (parsed.failed ?? 0) > 0 ? "failed" : "passed"
      } catch {
        run.status = err ? "failed" : "passed"
      }
    }
    lastCompleted = run
    if (currentRun === run) currentRun = null
    for (const w of waiters.splice(0)) w()
  })
}

// --- file watcher ---

const DEBOUNCE_MS = 1500
let debounce: ReturnType<typeof setTimeout> | null = null

function onFileChange(filename: string | null) {
  if (!filename || !filePattern.test(filename)) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(startRun, DEBOUNCE_MS)
}

for (const dir of watchDirs) {
  try {
    watch(resolve(cwd, dir), { recursive: true }, (_event, filename) => onFileChange(filename))
  } catch { /* dir may not exist */ }
}

startRun()

// --- MCP server ---

const server = new McpServer({ name: "test-runner", version: "0.1.0" })

server.tool(
  "test_results",
  "Get the latest test results. Tests auto-run on every file change. Call with wait_for_completion=true to block until the current run finishes.",
  { wait_for_completion: z.boolean().default(false) },
  async ({ wait_for_completion }) => {
    if (wait_for_completion && currentRun?.status === "running") {
      await new Promise<void>((res) => waiters.push(res))
    }

    const run = lastCompleted
    if (!run) {
      const msg = currentRun?.status === "running"
        ? "Tests are running (first run). Call again with wait_for_completion=true to wait."
        : "No test results yet."
      return { content: [{ type: "text" as const, text: msg }] }
    }

    const elapsed = ((run.finishedAt! - run.startedAt) / 1000).toFixed(1)
    const lines = [`Run #${run.id} — ${run.status} (${elapsed}s)`]
    if (run.output) lines.push("", run.output.trim())
    if (run.error) lines.push("", `Error: ${run.error}`)
    if (currentRun?.status === "running") lines.push("", "(a new test run is in progress)")

    return { content: [{ type: "text" as const, text: lines.join("\n") }] }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
