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
  it("passes Next dev flags through pnpm without a literal separator", () => {
    const root = makeTempDir()
    mkdirSync(join(root, "app"), { recursive: true })
    writeFileSync(join(root, "app/page.tsx"), "export default function Page() { return null }\n")
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n")
    writeFileSync(join(root, "package.json"), JSON.stringify({
      packageManager: "pnpm@11.8.0",
      scripts: { dev: "next dev" },
      dependencies: { next: "14.2.35" },
    }))

    const runs = detectProject(root).runs
    expect(runs[0]).toMatchObject({
      mode: "preview",
      command: "pnpm",
      args: ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", "${PORT}"],
    })
    expect(runs[1]).toMatchObject({
      mode: "dev",
      command: "pnpm",
      args: ["dev", "--hostname", "127.0.0.1", "--port", "${PORT}"],
    })
  })

  it("passes Vite dev flags through pnpm without a literal separator", () => {
    const root = makeTempDir()
    writeFileSync(join(root, "index.html"), "<div id=\"root\"></div>\n")
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n")
    writeFileSync(join(root, "package.json"), JSON.stringify({
      packageManager: "pnpm@11.8.0",
      scripts: { dev: "vite" },
      devDependencies: { vite: "7.2.7" },
    }))

    const runs = detectProject(root).runs
    expect(runs[0]).toMatchObject({
      mode: "preview",
      command: "pnpm",
      args: ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "${PORT}", "--base", "${BASE}"],
    })
    expect(runs[1]).toMatchObject({
      mode: "dev",
      command: "pnpm",
      args: ["dev", "--host", "127.0.0.1", "--port", "${PORT}", "--base", "${BASE}"],
    })
  })

})
