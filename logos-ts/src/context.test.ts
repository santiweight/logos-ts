import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { buildArchContext } from "./context.js"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-run-context-"))
  roots.push(root)
  return root
}

function write(root: string, file: string, text: string): void {
  const abs = join(root, file)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text)
}

describe("buildArchContext run targets", () => {
  it("includes files referenced by concrete package dev scripts and their local imports", () => {
    const root = fixtureRoot()
    write(root, "package.json", JSON.stringify({
      name: "sample-vite-app",
      packageManager: "pnpm@11.8.0",
      scripts: {
        dev: "tsx scripts/dev-server.ts --config config/vite.custom.ts",
      },
      dependencies: {
        vite: "^5.0.0",
      },
    }, null, 2))
    write(root, "index.html", "<div id=\"root\"></div>")
    write(root, "scripts/dev-server.ts", `
      import { devConfig } from "../src/dev-config"
      export function startDevServer() {
        return devConfig.port
      }
    `)
    write(root, "src/dev-config.ts", `
      export const devConfig = { port: 5173 }
    `)
    write(root, "config/vite.custom.ts", `
      import { samplePlugin } from "./vite-plugin"
      export default { plugins: [samplePlugin()] }
    `)
    write(root, "config/vite-plugin.ts", `
      export function samplePlugin() {
        return { name: "sample" }
      }
    `)

    const context = buildArchContext(root, ["run:root-app"], 40000)

    expect(context).toContain("# CONTEXT")
    expect(context).toContain("for change to: run:root-app")
    expect(context).toContain("## package.json")
    expect(context).toContain("## scripts/dev-server.ts")
    expect(context).toContain("## src/dev-config.ts")
    expect(context).toContain("## config/vite.custom.ts")
    expect(context).toContain("## config/vite-plugin.ts")
  })

  it("keeps imported dev config helpers under budget pressure from large configs", () => {
    const root = fixtureRoot()
    write(root, "package.json", JSON.stringify({
      name: "sample-vite-app",
      packageManager: "pnpm@11.8.0",
      scripts: { dev: "vite" },
      dependencies: { vite: "^5.0.0" },
    }, null, 2))
    write(root, "index.html", "<div id=\"root\"></div>")
    write(root, "vite.config.ts", `
      import { importantDevTarget } from "./config/important-dev-target"
      const filler = ${JSON.stringify("x".repeat(12000))}
      export default { define: { filler, importantDevTarget } }
    `)
    write(root, "config/important-dev-target.ts", `
      export const importantDevTarget = "mini"
    `)

    const context = buildArchContext(root, ["run:root-app"], 3000)

    expect(context).toContain("## package.json")
    expect(context).toContain("## config/important-dev-target.ts")
    expect(context).not.toContain("## vite.config.ts")
  })
})
