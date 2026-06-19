import { contentPanelLabel } from "./content-label"
import type { FileEntry, RunTarget, Selection } from "./types"

export interface MainChromeState {
  title: string
  showModeTabs: boolean
  changesOpen: boolean
  changesLabel: string
}

export function mainChromeState({
  selection,
  currentFile,
  runTarget,
  reviewOpen,
  reviewCount,
}: {
  selection: Selection
  currentFile: FileEntry | null | undefined
  runTarget: RunTarget | null
  reviewOpen: boolean
  reviewCount: number
}): MainChromeState {
  const showModeTabs = selection.view !== "run"
  const changesOpen = showModeTabs && reviewOpen
  const title = selection.view === "run"
    ? runTarget?.label ?? "App"
    : currentFile
      ? contentPanelLabel(currentFile, selection)
      : "No files indexed"
  return {
    title,
    showModeTabs,
    changesOpen,
    changesLabel: `Changes${reviewCount > 0 ? ` ${reviewCount}` : ""}`,
  }
}
