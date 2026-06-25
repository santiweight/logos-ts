import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createSessionProject, devSessionsDirFor } from "./session-project.js"

const tempDirs: string[] = []

function makeSourceProject() {
  const root = mkdtempSync(join(tmpdir(), "logos-session-project-"))
  tempDirs.push(root)
  const sourceRoot = join(root, "source")
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(join(sourceRoot, "package.json"), JSON.stringify({ name: "test-session", version: "1.0.0" }))
  writeFileSync(join(sourceRoot, "app.ts"), "export const value = 'source'\n")
  mkdirSync(join(sourceRoot, ".git"), { recursive: true })
  writeFileSync(join(sourceRoot, ".git", "HEAD"), "ref: refs/heads/main\n")
  mkdirSync(join(sourceRoot, ".logos"), { recursive: true })
  writeFileSync(join(sourceRoot, ".logos", "runtime.db"), "runtime\n")
  mkdirSync(join(sourceRoot, ".hn-jobs-runtime", "old-run"), { recursive: true })
  writeFileSync(join(sourceRoot, ".hn-jobs-runtime", "old-run", "dev.db"), "old app db\n")
  mkdirSync(join(sourceRoot, "prisma"), { recursive: true })
  writeFileSync(join(sourceRoot, "prisma", "snapshot.db"), "snapshot\n")
  return { root, sourceRoot }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("session project isolation", () => {
  it("materializes a writable session copy instead of returning the source project", () => {
    const { root, sourceRoot } = makeSourceProject()
    const session = createSessionProject(sourceRoot, join(root, ".dev-sessions"))

    expect(session.root).not.toBe(sourceRoot)
    expect(readFileSync(join(session.root, "app.ts"), "utf8")).toContain("source")
    expect(existsSync(join(session.root, ".git"))).toBe(false)
    expect(existsSync(join(session.root, ".logos", "runtime.db"))).toBe(false)
    expect(existsSync(join(session.root, ".hn-jobs-runtime"))).toBe(false)
    expect(existsSync(join(session.root, "prisma", "snapshot.db"))).toBe(false)
    expect(lstatSync(join(session.root, "node_modules")).isSymbolicLink()).toBe(true)

    writeFileSync(join(session.root, "app.ts"), "export const value = 'session'\n")

    expect(readFileSync(join(sourceRoot, "app.ts"), "utf8")).toContain("source")
    expect(readFileSync(join(session.root, "app.ts"), "utf8")).toContain("session")
  })

  it("keeps session directories outside a project source tree", () => {
    const { sourceRoot } = makeSourceProject()
    const preferred = join(sourceRoot, ".dev-sessions")

    expect(devSessionsDirFor(sourceRoot, preferred)).not.toBe(preferred)
  })
})
