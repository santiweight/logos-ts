/* eslint-disable functional/no-loop-statements, functional/no-let, functional/immutable-data, no-restricted-syntax, @typescript-eslint/strict-boolean-expressions */
import { existsSync, lstatSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"

export interface StorybookDirs {
  frontendDir: string
  configDir: string
}

export interface StorybookCaps {
  frontendDir: string
  configDir: string
}

export interface PortableStoryResolver {
  moduleFor(moduleId: string): string
  storiesFor(root: string): StoryEntry[]
  clearCache(root?: string): void
}

interface StorybookResolution {
  projectRoot: string
  storybook: StorybookCaps | null | undefined
}

interface StoryCacheEntry {
  mtime: number
  entries: StoryEntry[]
}

function errorModule(storyId: string, message: string): string {
  return `
    import React from "react"

    export function PortableStory() {
      return React.createElement(
        "main",
        { style: { padding: 24, fontFamily: "system-ui, sans-serif" } },
        React.createElement("h1", null, "Story unavailable"),
        React.createElement("pre", { style: { whiteSpace: "pre-wrap" } }, ${JSON.stringify(message)})
      )
    }

    export const storyId = ${JSON.stringify(storyId)}
    export const storyTitle = ${JSON.stringify(`Unavailable / ${storyId || "unknown"}`)}
  `
}

function storyFilesMtime(frontendDir: string): number {
  const skippedDirs = new Set(["node_modules", ".git", ".next", "dist", "storybook-static"])
  let max = 0
  const visit = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (skippedDirs.has(entry)) continue
      const full = join(dir, entry)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        visit(full)
      } else if (/\.stories\.(t|j)sx?$/.test(entry)) {
        max = Math.max(max, st.mtimeMs)
      }
    }
  }
  visit(frontendDir)
  return max
}

function previewFileForConfig(configDir: string): string {
  for (const name of ["preview.tsx", "preview.ts", "preview.jsx", "preview.js"]) {
    const file = resolve(configDir, name)
    if (existsSync(file)) return file
  }
  throw new Error(`Storybook preview file not found in ${configDir}`)
}

export function storybookDirsForRoot(projectRoot: string, caps: StorybookCaps | null | undefined, root: string): StorybookDirs | null {
  if (!caps) return null
  const frontendRel = relative(projectRoot, caps.frontendDir)
  const configRel = relative(projectRoot, caps.configDir)
  return {
    frontendDir: frontendRel ? resolve(root, frontendRel) : root,
    configDir: configRel ? resolve(root, configRel) : root,
  }
}

export function createPortableStoryResolver(opts: {
  projectRoot: string
  storybook: StorybookCaps | null | undefined
  storybookForRoot?: (root: string) => StorybookResolution
  workspaceRoot: (id: string | null) => string | null
}): PortableStoryResolver {
  const storyCache = new Map<string, StoryCacheEntry>()

  const storybookDirs = (root: string): StorybookDirs | null => {
    const resolved = opts.storybookForRoot?.(root) ?? {
      projectRoot: opts.projectRoot,
      storybook: opts.storybook,
    }
    return storybookDirsForRoot(resolved.projectRoot, resolved.storybook, root)
  }

  const storiesFor = (root: string): StoryEntry[] => {
    const dirs = storybookDirs(root)
    if (!dirs) return []
    const mtime = storyFilesMtime(dirs.frontendDir)
    const cached = storyCache.get(root)
    if (cached?.mtime === mtime) return cached.entries
    const project = loadProject(root)
    const entries = indexStories(project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/")))
    storyCache.set(root, { mtime, entries })
    return entries
  }

  const moduleFor = (moduleId: string): string => {
    const query = moduleId.includes("?") ? moduleId.slice(moduleId.indexOf("?")) : ""
    const url = new URL(`http://logos.local/${query}`)
    const storyId = url.searchParams.get("storyId") ?? ""
    const workspaceId = url.searchParams.get("workspaceId")
    const root = opts.workspaceRoot(workspaceId)
    if (!root) return errorModule(storyId, `workspace not found: ${workspaceId}`)
    const dirs = storybookDirs(root)
    if (!dirs) return errorModule(storyId, "Storybook is not configured for this project")

    const story = storiesFor(root).find((e) => e.id === storyId)
    if (!story) return errorModule(storyId, `story not found: ${storyId}`)
    let previewFile: string
    try {
      previewFile = previewFileForConfig(dirs.configDir)
    } catch (e) {
      return errorModule(storyId, String(e instanceof Error ? e.message : e))
    }

    return `
    import { composeStories, setProjectAnnotations } from "@storybook/react"
    import * as stories from ${JSON.stringify(story.filePath)}
    import preview from ${JSON.stringify(previewFile)}

    setProjectAnnotations(preview)
    const composed = composeStories(stories)
    const PortableStory = composed[${JSON.stringify(story.exportName)}]
    if (!PortableStory) throw new Error(${JSON.stringify(`story export not found: ${story.exportName}`)})

    export { PortableStory }
    export const storyId = ${JSON.stringify(story.id)}
    export const storyTitle = ${JSON.stringify(`${story.component} / ${story.exportName}`)}
  `
  }

  return {
    moduleFor,
    storiesFor,
    clearCache(root?: string) {
      if (root) storyCache.delete(root)
      else storyCache.clear()
    },
  }
}
