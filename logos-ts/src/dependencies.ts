/* eslint-disable functional/no-loop-statements, functional/immutable-data, functional/no-let, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/consistent-type-imports, @typescript-eslint/restrict-template-expressions */
import { Node, SyntaxKind, type SourceFile } from "ts-morph"
import { relative, resolve } from "node:path"
import type { DependencyTree } from "./model.js"

// A tracked, top-level named declaration. `qname` is fully qualified by the
// file's path relative to the project root, e.g. "frontend/components/JobRow.tsx#JobRow".
interface Tracked {
  qname: string
  node: Node
}

// Absolute-position key, used to match a resolved declaration back to a tracked node.
function nodeKey(node: Node): string {
  return `${node.getSourceFile().getFilePath()}:${node.getStart()}`
}

function qualify(absRoot: string, node: Node, name: string): string {
  const rel = relative(absRoot, node.getSourceFile().getFilePath())
  return `${rel}#${name}`
}

// Collect every top-level named declaration as a graph node, fully qualified.
function collectTracked(sourceFiles: SourceFile[], absRoot: string): Tracked[] {
  const tracked: Tracked[] = []
  const add = (node: Node, name: string | undefined) => {
    if (name) tracked.push({ qname: qualify(absRoot, node, name), node })
  }
  for (const sf of sourceFiles) {
    for (const fd of sf.getFunctions()) add(fd, fd.getName())
    for (const cd of sf.getClasses()) {
      const cname = cd.getName()
      add(cd, cname)
      // Methods are first-class graph nodes (file#Class.method) so references
      // resolve to the method, not just the enclosing class.
      if (cname) for (const m of cd.getMethods()) add(m, `${cname}.${m.getName()}`)
    }
    for (const id of sf.getInterfaces()) add(id, id.getName())
    for (const ta of sf.getTypeAliases()) add(ta, ta.getName())
    for (const en of sf.getEnums()) add(en, en.getName())
    for (const vd of sf.getVariableDeclarations()) add(vd, vd.getName())
  }
  return tracked
}

// API #2: build qualified-name -> set of qualified names it references, via
// symbol resolution. Names are fully qualified by relative path from `root`,
// so identically-named declarations in different files never collide.
export function buildDependencyTree(sourceFiles: SourceFile[], root: string): DependencyTree {
  const absRoot = resolve(root)
  const tracked = collectTracked(sourceFiles, absRoot)

  // declaration-node key -> qualified graph-node name
  const keyToQName = new Map<string, string>()
  for (const t of tracked) keyToQName.set(nodeKey(t.node), t.qname)

  const tree: DependencyTree = new Map()

  for (const { qname, node } of tracked) {
    const deps = new Set<string>()
    for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      let sym = id.getSymbol()
      if (!sym) continue
      const aliased = sym.getAliasedSymbol()
      if (aliased) sym = aliased
      for (const decl of sym.getDeclarations()) {
        const depQName = keyToQName.get(nodeKey(decl))
        if (depQName && depQName !== qname) deps.add(depQName)
      }
    }
    tree.set(qname, deps)
  }

  return tree
}
