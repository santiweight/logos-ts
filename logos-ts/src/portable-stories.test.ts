/* eslint-disable functional/no-let */
import { describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPortableStoryResolver, storybookDirsForRoot } from "./portable-stories.js"

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "logos-portable-stories-"))
  mkdirSync(join(root, "app/admin"), { recursive: true })
  mkdirSync(join(root, ".storybook"), { recursive: true })
  writeFileSync(join(root, "app/admin/page.tsx"), `
    export function Page() {
      return <main>Admin page</main>
    }
  `)
  writeFileSync(join(root, "app/admin/page.stories.tsx"), `
    import { Page } from "./page"

    const meta = {
      title: "Admin/Page",
      component: Page,
    }

    export default meta
    export const Default = { args: {} }
  `)
  writeFileSync(join(root, ".storybook/preview.ts"), "export default {}\n")
  return root
}

describe("portable story resolver", () => {
  it("maps a story id to a composed portable story module", () => {
    const root = copyFixture()
    try {
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: root,
          configDir: join(root, ".storybook"),
        },
        workspaceRoot: () => root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--default")
      expect(mod).toContain("app/admin/page.stories.tsx")
      expect(mod).toContain(".storybook/preview.ts")
      expect(mod).toContain('composed["Default"]')
      expect(mod).toContain('storyId = "admin-page--default"')
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
          frontendDir: root,
          configDir: join(root, ".storybook"),
        },
        workspaceRoot: (id) => id === "ws-test" ? workspace : root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--default&workspaceId=ws-test")
      expect(mod).toContain(`${workspace}/app/admin/page.stories.tsx`)
      expect(mod).toContain(`${workspace}/.storybook/preview.ts`)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it("accepts a TypeScript Storybook preview file", () => {
    const root = copyFixture()
    try {
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: root,
          configDir: join(root, ".storybook"),
        },
        workspaceRoot: () => root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--default")
      expect(mod).toContain(".storybook/preview.ts")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })


  it("invalidates cached story indexes when an existing story file changes", async () => {
    const root = copyFixture()
    try {
      const storyFile = join(root, "app/admin/page.stories.tsx")
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: root,
          configDir: join(root, ".storybook"),
        },
        workspaceRoot: () => root,
      })

      const missing = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--cache-probe")
      expect(missing).toContain("Story unavailable")
      expect(missing).toContain("story not found: admin-page--cache-probe")

      await new Promise((r) => setTimeout(r, 5))
      writeFileSync(storyFile, "\nexport const CacheProbe = { args: { value: \"probe\" } }\n", { flag: "a" })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--cache-probe")
      expect(mod).toContain('composed["CacheProbe"]')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("returns null storybook dirs when no storybook config is detected", () => {
    expect(storybookDirsForRoot("/project", null, "/project")).toBeNull()
  })

  it("renders unavailable story modules for unknown workspace ids", () => {
    const root = copyFixture()
    try {
      const resolver = createPortableStoryResolver({
        projectRoot: root,
        storybook: {
          frontendDir: root,
          configDir: join(root, ".storybook"),
        },
        workspaceRoot: (id) => id === "missing-workspace" ? null : root,
      })

      const mod = resolver.moduleFor("virtual:logos-portable-story?storyId=admin-page--default&workspaceId=missing-workspace")
      expect(mod).toContain("Story unavailable")
      expect(mod).toContain("workspace not found: missing-workspace")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
