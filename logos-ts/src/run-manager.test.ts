import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LogosRuntimeStore } from "./runtime-store.js"
import { RunManager } from "./run-manager.js"
import type { RunTargetCaps } from "./detect-project.js"

const tempDirs: string[] = []

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-run-manager-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("RunManager", () => {
  it("starts pnpm app runs in CI mode", async () => {
    const root = makeTempDir()
    mkdirSync(join(root, "scripts"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "pnpm-run-app",
      private: true,
      packageManager: "pnpm@11.8.0",
      scripts: { dev: "node scripts/dev.mjs" },
    }))
    writeFileSync(join(root, "scripts/dev.mjs"), [
      "import http from 'node:http'",
      "if (process.env.CI !== 'true') {",
      "  console.error('expected CI mode')",
      "  process.exit(1)",
      "}",
      "const port = Number(process.env.PORT || '0')",
      "const server = http.createServer((_req, res) => res.end('ok'))",
      "server.listen(port, '127.0.0.1', () => {",
      "  const address = server.address()",
      "  console.log(`Local: http://127.0.0.1:${address.port}/`)",
      "})",
      "",
    ].join("\n"))

    const store = new LogosRuntimeStore(join(root, ".logos", "runtime.sqlite"))
    const manager = new RunManager(store, root)
    const target: RunTargetCaps = {
      id: "root-app",
      label: "App",
      cwd: root,
      command: "pnpm",
      args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "${PORT}", "--base", "${BASE}"],
      framework: "vite",
    }

    const url = await manager.ensure("ws-1", root, target)

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(manager.state("ws-1", "root-app")).toMatchObject({ status: "ready" })
    manager.shutdownAll()
  }, 20_000)
})
