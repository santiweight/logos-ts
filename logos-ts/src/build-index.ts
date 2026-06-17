/* eslint-disable no-restricted-syntax, @typescript-eslint/no-unused-vars */
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import { Node, SyntaxKind, type SourceFile, type TypeNode } from "ts-morph"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"
import { buildDependencyTree } from "./dependencies.js"
import { computeTestAttachments, extractBackend } from "./backend.js"

export interface StoryNode {
  id: string
  exportName: string
  snapshot: string | null
}
export interface FileEntry {
  file: string
  code: string
  items: FileItem[]
  components?: ComponentEntry[]
  component?: ComponentEntry
}
export interface ComponentEntry {
  name: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
  stories: StoryNode[]
}
export interface FileItem {
  kind: "function" | "class"
  name: string
  signature: string
  code: string
  deps: string[]
  tests: { name: string; file: string; description?: string; code: string }[]
  fields?: { name: string; type: string }[]
  methods?: { name: string; signature: string; code: string; tests: { name: string; file: string; description?: string; code: string }[] }[]
}
export interface StudioIndex {
  root: string
  files: FileEntry[]
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name)
}

function hasJsx(node: Node): boolean {
  return node.getDescendants().some((d) => {
    const kind = d.getKind()
    return kind === SyntaxKind.JsxElement ||
      kind === SyntaxKind.JsxSelfClosingElement ||
      kind === SyntaxKind.JsxFragment
  })
}

function reactComponentPropsName(typeText: string): string | undefined {
  return typeText.match(/(?:React\.)?(?:FC|FunctionComponent|ComponentType)<\s*([A-Za-z0-9_]+)\s*>/)?.[1]
}

function directPropsName(typeText: string): string | undefined {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(typeText) ? typeText : undefined
}

function propsFieldsFromTypeLiteral(node: TypeNode | undefined): { name: string; type: string }[] {
  if (!node || !Node.isTypeLiteral(node)) return []
  return node.getMembers().flatMap((member) => {
    if (!Node.isPropertySignature(member)) return []
    return [{
      name: `${member.getName()}${member.hasQuestionToken() ? "?" : ""}`,
      type: member.getTypeNode()?.getText() ?? "any",
    }]
  })
}

function propsFromNamedType(
  sf: SourceFile,
  propsName: string | undefined,
): { propsCode?: string; propsFields: { name: string; type: string }[] } {
  if (!propsName) return { propsFields: [] }
  const iface = sf.getInterface(propsName)
  if (iface) {
    return {
      propsCode: iface.getText(),
      propsFields: iface.getProperties().map((p) => ({
        name: `${p.getName()}${p.hasQuestionToken() ? "?" : ""}`,
        type: p.getTypeNode()?.getText() ?? "any",
      })),
    }
  }
  const alias = sf.getTypeAlias(propsName)
  const typeNode = alias?.getTypeNode()
  if (alias) {
    return {
      propsCode: alias.getText(),
      propsFields: propsFieldsFromTypeLiteral(typeNode),
    }
  }
  return { propsFields: [] }
}

interface DetectedComponent {
  name: string
  file: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
}

function componentFromFunction(sf: SourceFile, absRoot: string, fn: ReturnType<SourceFile["getFunctions"]>[number]): DetectedComponent | null {
  const name = fn.getName()
  if (!name || !isComponentName(name) || !hasJsx(fn)) return null
  const firstParam = fn.getParameters()[0]
  const typeNode = firstParam?.getTypeNode()
  const typeText = typeNode?.getText()
  const propsName = typeText ? directPropsName(typeText) : undefined
  const namedProps = propsFromNamedType(sf, propsName)
  const inlineFields = propsFieldsFromTypeLiteral(typeNode)
  const propsFields = namedProps.propsFields.length ? namedProps.propsFields : inlineFields
  const propsCode = namedProps.propsCode ?? (inlineFields.length && typeNode ? typeNode.getText() : undefined)
  const signature = typeText ? `${name}(props: ${typeText})` : `${name}()`
  return {
    name,
    file: relative(absRoot, sf.getFilePath()),
    signature,
    componentCode: fn.getText(),
    ...(propsName != null ? { propsName } : {}),
    ...(propsCode != null ? { propsCode } : {}),
    propsFields,
  }
}

