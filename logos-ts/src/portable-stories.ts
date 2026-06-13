/* eslint-disable functional/no-loop-statements, functional/no-let, functional/immutable-data, no-restricted-syntax, @typescript-eslint/strict-boolean-expressions */
import { existsSync, readdirSync, statSync } from "node:fs"
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

interface StoryCacheEntry {
  mtime: number
  entries: StoryEntry[]
}

function storyFilesMtime(frontendDir: string): number {
  const storyFiles = readdirSync(frontendDir, { recursive: true })
    .filter((f): f is string => typeof f === "string" && /\.stories\.(t|j)sx?$/.test(f))
  return storyFiles.reduce((max, file) => {
    try {
      return Math.max(max, statSync(join(frontendDir, file)).mtimeMs)
    } catch {
      return max
    }
  }, 0)
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
  workspaceRoot: (id: string | null) => string | null
}): PortableStoryResolver {
  const storyCache = new Map<string, StoryCacheEntry>()

  const storiesFor = (root: string): StoryEntry[] => {
    const dirs = storybookDirsForRoot(opts.projectRoot, opts.storybook, root)
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
    if (!root) throw new Error(`workspace not found: ${workspaceId}`)
    const dirs = storybookDirsForRoot(opts.projectRoot, opts.storybook, root)
    if (!dirs) throw new Error("Storybook is not configured for this project")

    const story = storiesFor(root).find((e) => e.id === storyId)
    if (!story) throw new Error(`story not found: ${storyId}`)
    const previewFile = previewFileForConfig(dirs.configDir)

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
