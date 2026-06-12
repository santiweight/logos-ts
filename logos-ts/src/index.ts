/* eslint-disable functional/no-loop-statements, functional/immutable-data */
export * from "./model.js"
export { loadProject } from "./project.js"
export { extractArchitecture, extractTests } from "./architecture.js"
export { buildDependencyTree } from "./dependencies.js"
export { extractStoryMap } from "./stories.js"

import type { DependencyTree, StoryMap } from "./model.js"

// JSON-friendly views of the Map/Set structures.
export function dependencyTreeToJSON(tree: DependencyTree): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, deps] of tree) out[name] = [...deps].sort()
  return out
}

export function storyMapToJSON(map: StoryMap): Record<string, string> {
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)))
}
