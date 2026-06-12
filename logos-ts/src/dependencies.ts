import { Node, SyntaxKind, type SourceFile } from "ts-morph"
import { relative, resolve, dirname } from "node:path"
import type { DependencyTree } from "./model.js"

function qualify(absRoot: string, sf: SourceFile, name: string): string {
  return `${relative(absRoot, sf.getFilePath())}#${name}`
}

export function buildDependencyTree(sourceFiles: SourceFile[], root: string): DependencyTree {
  const absRoot = resolve(root)

  // Step 1: Collect all tracked declarations per file
  const declsByFile = new Map<string, Map<string, string>>() // filePath -> (name -> qname)
  for (const sf of sourceFiles) {
    const names = new Map<string, string>()
    for (const fd of sf.getFunctions()) { const n = fd.getName(); if (n) names.set(n, qualify(absRoot, sf, n)) }
    for (const cd of sf.getClasses()) {
      const n = cd.getName()
      if (n) {
        names.set(n, qualify(absRoot, sf, n))
        for (const m of cd.getMethods()) names.set(`${n}.${m.getName()}`, qualify(absRoot, sf, `${n}.${m.getName()}`))
      }
    }
    for (const id of sf.getInterfaces()) { const n = id.getName(); if (n) names.set(n, qualify(absRoot, sf, n)) }
    for (const ta of sf.getTypeAliases()) { const n = ta.getName(); if (n) names.set(n, qualify(absRoot, sf, n)) }
    for (const en of sf.getEnums()) { const n = en.getName(); if (n) names.set(n, qualify(absRoot, sf, n)) }
    for (const vd of sf.getVariableDeclarations()) { const n = vd.getName(); if (n) names.set(n, qualify(absRoot, sf, n)) }
    if (names.size) declsByFile.set(sf.getFilePath(), names)
  }

  // Step 2: Build file path lookup for module resolution
  const knownPaths = new Set<string>()
  for (const sf of sourceFiles) knownPaths.add(sf.getFilePath())

  function resolveModule(fromFile: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) return undefined
    const dir = dirname(fromFile)
    const candidates = [
      resolve(dir, specifier),
      resolve(dir, specifier + ".ts"),
      resolve(dir, specifier + ".tsx"),
      resolve(dir, specifier + "/index.ts"),
      resolve(dir, specifier + "/index.tsx"),
    ]
    for (const c of candidates) {
      if (knownPaths.has(c)) return c
    }
    return undefined
  }

  const tree: DependencyTree = new Map()

  for (const sf of sourceFiles) {
    const localDecls = declsByFile.get(sf.getFilePath())
    if (!localDecls) continue

    // Build map: imported name -> qname from source file
    const importedNames = new Map<string, string>()
    for (const imp of sf.getImportDeclarations()) {
      const resolved = resolveModule(sf.getFilePath(), imp.getModuleSpecifierValue())
      if (!resolved) continue
      const sourceDecls = declsByFile.get(resolved)
      if (!sourceDecls) continue

      for (const named of imp.getNamedImports()) {
        const importedName = named.getAliasNode()?.getText() ?? named.getName()
        const sourceName = named.getName()
        const qname = sourceDecls.get(sourceName)
        if (qname) importedNames.set(importedName, qname)
      }
    }

    // For each tracked declaration, find which imported/local names it references
    for (const [name, qname] of localDecls) {
      // Find the declaration node
      let node: Node | undefined
      const dotIdx = name.indexOf(".")
      if (dotIdx >= 0) {
        const cls = sf.getClass(name.slice(0, dotIdx))
        node = cls?.getMethod(name.slice(dotIdx + 1))
      } else {
        node = sf.getFunction(name) ?? sf.getClass(name) ?? sf.getInterface(name) ??
               sf.getTypeAlias(name) ?? sf.getEnum(name) ?? sf.getVariableDeclaration(name) ?? undefined
      }
      if (!node) continue

      const usedNames = new Set<string>()
      for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
        usedNames.add(id.getText())
      }

      const deps = new Set<string>()
      for (const [importedName, depQname] of importedNames) {
        if (usedNames.has(importedName) && depQname !== qname) deps.add(depQname)
      }
      for (const [localName, localQname] of localDecls) {
        if (usedNames.has(localName) && localQname !== qname) deps.add(localQname)
      }

      tree.set(qname, deps)
    }
  }

  return tree
}
