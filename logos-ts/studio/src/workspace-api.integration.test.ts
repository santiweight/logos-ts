import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
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
const TEST_TIMEOUT = 20_000
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g

interface WorkspaceMeta {
  id: string
  kind: "code" | "arch"
  parentId: string | null
  goals: Goal[]
}

interface Goal {
  id: string
  mode: "code" | "arch"
  status?: "pending" | "running" | "done" | "error"
  workspaceId?: string
}

interface WorkspacePolicyEvent {
  seq: number
  type: "arch_goal_redirected" | "goal_rejected" | "arch_agent_blocked"
  workspaceId: string
  goalId?: string
  message: string
  details?: Record<string, unknown>
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-api-project-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
  writeFileSync(join(root, "src/index.ts"), "export function answer(): number { return 42 }\n")
  return root
}

function createFakeClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-fake-claude-"))
  signalFile = join(dir, "signals.log")
  const script = join(dir, "claude")
  writeFileSync(script, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs')",
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

function fakeClaudeSignals(): string {
  return signalFile && existsSync(signalFile) ? readFileSync(signalFile, "utf8") : ""
}

function removeTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
  expect(res.ok).toBe(true)
  return await res.json() as WorkspaceMeta
}

async function addGoal(
  workspaceId: string,
  mode: "code" | "arch",
  fork = false,
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

async function readPolicyEvents(workspaceId?: string): Promise<WorkspacePolicyEvent[]> {
  const query = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""
  const res = await api(`/api/workspace-policy-events${query}`)
  expect(res.ok).toBe(true)
  const body = await res.json() as { events: WorkspacePolicyEvent[] }
  return body.events
}

describe("workspace API mode isolation", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    binDir = createFakeClaude()
    agentRuns = mkdtempSync(join(tmpdir(), "logos-api-agent-runs-"))
    server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "0"], {
      cwd: STUDIO,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: {
        ...process.env,
        LOGOS_PROJECT: projectRoot,
        LOGOS_AGENT_RUNS_DIR: agentRuns,
        FAKE_CLAUDE_SIGNALS: signalFile,
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    })
    baseUrl = await waitForServer(server, 90_000)
  }, 120_000)

  afterAll(() => {
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM") } catch {}
    }
    server?.kill()
    if (projectRoot) removeTempDir(projectRoot)
    if (binDir) removeTempDir(binDir)
    if (agentRuns) removeTempDir(agentRuns)
  })

  it("creates code workspaces by default and arch workspaces explicitly", async () => {
    const code = await createWorkspace()
    const arch = await createWorkspace("arch")

    expect(code.kind).toBe("code")
    expect(arch.kind).toBe("arch")
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

  it("forks arch goals from code workspaces into dedicated arch workspaces", async () => {
    const code = await createWorkspace("code")
    const { res, body } = await addGoal(code.id, "arch")

    expect(res.ok).toBe(true)
    expect(body.workspaceId).toBeDefined()
    expect(body.workspaceId).not.toBe(code.id)

    const arch = await readWorkspace(body.workspaceId!)
    expect(arch.kind).toBe("arch")
    expect(arch.parentId).toBe(code.id)
    expect(arch.goals.map((g) => g.id)).toContain(body.id)

    const original = await readWorkspace(code.id)
    expect(original.goals.map((g) => g.id)).not.toContain(body.id)

    const events = await readPolicyEvents(code.id)
    expect(events).toContainEqual(expect.objectContaining({
      type: "arch_goal_redirected",
      workspaceId: code.id,
      goalId: body.id,
      message: "architecture goal placed in a dedicated architecture workspace",
      details: expect.objectContaining({
        sourceWorkspaceId: code.id,
        sourceWorkspaceKind: "code",
        targetWorkspaceId: body.workspaceId,
        targetWorkspaceKind: "arch",
        forkRequested: false,
      }),
    }))
  }, TEST_TIMEOUT)

  it("keeps multiple arch goals in the same arch workspace by default", async () => {
    const arch = await createWorkspace("arch")
    const first = await addGoal(arch.id, "arch")
    const second = await addGoal(arch.id, "arch")

    expect(first.res.ok).toBe(true)
    expect(second.res.ok).toBe(true)
    expect(first.body.workspaceId).toBe(arch.id)
    expect(second.body.workspaceId).toBe(arch.id)

    const updated = await readWorkspace(arch.id)
    expect(updated.goals.map((g) => g.id)).toEqual([first.body.id, second.body.id])
  }, TEST_TIMEOUT)

  it("forks an arch sibling when requested from an arch workspace", async () => {
    const arch = await createWorkspace("arch")
    const { res, body } = await addGoal(arch.id, "arch", true)

    expect(res.ok).toBe(true)
    expect(body.workspaceId).toBeDefined()
    expect(body.workspaceId).not.toBe(arch.id)

    const fork = await readWorkspace(body.workspaceId!)
    expect(fork.kind).toBe("arch")
    expect(fork.parentId).toBe(arch.id)
    expect(fork.goals.map((g) => g.id)).toEqual([body.id])
  }, TEST_TIMEOUT)

  it("rejects code goals in arch workspaces", async () => {
    const arch = await createWorkspace("arch")
    const { res, body } = await addGoal(arch.id, "code")

    expect(res.status).toBe(409)
    expect(body.error).toBe("code goals cannot be added to architecture workspaces")

    const events = await readPolicyEvents(arch.id)
    expect(events).toContainEqual(expect.objectContaining({
      type: "goal_rejected",
      workspaceId: arch.id,
      message: "code goals cannot be added to architecture workspaces",
      details: {
        workspaceKind: "arch",
        goalMode: "code",
      },
    }))
  }, TEST_TIMEOUT)

  it("blocks a second running architecture agent in the same arch workspace", async () => {
    const arch = await createWorkspace("arch")
    const first = await addGoal(arch.id, "arch")
    const second = await addGoal(arch.id, "arch")
    expect(first.res.ok).toBe(true)
    expect(second.res.ok).toBe(true)

    const controller = new AbortController()
    const firstRun = fetch(`${baseUrl}/api/agent/run?workspace=${arch.id}`, { signal: controller.signal })
    const firstRes = await firstRun
    expect(firstRes.ok).toBe(true)

    const secondRes = await fetch(`${baseUrl}/api/agent/run?workspace=${arch.id}`)
    const secondText = await secondRes.text()
    expect(secondText).toContain("architecture workspace already has a running agent")

    const events = await readPolicyEvents(arch.id)
    expect(events).toContainEqual(expect.objectContaining({
      type: "arch_agent_blocked",
      workspaceId: arch.id,
      goalId: first.body.id,
      message: "architecture workspace already has a running agent",
      details: {
        workspaceKind: "arch",
        runningGoalId: first.body.id,
      },
    }))

    await firstRes.body?.cancel()
    controller.abort()
    await sleep(500)

    expect(fakeClaudeSignals()).toBe("")
    const updated = await readWorkspace(arch.id)
    expect(updated.goals.find((g) => g.id === first.body.id)?.status).toBe("running")
  }, TEST_TIMEOUT)
})