function componentFromVariable(sf: SourceFile, absRoot: string, vd: ReturnType<SourceFile["getVariableDeclarations"]>[number]): DetectedComponent | null {
  const name = vd.getName()
  if (!isComponentName(name)) return null
  const init = vd.getInitializer()
  const typeText = vd.getTypeNode()?.getText()
  const typedPropsName = typeText ? reactComponentPropsName(typeText) : undefined
  if (!typedPropsName && (!init || !hasJsx(init))) return null

  const fn = init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) ? init : null
  const firstParam = fn?.getParameters()[0]
  const paramTypeNode = firstParam?.getTypeNode()
  const paramTypeText = paramTypeNode?.getText()
  const propsName = typedPropsName ?? (paramTypeText ? directPropsName(paramTypeText) : undefined)
  const namedProps = propsFromNamedType(sf, propsName)
  const inlineFields = propsFieldsFromTypeLiteral(paramTypeNode)
  const propsFields = namedProps.propsFields.length ? namedProps.propsFields : inlineFields
  const propsCode = namedProps.propsCode ?? (inlineFields.length && paramTypeNode ? paramTypeNode.getText() : undefined)
  const componentCode = vd.getVariableStatement()?.getText() ?? vd.getText()
  const signatureType = propsName ?? paramTypeText
  return {
    name,
    file: relative(absRoot, sf.getFilePath()),
    signature: signatureType ? `${name}(props: ${signatureType})` : `${name}()`,
    componentCode,
    ...(propsName != null ? { propsName } : {}),
    ...(propsCode != null ? { propsCode } : {}),
    propsFields,
  }
}

function detectComponents(sfs: SourceFile[], absRoot: string): DetectedComponent[] {
  const components: DetectedComponent[] = []
  for (const sf of sfs) {
    const p = sf.getFilePath()
    if (/\.stories\.|\.test\./.test(p)) continue
    for (const fn of sf.getFunctions()) {
      const component = componentFromFunction(sf, absRoot, fn)
      if (component) components.push(component)
    }
    for (const vd of sf.getVariableDeclarations()) {
      const component = componentFromVariable(sf, absRoot, vd)
      if (component) components.push(component)
    }
  }
  return components
}

function parseSnapshotKeys(snapContent: string): Map<string, string> {
  const entries = new Map<string, string>()
  const re = /^exports\[`(.+?)`\]\s*=\s*`([\s\S]*?)`;$/gm
  let m
  while ((m = re.exec(snapContent))) {
    const key = m[1]
    const value = m[2]
    if (key != null && value != null) entries.set(key, value)
  }
  return entries
}

let _snapCache: { path: string; entries: Map<string, string> } | null = null

function loadStorySnapshots(absRoot: string): Map<string, string> {
  const snapPath = join(absRoot, "frontend", "__snapshots__", "stories.test.tsx.snap")
  if (_snapCache?.path === snapPath) return _snapCache.entries
  if (!existsSync(snapPath)) {
    _snapCache = { path: snapPath, entries: new Map() }
    return _snapCache.entries
  }
  const entries = parseSnapshotKeys(readFileSync(snapPath, "utf8"))
  _snapCache = { path: snapPath, entries }
  return entries
}

