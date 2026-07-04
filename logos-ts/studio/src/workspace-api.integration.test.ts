import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const STUDIO_SRC = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(STUDIO_SRC, "..")

let projectRoot: string
let binDir: string
let agentRuns: string
let server: ChildProcess
let baseUrl: string
let signalFile: string
let envLogFile: string
let requireApiKeyFile: string
let configFile: string
const TEST_TIMEOUT = 20_000
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

interface WorkspaceMeta {
  id: string
  kind: "code"
  parentId: string | null
  goals: Goal[]
  initialization?: WorkspaceInitialization
}

interface WorkspaceState extends WorkspaceMeta {
  forkDir: string
}

interface WorkspaceInitialization {
  status: "initializing" | "ready" | "error"
  steps: { id: string; status: string; output?: string }[]
}

interface Goal {
  id: string
  label?: string
  mode: "code"
  status?: "pending" | "running" | "done" | "error"
  workspaceId?: string
}

interface ArchWorkspaceEnvelope {
  workspace: { id: string; kind: "code"; activeSnapshotId: string }
}

interface ArchTreeResponse {
  workspaceId: string
  nodes: { id: string; kind: string; label: string; path: string; target?: string }[]
}

interface ArchContentResponse {
  nodeId: string
  title: string
  sections: { kind: string; title: string }[]
}

interface ArchEvaluationResponse {
  workspaceId: string
  checks: { id: string; kind: string; status: string }[]
  previews: { id: string; kind: string; label: string }[]
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-api-project-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(root, "src/index.ts"), "export function answer(): number { return 42 }\n")
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git("init", "-b", "main")
  git("config", "user.email", "logos@example.com")
  git("config", "user.name", "Logos Test")
  git("add", "-A")
  git("commit", "-m", "initial")
  const bare = join(dirname(root), `${root.split("/").pop()}-origin.git`)
  execFileSync("git", ["clone", "--bare", root, bare], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  git("remote", "add", "origin", bare)
  git("fetch", "origin")
  return root
}

function createFakeClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-fake-claude-"))
  signalFile = join(dir, "signals.log")
  envLogFile = join(dir, "env.log")
  requireApiKeyFile = join(dir, "require-api-key")
  const script = join(dir, "claude")
  writeFileSync(script, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs')",
    "if (process.env.FAKE_CLAUDE_ENV_LOG) {",
    "  fs.appendFileSync(process.env.FAKE_CLAUDE_ENV_LOG, JSON.stringify({",
    "    anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,",
    "    claudeCodeSessionId: process.env.CLAUDE_CODE_SESSION_ID || null,",
    "    claudeCodeChildSession: process.env.CLAUDE_CODE_CHILD_SESSION || null,",
    "    aiAgent: process.env.AI_AGENT || null,",
    "  }) + '\\n')",
    "}",
    "if (process.env.FAKE_CLAUDE_REQUIRE_API_KEY_FILE && fs.existsSync(process.env.FAKE_CLAUDE_REQUIRE_API_KEY_FILE) && !process.env.ANTHROPIC_API_KEY) {",
    "  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }))",
    "  console.error('Not logged in · Please run /login')",
    "  process.exit(1)",
    "}",
    "process.on('SIGTERM', () => {",
    "  if (process.env.FAKE_CLAUDE_SIGNALS) fs.appendFileSync(process.env.FAKE_CLAUDE_SIGNALS, 'SIGTERM\\n')",
    "  process.exit(143)",
    "})",
    "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session' }))",
    "setTimeout(() => process.exit(0), 15000)",
    "",
  ].join("\n"))
  chmodSync(script, 0o755)
  return dir
}

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts)
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

async function waitFor(assertion: () => void, timeoutMs = TEST_TIMEOUT): Promise<void> {
  const start = Date.now()
  let lastError: unknown
  while (Date.now() - start < timeoutMs) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await sleep(100)
    }
  }
  throw lastError
}

function fakeClaudeSignals(): string {
  return signalFile && existsSync(signalFile) ? readFileSync(signalFile, "utf8") : ""
}

