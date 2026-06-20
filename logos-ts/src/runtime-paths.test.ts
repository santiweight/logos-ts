import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { defaultLogosRuntimeDir, resolveLogosRuntimePaths } from "./runtime-paths.js"

describe("Logos runtime paths", () => {
  it("puts default runtime state outside the source project", () => {
    const projectRoot = join(tmpdir(), "logos-source")

    const paths = resolveLogosRuntimePaths({ sourceProject: projectRoot })

    expect(paths.root.startsWith(projectRoot)).toBe(false)
    expect(paths.agentRuns.startsWith(projectRoot)).toBe(false)
    expect(paths.devSessions.startsWith(projectRoot)).toBe(false)
  })

  it("allows explicit runtime dirs while deriving child dirs from them", () => {
    const root = join(tmpdir(), "custom-logos-runtime")

    const paths = resolveLogosRuntimePaths({ sourceProject: join(tmpdir(), "project"), runtimeRoot: root })

    expect(paths.root).toBe(root)
    expect(paths.agentRuns).toBe(join(root, "agent-runs"))
    expect(paths.devSessions).toBe(join(root, "dev-sessions"))
  })

  it("uses a stable project-specific default path", () => {
    const projectRoot = join(tmpdir(), "logos-source")

    expect(defaultLogosRuntimeDir(projectRoot)).toBe(defaultLogosRuntimeDir(projectRoot))
    expect(defaultLogosRuntimeDir(projectRoot)).toContain("logos")
  })
})