function getSnapshotForStory(storyEntry: StoryEntry, absRoot: string, allSnaps: Map<string, string>): string | null {
  const storyRelPath = "./" + relative(absRoot, storyEntry.filePath).replace(/^frontend\//, "")
  const snapKey = `captured: ${storyRelPath} / ${storyEntry.exportName} 1`
  return allSnaps.get(snapKey) ?? null
}

export function buildStudioIndex(root: string, existingProject?: ReturnType<typeof loadProject>): StudioIndex {
  const absRoot = resolve(root)
  const project = existingProject ?? loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const storyEntries = indexStories(sfs)
  const tree = buildDependencyTree(sfs, root)
  const attachments = computeTestAttachments(sfs, absRoot)
  const backendFiles = extractBackend(sfs, tree, attachments, absRoot)
  const allSnaps = loadStorySnapshots(absRoot)

  // Group story entries by component name
  const storiesByComponent = new Map<string, StoryEntry[]>()
  for (const e of storyEntries) {
    if (e.component === "<unknown>") continue
    ;(storiesByComponent.get(e.component) ?? storiesByComponent.set(e.component, []).get(e.component)!).push(e)
  }

  // Build component enrichments keyed by file path. Components are detected
  // from TypeScript/JSX first; Storybook stories are optional metadata.
  const componentsByFile = new Map<string, ComponentEntry[]>()
  for (const component of detectComponents(sfs, absRoot)) {
    const entries = storiesByComponent.get(component.name) ?? []
    const file = component.file

    const next: ComponentEntry = {
      name: component.name,
      signature: component.signature,
      componentCode: component.componentCode,
      ...(component.propsName != null ? { propsName: component.propsName } : {}),
      ...(component.propsCode != null ? { propsCode: component.propsCode } : {}),
      propsFields: component.propsFields,
      stories: entries.map((e) => ({
        id: e.id,
        exportName: e.exportName,
        snapshot: getSnapshotForStory(e, absRoot, allSnaps),
      })),
    }
    ;(componentsByFile.get(file) ?? componentsByFile.set(file, []).get(file)!).push(next)
  }

  // Merge backend files with component enrichments
  const files: FileEntry[] = backendFiles.map((bf) => {
    const components = componentsByFile.get(bf.file) ?? []
    const comp = components[0]
    const entry: FileEntry = {
      file: bf.file,
      code: bf.code,
      items: bf.items.map((it) => {
        if (it.kind === "function") {
          return {
            kind: "function" as const,
            name: it.name,
            signature: it.signature,
            code: it.code,
            deps: it.deps,
            tests: it.tests,
          }
        }
        return {
          kind: "class" as const,
          name: it.name,
          signature: `class ${it.name}`,
          code: it.code,
          deps: it.deps,
          tests: it.tests,
          fields: it.fields,
          methods: it.methods,
        }
      }),
      ...(components.length ? { components, component: comp } : {})
    }
    return entry
  })

  // Add component files that weren't in the backend list (shouldn't happen after our filter fix, but just in case)
  for (const [file, components] of componentsByFile) {
    if (!files.some((f) => f.file === file)) {
      const sf = sfs.find((s) => relative(absRoot, s.getFilePath()) === file)
      files.push({
        file,
        code: sf?.getFullText() ?? "",
        items: [],
        ...(components.length ? { components, component: components[0] } : {})
      })
    }
  }

  files.sort((a, b) => a.file.localeCompare(b.file))
  return { root: absRoot, files }
}

// CLI: tsx src/build-index.ts <root> <outFile>
if (process.argv[1]?.match(/build-index\.[tj]s$/)) {
  const [, , root = "../hn-jobs", outFile = "studio/src/studio-index.json"] = process.argv
  const index = buildStudioIndex(root)
  if (outFile === "-") {
    process.stdout.write(JSON.stringify(index))
  } else {
    mkdirSync(dirname(resolve(outFile)), { recursive: true })
    writeFileSync(resolve(outFile), JSON.stringify(index, null, 2))
    const nComps = index.files.reduce((n, f) => n + (f.components?.length ?? (f.component ? 1 : 0)), 0)
    console.log(`wrote ${outFile}: ${index.files.length} files, ${nComps} components`)
  }
}
