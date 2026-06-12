import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const STUDIO_SRC = dirname(fileURLToPath(import.meta.url))
const STUDIO = resolve(STUDIO_SRC, "..")
const LOGOS_TS = resolve(STUDIO, "..")

let projectRoot: string
let binDir: string
let server: ChildProcess
let baseUrl: string
const TEST_TIMEOUT = 20_000

interface WorkspaceMeta {
  id: string
  kind: "code" | "arch"
  parentId: string | null
  goals: Goal[]
}

interface Goal {
  id: string
  mode: "code" | "arch"
  workspaceId?: string
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
  const script = join(dir, "claude")
  writeFileSync(script, [
    "#!/usr/bin/env node",
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

function jsonPost(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function waitForServer(proc: ChildProcess, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error("server did not start")), timeoutMs)
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      const m = buf.match(/Local:\s+(http:\/\/(?:127\.0\.0\.1|localhost):\d+)/)
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

describe("workspace API mode isolation", () => {
  beforeAll(async () => {
    projectRoot = createProject()
    binDir = createFakeClaude()
    server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "0"], {
      cwd: STUDIO,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LOGOS_PROJECT: projectRoot, PATH: `${binDir}:${process.env["PATH"] ?? ""}` },
    })
    baseUrl = await waitForServer(server)
  }, 45_000)

  afterAll(() => {
    server?.kill()
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true })
    if (binDir) rmSync(binDir, { recursive: true, force: true })
    rmSync(resolve(LOGOS_TS, ".agent-runs"), { recursive: true, force: true })
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

    controller.abort()
  }, TEST_TIMEOUT)
})
