import type { ComponentEntry, FileEntry, Selection } from "./types"

function componentsOf(file: FileEntry): ComponentEntry[] {
  return file.components?.length ? file.components : file.component ? [file.component] : []
}

function storyExport(c: ComponentEntry, storyId?: string): string {
  return c.stories.find((s) => s.id === storyId)?.exportName ?? c.stories[0]?.exportName ?? "-"
}

function componentPathLabel(filePath: string, component: ComponentEntry, storyId?: string): string {
  const parts = filePath.split("/")
  const dirs = parts.slice(0, -1)
  const componentName = component.name || (parts[parts.length - 1] ?? filePath).replace(/\.(tsx?|jsx?)$/, "")
  const labelParts = [...dirs, componentName]
  if (storyId) labelParts.push(storyExport(component, storyId))
  return `/${labelParts.join("/")}`
}

export function contentPanelLabel(file: FileEntry, selection: Selection): string {
  const comps = componentsOf(file)
  const comp = selection.component
    ? comps.find((candidate) => candidate.name === selection.component) ?? comps[0]
    : selection.storyId
      ? comps.find((candidate) => candidate.stories.some((story) => story.id === selection.storyId)) ?? comps[0]
      : comps[0]
  const symbol = selection.symbol
    ? file.items.find((it) => it.name === selection.symbol)
    : null
  const activeView = selection.view === "story" ? "story" : "code"
  return symbol
    ? `${file.file} / ${symbol.kind === "class" ? "⬚" : symbol.kind === "type" ? "T" : "ƒ"} ${symbol.name}`
    : comp
      ? componentPathLabel(file.file, comp, activeView === "story" ? selection.storyId : undefined)
      : `/${file.file}`
}
