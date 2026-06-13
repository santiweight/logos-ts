/* eslint-disable functional/no-let */
import { describe, expect, it } from "vitest"
import { mkdtempSync, cpSync, writeFileSync, rmSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createPortableStoryResolver, storybookDirsForRoot } from "./portable-stories.js"

const SOURCE = resolve("../hn-jobs")

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-portable-stories-"))
  cpSync(SOURCE, root, {
    recursive: true,
    filter: (s) => !/node_modules|\.logos_cache|\.logos$|\.vite-logos|dist$/.test(s),
  })
  return root
}

describe("portable story resolver", () => {
  it("maps a story id to a composed portable story module", () => {
    const root = copyFixture()
    try {
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: join(root, "frontend"),
          configDir: join(root, "frontend/.storybook"),
        },
        workspaceRoot: () => root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=views-directoryview--default")
      expect(mod).toContain("DirectoryView.stories.tsx")
      expect(mod).toContain(".storybook/preview.tsx")
      expect(mod).toContain('composed["Default"]')
      expect(mod).toContain('storyId = "views-directoryview--default"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("resolves workspace story paths from the workspace root", () => {
    const root = copyFixture()
    const workspace = copyFixture()
    try {
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: join(root, "frontend"),
          configDir: join(root, "frontend/.storybook"),
        },
        workspaceRoot: (id) => id === "ws-test" ? workspace : root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=directory-jobrow--default&workspaceId=ws-test")
      expect(mod).toContain(`${workspace}/frontend/components/JobRow.stories.tsx`)
      expect(mod).toContain(`${workspace}/frontend/.storybook/preview.tsx`)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("accepts a TypeScript Storybook preview file", () => {
    const root = copyFixture()
    try {
      renameSync(
        join(root, "frontend/.storybook/preview.tsx"),
        join(root, "frontend/.storybook/preview.ts"),
      )
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: join(root, "frontend"),
          configDir: join(root, "frontend/.storybook"),
        },
        workspaceRoot: () => root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=views-directoryview--default")
      expect(mod).toContain(".storybook/preview.ts")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })


  it("invalidates cached story indexes when an existing story file changes", async () => {
    const root = copyFixture()
    try {
      const storyFile = join(root, "frontend/components/ValueOrDash.stories.tsx")
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: join(root, "frontend"),
          configDir: join(root, "frontend/.storybook"),
        },
        workspaceRoot: () => root,
      })

      expect(() => resolver.moduleFor("virtual:logos-portable-story?storyId=components-valueordash--cache-probe"))
        .toThrow(/story not found/)

      await new Promise((r) => setTimeout(r, 5))
      writeFileSync(storyFile, "\nexport const CacheProbe = { args: { value: \"probe\" } }\n", { flag: "a" })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=components-valueordash--cache-probe")
      expect(mod).toContain('composed["CacheProbe"]')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("returns null storybook dirs when no storybook config is detected", () => {
    expect(storybookDirsForRoot("/project", null, "/project")).toBeNull()
  })
})
