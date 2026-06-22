import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { detectProject } from "./detect-project.js"

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "logos-detect-project-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("detectProject", () => {
  it("does not insert an argument separator for pnpm run scripts", () => {
    const root = makeTempDir()
    mkdirSync(join(root, "app"), { recursive: true })
    writeFileSync(join(root, "app/page.tsx"), "export default function Page() { return null }\n")
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n")
    writeFileSync(join(root, "package.json"), JSON.stringify({
      packageManager: "pnpm@11.8.0",
      scripts: { dev: "next dev" },
      dependencies: { next: "14.2.35" },
    }))

    expect(detectProject(root).runs[0]).toMatchObject({
      command: "pnpm",
      args: ["dev", "--", "-H", "127.0.0.1", "-p", "${PORT}"],
    })
  })

})
