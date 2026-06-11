import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, relative, resolve } from "node:path"
import type { SourceFile } from "ts-morph"
import { loadProject } from "./project.js"
import { indexStories, type StoryEntry } from "./stories.js"
import { buildDependencyTree } from "./dependencies.js"
import { computeTestAttachments, extractBackend, type BackendFile } from "./backend.js"

export interface StoryNode {
  id: string
  exportName: string
}
export interface CapturedNode {
  exportName: string
  testFile: string
  snapshot: string | null
}
export interface ComponentEntry {
  name: string
  file: string
  storiesFile: string
  signature: string
  componentCode: string
  propsName?: string
  propsCode?: string
  propsFields: { name: string; type: string }[]
  deps: string[]
  stories: StoryNode[]
  captured: CapturedNode[]
}
export interface StudioIndex {
  root: string
  storybookUrl: string
  components: ComponentEntry[]
  backend: BackendFile[]
}

// Find the non-stories source file that declares the component.
function findComponentFile(sfs: SourceFile[], name: string): SourceFile | undefined {
  for (const sf of sfs) {
    const p = sf.getFilePath()
    if (/\.stories\.|\.test\./.test(p)) continue
    if (sf.getFunction(name) || sf.getVariableDeclaration(name) || sf.getClass(name)) return sf
  }
  return undefined
}

// Locate `*.captured.test.tsx` siblings of a component's stories file.
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

export function buildStudioIndex(root: string, storybookUrl = "http://localhost:6006"): StudioIndex {
  const absRoot = resolve(root)
  const project = loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const entries = indexStories(sfs)
  const tree = buildDependencyTree(sfs, root)
  const attachments = computeTestAttachments(sfs, absRoot)
  const backend = extractBackend(sfs, tree, attachments, absRoot)

  const byComponent = new Map<string, StoryEntry[]>()
  for (const e of entries) {
    if (e.component === "<unknown>") continue
    ;(byComponent.get(e.component) ?? byComponent.set(e.component, []).get(e.component)!).push(e)
  }

  const components: ComponentEntry[] = []
  for (const [name, storyEntries] of byComponent) {
    const declSf = findComponentFile(sfs, name)
    if (!declSf) continue
    const file = relative(absRoot, declSf.getFilePath())
    const deps = [...(tree.get(`${file}#${name}`) ?? [])].sort()

    // Separate the component declaration from its props interface, so the view
    // shows the component (signature + body) and the interface independently.
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

    components.push({
      name,
      file,
      storiesFile: relative(absRoot, storyEntries[0].filePath),
      signature: propsName ? `${name}(props: ${propsName})` : `${name}()`,
      componentCode,
      propsName,
      propsCode,
      propsFields,
      deps,
      stories: storyEntries.map((e) => ({ id: e.id, exportName: e.exportName })),
      captured: findCaptured(storyEntries[0], absRoot),
    })
  }
  components.sort((a, b) => a.name.localeCompare(b.name))
  return { root: absRoot, storybookUrl, components, backend }
}

// CLI: tsx src/build-index.ts <root> <outFile>
const [, , root = "../hn-jobs", outFile = "studio/src/studio-index.json"] = process.argv
const index = buildStudioIndex(root)
if (outFile === "-") {
  // stdout mode: emit JSON only, for the studio dev server to serve live.
  process.stdout.write(JSON.stringify(index))
} else {
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  writeFileSync(resolve(outFile), JSON.stringify(index, null, 2))
  console.log(`wrote ${outFile}: ${index.components.length} components`)
}
