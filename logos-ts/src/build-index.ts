/* eslint-disable no-restricted-syntax, @typescript-eslint/no-unused-vars */
import { writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import { Node, SyntaxKind, type SourceFile, type TypeNode } from "ts-morph"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"
import { buildDependencyTree } from "./dependencies.js"
import { computeTestAttachments, extractBackend } from "./backend.js"
import { loadStorySnapshotStore } from "./story-snapshots.js"
import { normalizeTypeImportPaths } from "./type-text.js"

export interface StoryNode {
  id: string
  exportName: string
  storyFile?: string
  storyCode?: string
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
  kind: "function" | "class" | "type"
  name: string
  signature: string
  code: string
  deps: string[]
  tests: { name: string; file: string; description?: string; code: string }[]
  fields?: { name: string; type: string }[]
  methods?: { name: string; signature: string; code: string; tests: { name: string; file: string; description?: string; code: string }[] }[]
}
export interface SymbolLocation { file: string; line: number }
export interface StudioIndex {
  root: string
  files: FileEntry[]
  symbols: Record<string, SymbolLocation>
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

function propsFieldsFromTypeLiteral(node: TypeNode | undefined, absRoot: string): { name: string; type: string }[] {
  if (!node || !Node.isTypeLiteral(node)) return []
  const contextFile = node.getSourceFile().getFilePath()
  return node.getMembers().flatMap((member) => {
    if (!Node.isPropertySignature(member)) return []
    return [{
      name: `${member.getName()}${member.hasQuestionToken() ? "?" : ""}`,
      type: normalizeTypeImportPaths(member.getTypeNode()?.getText() ?? "any", absRoot, contextFile),
    }]
  })
}

function propsFromNamedType(
  sf: SourceFile,
  propsName: string | undefined,
  absRoot: string,
): { propsCode?: string; propsFields: { name: string; type: string }[] } {
  if (!propsName) return { propsFields: [] }
  const clean = (text: string) => normalizeTypeImportPaths(text, absRoot, sf.getFilePath())
  const iface = sf.getInterface(propsName)
  if (iface) {
    return {
      propsCode: clean(iface.getText()),
      propsFields: iface.getProperties().map((p) => ({
        name: `${p.getName()}${p.hasQuestionToken() ? "?" : ""}`,
        type: clean(p.getTypeNode()?.getText() ?? "any"),
      })),
    }
  }
  const alias = sf.getTypeAlias(propsName)
  const typeNode = alias?.getTypeNode()
  if (alias) {
    return {
      propsCode: clean(alias.getText()),
      propsFields: propsFieldsFromTypeLiteral(typeNode, absRoot),
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
  const clean = (text: string) => normalizeTypeImportPaths(text, absRoot, sf.getFilePath())
  const typeText = typeNode ? clean(typeNode.getText()) : undefined
  const propsName = typeText ? directPropsName(typeText) : undefined
  const namedProps = propsFromNamedType(sf, propsName, absRoot)
  const inlineFields = propsFieldsFromTypeLiteral(typeNode, absRoot)
  const propsFields = namedProps.propsFields.length ? namedProps.propsFields : inlineFields
  const propsCode = namedProps.propsCode ?? (inlineFields.length && typeNode ? clean(typeNode.getText()) : undefined)
  const signature = typeText ? `${name}(props: ${typeText})` : `${name}()`
  return {
    name,
    file: relative(absRoot, sf.getFilePath()),
    signature,
    componentCode: clean(fn.getText()),
    ...(propsName != null ? { propsName } : {}),
    ...(propsCode != null ? { propsCode } : {}),
    propsFields,
  }
}

function componentFromVariable(sf: SourceFile, absRoot: string, vd: ReturnType<SourceFile["getVariableDeclarations"]>[number]): DetectedComponent | null {
  const name = vd.getName()
  if (!isComponentName(name)) return null
  const init = vd.getInitializer()
  const clean = (text: string) => normalizeTypeImportPaths(text, absRoot, sf.getFilePath())
  const typeText = vd.getTypeNode() ? clean(vd.getTypeNode()!.getText()) : undefined
  const typedPropsName = typeText ? reactComponentPropsName(typeText) : undefined
  if (!typedPropsName && (!init || !hasJsx(init))) return null

  const fn = init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) ? init : null
  const firstParam = fn?.getParameters()[0]
  const paramTypeNode = firstParam?.getTypeNode()
  const paramTypeText = paramTypeNode ? clean(paramTypeNode.getText()) : undefined
  const propsName = typedPropsName ?? (paramTypeText ? directPropsName(paramTypeText) : undefined)
  const namedProps = propsFromNamedType(sf, propsName, absRoot)
  const inlineFields = propsFieldsFromTypeLiteral(paramTypeNode, absRoot)
  const propsFields = namedProps.propsFields.length ? namedProps.propsFields : inlineFields
  const propsCode = namedProps.propsCode ?? (inlineFields.length && paramTypeNode ? clean(paramTypeNode.getText()) : undefined)
  const componentCode = clean(vd.getVariableStatement()?.getText() ?? vd.getText())
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

function extractSymbols(sfs: SourceFile[], absRoot: string): Record<string, SymbolLocation> {
  const out: Record<string, SymbolLocation> = {}
  for (const sf of sfs) {
    const p = sf.getFilePath()
    if (/\.stories\.|\.test\.|\.spec\./.test(p)) continue
    const file = relative(absRoot, p)
    for (const [name, decls] of sf.getExportedDeclarations()) {
      if (name === "default" || out[name]) continue
      const d = decls[0]
      if (!d) continue
      out[name] = { file, line: d.getStartLineNumber() }
    }
  }
  return out
}

export function buildStudioIndex(root: string, existingProject?: ReturnType<typeof loadProject>): StudioIndex {
  const absRoot = resolve(root)
  const project = existingProject ?? loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const storyEntries = indexStories(sfs)
  const tree = buildDependencyTree(sfs, root)
  const attachments = computeTestAttachments(sfs, absRoot)
  const backendFiles = extractBackend(sfs, tree, attachments, absRoot)
  const snapshotStore = loadStorySnapshotStore(absRoot)

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
        storyFile: relative(absRoot, e.filePath),
        storyCode: e.code,
        snapshot: snapshotStore.get(e),
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
      const clean = (text: string) => sf ? normalizeTypeImportPaths(text, absRoot, sf.getFilePath()) : text
      files.push({
        file,
        code: sf ? clean(sf.getFullText()) : "",
        items: [],
        ...(components.length ? { components, component: components[0] } : {})
      })
    }
  }

  // Include files that only contain type/interface declarations (no functions or classes)
  const indexed = new Set(files.map((f) => f.file))
  for (const sf of sfs) {
    const p = sf.getFilePath()
    if (/\.stories\.|\.test\.|\.spec\./.test(p) || p.includes("/node_modules/")) continue
    const file = relative(absRoot, p)
    if (indexed.has(file)) continue
    const clean = (text: string) => normalizeTypeImportPaths(text, absRoot, sf.getFilePath())
    const typeItems: FileItem[] = []
    for (const decl of sf.getTypeAliases()) {
      const name = decl.getName()
      typeItems.push({ kind: "type", name, signature: `type ${name}`, code: clean(decl.getText()), deps: [], tests: [] })
    }
    for (const decl of sf.getInterfaces()) {
      const name = decl.getName()
      typeItems.push({ kind: "type", name, signature: `interface ${name}`, code: clean(decl.getText()), deps: [], tests: [] })
    }
    for (const decl of sf.getEnums()) {
      const name = decl.getName()
      typeItems.push({ kind: "type", name, signature: `enum ${name}`, code: clean(decl.getText()), deps: [], tests: [] })
    }
    if (typeItems.length) {
      files.push({ file, code: clean(sf.getFullText()), items: typeItems })
    }
  }

  files.sort((a, b) => a.file.localeCompare(b.file))
  const symbols = extractSymbols(sfs, absRoot)
  return { root: absRoot, files, symbols }
}

// CLI: tsx src/build-index.ts <root> <outFile>
if (process.argv[1]?.match(/build-index\.[tj]s$/)) {
  const [, , root = "demos/hn-jobs", outFile = "studio/src/studio-index.json"] = process.argv
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
