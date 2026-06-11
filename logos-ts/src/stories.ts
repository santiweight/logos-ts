import { Node, type ObjectLiteralExpression, type SourceFile } from "ts-morph"
import { basename } from "node:path"
import type { StoryMap } from "./model.js"

export interface StoryEntry {
  id: string // storybook-style id, e.g. "directory-jobrow--default"
  filePath: string // absolute path to the .stories file
  storiesModule: string // basename without extension, e.g. "JobRow.stories"
  exportName: string // the named export, e.g. "Default"
  component: string // component name from meta.component
}

function isStoryFile(sf: SourceFile): boolean {
  return /\.stories\.(t|j)sx?$/.test(sf.getFilePath())
}

// Resolve the default-exported `meta` object literal (CSF: `export default meta`).
function metaObject(sf: SourceFile): ObjectLiteralExpression | undefined {
  const ea = sf.getExportAssignment((e) => !e.isExportEquals())
  if (!ea) return undefined
  const ex = ea.getExpression()
  if (Node.isObjectLiteralExpression(ex)) return ex
  if (Node.isIdentifier(ex)) {
    const decl = ex.getSymbol()?.getDeclarations()?.[0]
    if (decl && Node.isVariableDeclaration(decl)) {
      const init = decl.getInitializer()
      if (init && Node.isObjectLiteralExpression(init)) return init
    }
  }
  return undefined
}

function propText(obj: ObjectLiteralExpression, key: string): string | undefined {
  const prop = obj.getProperty(key)
  if (prop && Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer()
    if (init && Node.isStringLiteral(init)) return init.getLiteralText()
    return init?.getText()
  }
  return undefined
}

// Storybook id = sanitize(title) + "--" + kebab(exportName).
// The title is sanitized as-is, but the export name is start-cased first
// (Storybook splits camelCase: "VisaAndIntern" -> "visa-and-intern").
function sanitize(s: string): string {
  return s
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

function kebabExport(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // ACRONYMWord boundary
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
  return sanitize(spaced)
}

// Full index of every story across the project.
export function indexStories(sourceFiles: SourceFile[]): StoryEntry[] {
  const entries: StoryEntry[] = []
  for (const sf of sourceFiles) {
    if (!isStoryFile(sf)) continue
    const obj = metaObject(sf)
    const component = obj ? propText(obj, "component") ?? "<unknown>" : "<unknown>"
    const title = obj ? propText(obj, "title") : undefined
    const base = title ?? component
    const storiesModule = basename(sf.getFilePath()).replace(/\.(t|j)sx?$/, "")

    for (const [exportName] of sf.getExportedDeclarations()) {
      if (exportName === "default") continue
      entries.push({
        id: `${sanitize(base)}--${kebabExport(exportName)}`,
        filePath: sf.getFilePath(),
        storiesModule,
        exportName,
        component,
      })
    }
  }
  return entries
}

// API #3: map every story to the component it implements.
export function extractStoryMap(sourceFiles: SourceFile[]): StoryMap {
  const map: StoryMap = new Map()
  for (const e of indexStories(sourceFiles)) map.set(e.id, e.component)
  return map
}
