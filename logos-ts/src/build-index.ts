import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import type { SourceFile } from "ts-morph"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"
import { buildDependencyTree } from "./dependencies.js"
import { computeTestAttachments, extractBackend } from "./backend.js"

export interface StoryNode {
  id: string
  exportName: string
}
export interface CapturedNode {
  exportName: string
  testFile: string
  snapshot: string | null
}
export interface FileEntry {
  file: string
  code: string
  items: FileItem[]
  component?: {
    name: string
    signature: string
    componentCode: string
    propsName?: string
    propsCode?: string
    propsFields: { name: string; type: string }[]
    stories: StoryNode[]
    captured: CapturedNode[]
  }
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
  storybookUrl: string
  files: FileEntry[]
}

function findComponentFile(sfs: SourceFile[], name: string): SourceFile | undefined {
  for (const sf of sfs) {
    const p = sf.getFilePath()
    if (/\.stories\.|\.test\./.test(p)) continue
    if (sf.getFunction(name) || sf.getVariableDeclaration(name) || sf.getClass(name)) return sf
  }
  return undefined
}

function findCaptured(storyEntry: StoryEntry, absRoot: string): CapturedNode[] {
  const dir = dirname(storyEntry.filePath)
  const base = storyEntry.storiesModule.replace(/\.stories$/, "")
  const suffix = ".captured.test.tsx"
  const out: CapturedNode[] = []
  for (const fn of readdirSync(dir)) {
    if (!fn.startsWith(`${base}.`) || !fn.endsWith(suffix)) continue
    const exportName = fn.slice(base.length + 1, -suffix.length)
    const snapPath = join(dir, "__snapshots__", `${fn}.snap`)
    out.push({
      exportName,
      testFile: relative(absRoot, join(dir, fn)),
      snapshot: existsSync(snapPath) ? readFileSync(snapPath, "utf8") : null,
    })
  }
  return out
}

export function buildStudioIndex(root: string, storybookUrl = ""): StudioIndex {
  const absRoot = resolve(root)
  const project = loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const storyEntries = indexStories(sfs)
  const tree = buildDependencyTree(sfs, root)
  const attachments = computeTestAttachments(sfs, absRoot)
  const backendFiles = extractBackend(sfs, tree, attachments, absRoot)

  // Group story entries by component name
  const storiesByComponent = new Map<string, StoryEntry[]>()
  for (const e of storyEntries) {
    if (e.component === "<unknown>") continue
    ;(storiesByComponent.get(e.component) ?? storiesByComponent.set(e.component, []).get(e.component)!).push(e)
  }

  // Build component enrichments keyed by file path
  const componentByFile = new Map<string, FileEntry["component"]>()
  for (const [name, entries] of storiesByComponent) {
    const declSf = findComponentFile(sfs, name)
    if (!declSf) continue
    const file = relative(absRoot, declSf.getFilePath())
    const deps = [...(tree.get(`${file}#${name}`) ?? [])].sort()

    const vd = declSf.getVariableDeclaration(name)
    const propsName = (vd?.getTypeNode()?.getText() ?? "").match(/<\s*([A-Za-z0-9_]+)\s*>/)?.[1]
    const componentCode = vd?.getVariableStatement()?.getText() ?? vd?.getText() ?? declSf.getFullText()

    let propsCode: string | undefined
    let propsFields: { name: string; type: string }[] = []
    if (propsName) {
      const iface = declSf.getInterface(propsName)
      if (iface) {
        propsCode = iface.getText()
        propsFields = iface.getProperties().map((p) => ({
          name: `${p.getName()}${p.hasQuestionToken() ? "?" : ""}`,
          type: p.getTypeNode()?.getText() ?? "any",
        }))
      } else {
        propsCode = declSf.getTypeAlias(propsName)?.getText()
      }
    }

    componentByFile.set(file, {
      name,
      signature: propsName ? `${name}(props: ${propsName})` : `${name}()`,
      componentCode,
      propsName,
      propsCode,
      propsFields,
      stories: entries.map((e) => ({ id: e.id, exportName: e.exportName })),
      captured: findCaptured(entries[0], absRoot),
    })
  }

  // Merge backend files with component enrichments
  const files: FileEntry[] = backendFiles.map((bf) => {
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
          signature: it.signature,
          code: it.code,
          deps: it.deps,
          tests: it.tests,
          fields: it.fields,
          methods: it.methods,
        }
      }),
    }
    const comp = componentByFile.get(bf.file)
    if (comp) entry.component = comp
    return entry
  })

  // Add component files that weren't in the backend list (shouldn't happen after our filter fix, but just in case)
  for (const [file, comp] of componentByFile) {
    if (!files.some((f) => f.file === file)) {
      const sf = sfs.find((s) => relative(absRoot, s.getFilePath()) === file)
      files.push({
        file,
        code: sf?.getFullText() ?? "",
        items: [],
        component: comp,
      })
    }
  }

  files.sort((a, b) => a.file.localeCompare(b.file))
  return { root: absRoot, storybookUrl, files }
}

// CLI: tsx src/build-index.ts <root> <outFile>
const [, , root = "../hn-jobs", outFile = "studio/src/studio-index.json"] = process.argv
const index = buildStudioIndex(root, process.env.STORYBOOK_URL)
if (outFile === "-") {
  process.stdout.write(JSON.stringify(index))
} else {
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  writeFileSync(resolve(outFile), JSON.stringify(index, null, 2))
  const nComps = index.files.filter((f) => f.component).length
  console.log(`wrote ${outFile}: ${index.files.length} files, ${nComps} components`)
}
