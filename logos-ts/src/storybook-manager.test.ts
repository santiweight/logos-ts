import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { LogosRuntimeStore } from "./runtime-store.js"
import { StorybookManager } from "./storybook-manager.js"

const LOGOS_TS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tempDirs: string[] = []

function createManager(): { frontendDir: string; manager: StorybookManager } {
  const root = mkdtempSync(join(tmpdir(), "logos-storybook-manager-"))
  tempDirs.push(root)
  const frontendDir = join(root, "frontend")
  mkdirSync(join(frontendDir, ".storybook"), { recursive: true })
  const store = new LogosRuntimeStore(join(root, ".logos", "runtime.db"))
  return {
    frontendDir,
    manager: new StorybookManager(store, join(LOGOS_TS_ROOT, "src"), root),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("StorybookManager.prepare", () => {
  it("wraps a plain Storybook preview with the Logos comment bridge", () => {
    const { frontendDir, manager } = createManager()
    const previewFile = join(frontendDir, ".storybook", "preview.ts")
    const originalPreview = "const preview = { parameters: {} }\nexport default preview\n"
    writeFileSync(previewFile, originalPreview)

    manager.prepare(frontendDir)

    expect(readFileSync(join(frontendDir, ".storybook", "preview.logos-user.ts"), "utf8")).toBe(originalPreview)
    expect(readFileSync(previewFile, "utf8")).toContain("withLogosComments")
    const sbLayer = readFileSync(join(frontendDir, ".storybook", ".logos", "storybook-comment-layer.tsx"), "utf8")
    const commentLayer = readFileSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"), "utf8")
    expect(sbLayer).toContain("__LOGOS_STORY_COMMENT_LAYER_ACTIVE__")
    expect(commentLayer).toContain("withLogosComments")
  })

  it("does not wrap a preview that already uses the direct StorybookCommentLayer", () => {
    const { frontendDir, manager } = createManager()
    const previewFile = join(frontendDir, ".storybook", "preview.tsx")
    const directPreview = [
      'import { StorybookCommentLayer } from "@logos-studio/storybook-comment-layer"',
      "const preview = { decorators: [(Story: any) => <StorybookCommentLayer storyId=\"story\"><Story /></StorybookCommentLayer>] }",
      "export default preview",
      "",
    ].join("\n")
    writeFileSync(previewFile, directPreview)

    manager.prepare(frontendDir)

    expect(readFileSync(previewFile, "utf8")).toBe(directPreview)
    expect(existsSync(join(frontendDir, ".storybook", "preview.logos-user.tsx"))).toBe(false)
    expect(existsSync(join(frontendDir, ".storybook", ".logos", "CommentLayer.tsx"))).toBe(true)
  })

  it("restores an already wrapped preview when the user preview has the direct StorybookCommentLayer", () => {
    const { frontendDir, manager } = createManager()
    const previewFile = join(frontendDir, ".storybook", "preview.tsx")
    const userPreviewFile = join(frontendDir, ".storybook", "preview.logos-user.tsx")
    const directPreview = [
      'import { StorybookCommentLayer } from "@logos-studio/storybook-comment-layer"',
      "const preview = { decorators: [(Story: any) => <StorybookCommentLayer storyId=\"story\"><Story /></StorybookCommentLayer>] }",
      "export default preview",
      "",
    ].join("\n")
    writeFileSync(userPreviewFile, directPreview)
    writeFileSync(previewFile, [
      'import * as userPreviewModule from "./preview.logos-user"',
      'import { withLogosComments } from "./.logos/CommentLayer"',
      "export default { ...userPreviewModule, decorators: [withLogosComments] }",
      "",
    ].join("\n"))

    manager.prepare(frontendDir)

    expect(readFileSync(previewFile, "utf8")).toBe(directPreview)
  })
})