function fakeClaudeEnvEntries(): {
  anthropicApiKey: string | null
  claudeCodeSessionId: string | null
  claudeCodeChildSession: string | null
  aiAgent: string | null
}[] {
  if (!envLogFile || !existsSync(envLogFile)) return []
  return readFileSync(envLogFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as {
      anthropicApiKey: string | null
      claudeCodeSessionId: string | null
      claudeCodeChildSession: string | null
      aiAgent: string | null
    })
}

async function stopServer(): Promise<void> {
  if (!server?.pid) return
  const exited = new Promise<void>((resolve) => server.once("close", () => resolve()))
  try { process.kill(-server.pid, "SIGTERM") } catch {}
  server.kill()
  await Promise.race([exited, sleep(5_000)])
}

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      return
    } catch (error) {
      if (attempt === 19) throw error
      await sleep(100)
    }
  }
}

function jsonPost(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function waitForServer(proc: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start\n${buf}`)), timeoutMs)
    let buf = ""
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

async function createWorkspace(kind: "code" | "arch" = "code", fromWorkspaceId?: string): Promise<WorkspaceMeta> {
  const res = await jsonPost("/api/workspaces", { kind, fromWorkspaceId })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`createWorkspace failed (${res.status}): ${body}`)
  }
  return await res.json() as WorkspaceMeta
}

async function addGoal(
  workspaceId: string,
  mode: "code" | "arch",
  fork = true,
): Promise<{ res: Response; body: Goal & { error?: string } }> {
  const res = await jsonPost(`/api/workspaces/${workspaceId}/goals`, {
    target: "fn:answer",
    label: "answer",
    text: `${mode} change`,
    mode,
    fork,
  })
  return { res, body: await res.json() as Goal & { error?: string } }
}

async function readWorkspace(id: string): Promise<WorkspaceMeta> {
  const res = await api(`/api/workspaces/${id}`)
  expect(res.ok).toBe(true)
  return await res.json() as WorkspaceMeta
}

async function listWorkspaces(): Promise<WorkspaceMeta[]> {
  const res = await api("/api/workspaces")
  expect(res.ok).toBe(true)
  return await res.json() as WorkspaceMeta[]
}

async function waitForWorkspaceReady(id: string, timeoutMs = TEST_TIMEOUT): Promise<WorkspaceMeta> {
  const start = Date.now()
  let latest: WorkspaceMeta | null = null
  while (Date.now() - start < timeoutMs) {
    latest = await readWorkspace(id)
    if (!latest.initialization || latest.initialization.status === "ready") return latest
    if (latest.initialization.status === "error") {
      throw new Error(`workspace initialization failed: ${JSON.stringify(latest.initialization.steps)}`)
    }
    await sleep(100)
  }
  throw new Error(`workspace ${id} initialization did not finish; latest status: ${latest?.initialization?.status ?? "unknown"}`)
}

async function createArchWorkspaceViaArchApi(): Promise<ArchWorkspaceEnvelope["workspace"]> {
  const res = await jsonPost("/api/arch/workspaces", {})
  expect(res.ok).toBe(true)
  const body = await res.json() as ArchWorkspaceEnvelope
  return body.workspace
}

async function readSseEvent(res: Response): Promise<Record<string, unknown>> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error("response has no body")
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) throw new Error(`SSE stream ended before an event arrived: ${buffer}`)
    buffer += decoder.decode(value, { stream: true })
    const boundary = buffer.indexOf("\n\n")
    if (boundary === -1) continue
    const frame = buffer.slice(0, boundary)
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
    reader.releaseLock()
    return JSON.parse(data) as Record<string, unknown>
  }
}

describe("workspace API mode isolation", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    binDir = createFakeClaude()
    configFile = join(binDir, "config.json")
    writeFileSync(configFile, JSON.stringify({ anthropic_api_key: "sk-ant-integration-test" }))
    agentRuns = mkdtempSync(join(tmpdir(), "logos-api-agent-runs-"))
    server = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "0"], {
      cwd: STUDIO,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        LOGOS_PROJECT: projectRoot,
        LOGOS_AGENT_RUNS_DIR: agentRuns,
        FAKE_CLAUDE_SIGNALS: signalFile,
        FAKE_CLAUDE_ENV_LOG: envLogFile,
        FAKE_CLAUDE_REQUIRE_API_KEY_FILE: requireApiKeyFile,
        LOGOS_CONFIG_PATH: configFile,
        ANTHROPIC_API_KEY: "sk-ant-integration-test",
        CLAUDE_CODE_CHILD_SESSION: "1",
        CLAUDE_CODE_SESSION_ID: "parent-session",
        AI_AGENT: "claude-code_2-1-183_agent",
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    })
    baseUrl = await waitForServer(server, 90_000)
  }, 120_000)

  afterAll(async () => {
    await stopServer()
    if (projectRoot) await removeTempDir(projectRoot)
    if (binDir) await removeTempDir(binDir)
    if (agentRuns) await removeTempDir(agentRuns)
  }, 20_000)

  it("creates code workspaces and normalizes legacy arch workspace requests", async () => {
    const code = await createWorkspace()
    const arch = await createWorkspace("arch")

    expect(code.kind).toBe("code")
    expect(arch.kind).toBe("code")
  }, TEST_TIMEOUT)

  it("keeps code goals in code workspaces", async () => {
    const code = await createWorkspace("code")
    const { res, body } = await addGoal(code.id, "code")

    expect(res.ok).toBe(true)
    expect(body.workspaceId).toBe(code.id)
    expect(body.mode).toBe("code")

    const updated = await readWorkspace(code.id)
    expect(updated.goals.map((g) => g.id)).toContain(body.id)
  }, TEST_TIMEOUT)

  it("resets all workspaces and starts a fresh replacement workspace", async () => {
    const first = await createWorkspace("code")
    const second = await createWorkspace("code")
    const goal = await addGoal(first.id, "code")
    expect(goal.res.ok).toBe(true)

    const firstState = await readWorkspace(first.id) as WorkspaceState
    const secondState = await readWorkspace(second.id) as WorkspaceState
    expect(existsSync(firstState.forkDir)).toBe(true)
    expect(existsSync(secondState.forkDir)).toBe(true)

    const resetRes = await api("/api/reset", { method: "POST" })
    expect(resetRes.ok).toBe(true)
    const resetBody = await resetRes.json() as { ok: boolean; workspace: WorkspaceMeta }
    expect(resetBody.ok).toBe(true)
    expect(resetBody.workspace.id).not.toBe(first.id)
    expect(resetBody.workspace.id).not.toBe(second.id)
    expect(resetBody.workspace.goals).toEqual([])

    const workspaces = await listWorkspaces()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([resetBody.workspace.id])
    expect(await api(`/api/workspaces/${first.id}`)).toMatchObject({ status: 404 })
    expect(await api(`/api/workspaces/${second.id}`)).toMatchObject({ status: 404 })
    expect(existsSync(firstState.forkDir)).toBe(false)
    expect(existsSync(secondState.forkDir)).toBe(false)
  }, TEST_TIMEOUT)

  it("returns a goal immediately with a fallback name when no goalName is provided", async () => {
    const code = await createWorkspace("code")
    const res = await jsonPost(`/api/workspaces/${code.id}/goals`, {
      target: "fn:answer",
      label: "answer",
      text: "make the dashboard load faster",
      mode: "code",
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as Goal
    expect(body.label).toBe("Make Dashboard Load Faster")
  }, TEST_TIMEOUT)

  it("uses the provided goalName when one is given", async () => {
    const code = await createWorkspace("code")
    const res = await jsonPost(`/api/workspaces/${code.id}/goals`, {
      target: "fn:answer",
      label: "answer",
      text: "make it faster",
      mode: "code",
      goalName: "Speed Up Dashboard",
    })
    expect(res.ok).toBe(true)
    const body = await res.json() as Goal
    expect(body.label).toBe("Speed Up Dashboard")
  }, TEST_TIMEOUT)

  it("creates a queryable session as soon as the agent SSE stream starts", async () => {
    const code = await createWorkspace("code")
    await waitForWorkspaceReady(code.id)
    const { res: goalRes, body: goal } = await addGoal(code.id, "code")
    expect(goalRes.ok).toBe(true)

    const controller = new AbortController()
    const runRes = await fetch(`${baseUrl}/api/agent/run?workspace=${code.id}&goal=${goal.id}`, {
      signal: controller.signal,
    })
    expect(runRes.ok).toBe(true)

    const firstEvent = await readSseEvent(runRes)
    expect(firstEvent).toMatchObject({
      type: "status",
      goalId: goal.id,
      message: "preparing workspace instance…",
    })

    const sessionRes = await api(`/api/sessions?goal=${encodeURIComponent(goal.id)}`)
    expect(sessionRes.ok).toBe(true)
    const sessionBody = await sessionRes.json() as {
      session: { goalId: string; workspaceId: string }
      events: { type: string; payload: string }[]
    }
    expect(sessionBody.session).toMatchObject({ goalId: goal.id, workspaceId: code.id })
    expect(sessionBody.events[0]).toMatchObject({ type: "status" })
    expect(JSON.parse(sessionBody.events[0]!.payload)).toMatchObject({
      type: "status",
      goalId: goal.id,
      message: "preparing workspace instance…",
    })

    await runRes.body?.cancel()
    controller.abort()
  }, TEST_TIMEOUT)

  it("preserves Anthropic API-key auth for spawned Claude agents", async () => {
    writeFileSync(requireApiKeyFile, "1")
    try {
      const envEntryCountBeforeRun = fakeClaudeEnvEntries().length
      const code = await createWorkspace("code")
      await waitForWorkspaceReady(code.id)
      const { res: goalRes, body: goal } = await addGoal(code.id, "code")
      expect(goalRes.ok).toBe(true)

      const controller = new AbortController()
      const runRes = await fetch(`${baseUrl}/api/agent/run?workspace=${code.id}&goal=${goal.id}`, {
        signal: controller.signal,
      })
      expect(runRes.ok).toBe(true)

      await waitFor(() => {
        const entries = fakeClaudeEnvEntries()
        expect(entries.length).toBeGreaterThan(envEntryCountBeforeRun)
        const latest = entries[entries.length - 1]
        expect(latest).toMatchObject({
          anthropicApiKey: "sk-ant-integration-test",
          claudeCodeSessionId: null,
          claudeCodeChildSession: null,
          aiAgent: null,
        })
      })

      await runRes.body?.cancel()
      controller.abort()
    } finally {
      rmSync(requireApiKeyFile, { force: true })
    }
  }, TEST_TIMEOUT)

  it("exposes an Arch product API without code payloads", async () => {
    const arch = await createArchWorkspaceViaArchApi()
    await waitForWorkspaceReady(arch.id)

    const treeRes = await api(`/api/arch/workspaces/${arch.id}/tree`)
    expect(treeRes.ok).toBe(true)
    const tree = await treeRes.json() as ArchTreeResponse
    expect(tree.workspaceId).toBe(arch.id)
    const answerNode = tree.nodes.find((node) => node.target === "fn:answer")
    expect(answerNode).toBeDefined()
    expect(JSON.stringify(tree)).not.toContain("return 42")

    const contentRes = await api(`/api/arch/workspaces/${arch.id}/content?nodeId=${encodeURIComponent(answerNode!.id)}`)
    expect(contentRes.ok).toBe(true)
    const content = await contentRes.json() as ArchContentResponse
    expect(content.nodeId).toBe(answerNode!.id)
    expect(content.sections.some((section) => section.kind === "contract")).toBe(true)
    expect(JSON.stringify(content)).not.toContain("return 42")

    const evaluationRes = await api(`/api/arch/workspaces/${arch.id}/evaluation`)
    expect(evaluationRes.ok).toBe(true)
    const evaluation = await evaluationRes.json() as ArchEvaluationResponse
    expect(evaluation.workspaceId).toBe(arch.id)
    expect(evaluation.checks.some((check) => check.kind === "test")).toBe(true)

    const goalRes = await jsonPost(`/api/arch/workspaces/${arch.id}/goals`, {
      targetNodeId: answerNode!.id,
      label: "answer",
      text: "Make the answer configurable",
    })
    expect(goalRes.ok).toBe(true)
    const goal = await goalRes.json() as { goalId: string; workspaceId: string; goal: Goal }
    expect(goal.workspaceId).toBe(arch.id)
    expect(goal.goal.mode).toBe("code")
  }, TEST_TIMEOUT)
})
