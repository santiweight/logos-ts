import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { WorkspaceCodeService } from "./workspace-code-service.js"

const tempDirs: string[] = []

function createService() {
  const root = mkdtempSync(join(tmpdir(), "logos-workspace-code-service-"))
  tempDirs.push(root)
  const projectRoot = join(root, "project")
  const runsDir = join(root, ".agent-runs")
  mkdirSync(projectRoot, { recursive: true })
  writeFileSync(join(projectRoot, "package.json"), "{}\n")
  writeFileSync(join(projectRoot, "shared.txt"), "base\n")
  const service = new WorkspaceCodeService({ runsDir, projectRoot, nodeModulesDirs: [] })
  return { root, projectRoot, runsDir, service }
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("WorkspaceCodeService", () => {
  it("rebases independent instance changes cleanly", async () => {
    const { service, projectRoot } = createService()
    const base = service.createInstance("ws", projectRoot, {})
    const agent = service.createInstance("ws", base.materializedRoot, {})
    const active = service.createInstance("ws", base.materializedRoot, {})

    writeFileSync(join(agent.materializedRoot, "agent.txt"), "agent\n")
    writeFileSync(join(active.materializedRoot, "active.txt"), "active\n")

    const result = await service.rebaseInstance({ workspaceId: "ws", instance: agent, onto: active })

    expect(result.status).toBe("clean")
    expect(readFileSync(join(agent.materializedRoot, "agent.txt"), "utf8")).toBe("agent\n")
    expect(readFileSync(join(agent.materializedRoot, "active.txt"), "utf8")).toBe("active\n")
  })

  it("reports real rebase conflicts and leaves the instance in conflict state", async () => {
    const { service, projectRoot } = createService()
    const base = service.createInstance("ws", projectRoot, {})
    const agent = service.createInstance("ws", base.materializedRoot, {})
    const active = service.createInstance("ws", base.materializedRoot, {})

    writeFileSync(join(agent.materializedRoot, "shared.txt"), "agent\n")
    writeFileSync(join(active.materializedRoot, "shared.txt"), "active\n")

    const result = await service.rebaseInstance({ workspaceId: "ws", instance: agent, onto: active })

    expect(result.status).toBe("conflicts")
    expect(git(agent.materializedRoot, ["diff", "--name-only", "--diff-filter=U"]).trim()).toBe("shared.txt")
    expect(result.message).toMatch(/conflict|could not apply/i)
  })

  it("auto-resolves generated snapshot-only rebase conflicts", async () => {
    const { service, projectRoot } = createService()
    mkdirSync(join(projectRoot, "frontend", "__snapshots__"), { recursive: true })
    writeFileSync(join(projectRoot, "frontend", "__snapshots__", "stories.test.tsx.snap"), "base snapshot\n")
    const base = service.createInstance("ws", projectRoot, {})
    const agent = service.createInstance("ws", base.materializedRoot, {})
    const active = service.createInstance("ws", base.materializedRoot, {})

    writeFileSync(join(agent.materializedRoot, "frontend", "__snapshots__", "stories.test.tsx.snap"), "agent snapshot\n")
    writeFileSync(join(active.materializedRoot, "frontend", "__snapshots__", "stories.test.tsx.snap"), "active snapshot\n")

    const result = await service.rebaseInstance({ workspaceId: "ws", instance: agent, onto: active })

    expect(result.status).toBe("clean")
    expect(result.message).toContain("Auto-resolved generated snapshot")
    expect(git(agent.materializedRoot, ["diff", "--name-only", "--diff-filter=U"])).toBe("")
    expect(git(agent.materializedRoot, ["status", "--short"])).not.toContain("UU")
  })

  it("does not treat excluded untracked dependency and cache directories as changes", async () => {
    const { service, projectRoot } = createService()
    const base = service.createInstance("ws", projectRoot, {})
    const agent = service.createInstance("ws", base.materializedRoot, {})
    const active = service.createInstance("ws", base.materializedRoot, {})
    mkdirSync(join(agent.materializedRoot, ".logos_cache"), { recursive: true })
    mkdirSync(join(agent.materializedRoot, "frontend", "node_modules"), { recursive: true })
    writeFileSync(join(agent.materializedRoot, ".logos_cache", "run.json"), "{}\n")
    writeFileSync(join(agent.materializedRoot, "frontend", "node_modules", "dep.txt"), "dep\n")

    const result = await service.rebaseInstance({ workspaceId: "ws", instance: agent, onto: active })

    expect(result.status).toBe("clean")
    expect(git(agent.materializedRoot, ["status", "--porcelain"])).toContain(".logos_cache")
    expect(git(agent.materializedRoot, ["diff", "--cached", "--name-only"])).toBe("")
  })
})
