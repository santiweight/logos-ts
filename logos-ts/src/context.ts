import { Node, SyntaxKind, type SourceFile } from "ts-morph"
import { relative, resolve } from "node:path"
import { loadProject } from "./project.js"
import { buildDependencyTree } from "./dependencies.js"

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s)

function paramsOf(fn: any): string {
  return fn
    .getParameters()
    .map((p: any) => `${p.getNameNode().getText()}: ${p.getTypeNode()?.getText() ?? "any"}`)
    .join(", ")
}
function retOf(fn: any): string {
  const n = fn.getReturnTypeNode?.()?.getText()
  if (n) return n
  try {
    return fn.getReturnType().getText(fn)
  } catch {
    return ""
  }
}

// Architecture-level snippet: signatures for functions/methods/classes, full
// text for types (they ARE the architecture). Never function bodies.
function archSnippet(node: Node): string {
  const k = node.getKindName()
  if (k === "InterfaceDeclaration" || k === "TypeAliasDeclaration" || k === "EnumDeclaration")
    return node.getText()
  if (k === "FunctionDeclaration") {
    const fn = node as any
    return `function ${fn.getName()}(${paramsOf(fn)})${retOf(fn) ? `: ${retOf(fn)}` : ""}`
  }
  if (k === "MethodDeclaration") {
    const m = node as any
    return `${m.getName()}(${paramsOf(m)})${retOf(m) ? `: ${retOf(m)}` : ""}`
  }
  if (k === "ClassDeclaration") {
    const c = node as any
    const methods = c
      .getMethods()
      .map((m: any) => `  ${m.getName()}(${paramsOf(m)})${retOf(m) ? `: ${retOf(m)}` : ""}`)
      .join("\n")
    return `class ${c.getName()} {\n${methods}\n}`
  }
  if (k === "VariableDeclaration") {
    const vd = node as any
    const init = vd.getInitializer?.()
    const tn = vd.getTypeNode?.()?.getText()
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init)))
      return `const ${vd.getName()}${tn ? `: ${tn}` : ""} = (…) => …`
    return tn ? `const ${vd.getName()}: ${tn}` : `const ${vd.getName()} = ${truncate(init?.getText() ?? "", 100)}`
  }
  return truncate(node.getText(), 200)
}

// Recursive descent over a node's dependencies, emitting an architecture-only
// context bundle (grouped by file, with paths) up to `budget` chars.
export function buildArchContext(root: string, targets: string[], budget = 40000): string {
  const absRoot = resolve(root)
  const project = loadProject(root)
  const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))
  const tree = buildDependencyTree(sfs, root)

  const nodeOf = new Map<string, Node>()
  const fileOf = new Map<string, string>()
  for (const sf of sfs) {
    const file = relative(absRoot, sf.getFilePath())
    const add = (node: Node, name: string | undefined) => {
      if (!name) return
      const q = `${file}#${name}`
      nodeOf.set(q, node)
      fileOf.set(q, file)
    }
    for (const fd of sf.getFunctions()) add(fd, fd.getName())
    for (const cd of sf.getClasses()) {
      const c = cd.getName()
      if (c) {
        add(cd, c)
        for (const m of cd.getMethods()) add(m, `${c}.${m.getName()}`)
      }
    }
    for (const id of sf.getInterfaces()) add(id, id.getName())
    for (const ta of sf.getTypeAliases()) add(ta, ta.getName())
    for (const en of sf.getEnums()) add(en, en.getName())
    for (const vd of sf.getVariableDeclarations()) add(vd, vd.getName())
  }

  // resolve comment targets to graph nodes. file:/dir: targets expand to every
  // symbol in that file/folder; symbol targets (component:/fn:/cls:/method:/props:) match by name.
  const starts: string[] = []
  for (const t of targets) {
    if (t.startsWith("file:")) {
      const file = t.slice(5)
      for (const k of nodeOf.keys()) if (k.startsWith(`${file}#`)) starts.push(k)
    } else if (t.startsWith("dir:")) {
      const dir = t.slice(4).replace(/\/$/, "")
      for (const k of nodeOf.keys()) if (k.startsWith(`${dir}/`)) starts.push(k)
    } else {
      const name = t.includes(":") ? t.slice(t.indexOf(":") + 1) : t
      const q = [...nodeOf.keys()].find((k) => k.endsWith(`#${name}`))
      if (q) starts.push(q)
    }
  }

  // forward BFS (what the target depends on)
  const bfs = (adj: Map<string, Set<string>>, exclude: Set<string>): string[] => {
    const seen = new Set<string>(exclude)
    const order: string[] = []
    const queue = [...starts]
    for (const s of starts) seen.add(s)
    // seed: include the starts themselves first (forward only)
    if (adj === tree) for (const s of starts) order.push(s)
    while (queue.length) {
      const q = queue.shift()!
      for (const d of adj.get(q) ?? []) {
        if (seen.has(d)) continue
        seen.add(d)
        order.push(d)
        queue.push(d)
      }
    }
    return order
  }

  // reverse graph: who depends ON each node (callers)
  const callers = new Map<string, Set<string>>()
  for (const [n, deps] of tree) for (const d of deps) (callers.get(d) ?? callers.set(d, new Set()).get(d)!).add(n)

  const forwardOrder = bfs(tree, new Set())
  const fset = new Set(forwardOrder)
  const reverseOrder = bfs(callers, fset).filter((q) => !starts.includes(q))

  // ---- #2 type-flow: producers/consumers of the domain types the change handles ----
  const included = new Set([...forwardOrder, ...reverseOrder])
  const enclosingQName = (refNode: Node): string | null => {
    const decl = refNode.getFirstAncestor(
      (a) =>
        Node.isFunctionDeclaration(a) ||
        Node.isClassDeclaration(a) ||
        Node.isInterfaceDeclaration(a) ||
        Node.isTypeAliasDeclaration(a) ||
        Node.isEnumDeclaration(a) ||
        Node.isMethodDeclaration(a) ||
        (Node.isVariableDeclaration(a) && !!a.getName())
    )
    if (!decl) return null
    const file = relative(absRoot, decl.getSourceFile().getFilePath())
    if (Node.isMethodDeclaration(decl)) {
      const cls = decl.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName()
      return cls ? `${file}#${cls}.${decl.getName()}` : null
    }
    const name = (decl as any).getName?.()
    return name ? `${file}#${name}` : null
  }
  const typeFlowOrder: string[] = []
  const tfSeen = new Set<string>()
  for (const q of forwardOrder) {
    const node = nodeOf.get(q) as any
    const k = node?.getKindName()
    if (k !== "InterfaceDeclaration" && k !== "TypeAliasDeclaration" && k !== "EnumDeclaration") continue
    try {
      for (const rs of node.findReferences())
        for (const r of rs.getReferences()) {
          if (r.isDefinition()) continue
          const en = enclosingQName(r.getNode())
          if (en && nodeOf.has(en) && !included.has(en) && !tfSeen.has(en)) {
            tfSeen.add(en)
            typeFlowOrder.push(en)
          }
        }
    } catch {
      /* findReferences is best-effort */
    }
  }

  // ---- fills (priority order; small codebase ⇒ everything fits) ----
  const fill = (order: string[], cap: number) => {
    let usedC = 0
    let omitted = 0
    const byFile = new Map<string, string[]>()
    for (const q of order) {
      const node = nodeOf.get(q)
      if (!node) continue
      const snip = archSnippet(node)
      if (usedC + snip.length > cap) {
        omitted++
        continue
      }
      usedC += snip.length
      const f = fileOf.get(q)!
      ;(byFile.get(f) ?? byFile.set(f, []).get(f)!).push(snip)
    }
    return { byFile, used: usedC, omitted }
  }
  // The file(s) being edited get their FULL source (highest priority).
  const sfByFile = new Map<string, SourceFile>()
  for (const sf of sfs) sfByFile.set(relative(absRoot, sf.getFilePath()), sf)
  const targetFileSet = new Set<string>()
  for (const q of starts) {
    const parts = q.split("#")
    if (parts[0] != null) {
      targetFileSet.add(parts[0])
    }
  }
  const targetFiles = [...targetFileSet]
  const editFileSet = new Set(targetFiles)

  let used = 0
  const editFiles: { file: string; text: string }[] = []
  for (const file of targetFiles) {
    const sf = sfByFile.get(file)
    if (sf == null) continue
    const text = sf.getFullText()
    if (used + text.length > budget) continue // skip a file that wouldn't fit whole
    used += text.length
    editFiles.push({ file, text })
  }

  // Exact import sites that reference the edited file(s) — so a move/split/rename
  // refactor can rewire them without grepping.
  const importSites: string[] = []
  for (const sf of sfs) {
    const importerRel = relative(absRoot, sf.getFilePath())
    if (editFileSet.has(importerRel)) continue
    for (const imp of sf.getImportDeclarations()) {
      const targetSf = imp.getModuleSpecifierSourceFile()
      if (targetSf && editFileSet.has(relative(absRoot, targetSf.getFilePath()))) {
        importSites.push(`${importerRel}: ${imp.getText().replace(/\s+/g, " ")}`)
      }
    }
  }

  const take = (order: string[], frac: number) => {
    const r = fill(order, Math.min(Math.floor(budget * frac), Math.max(0, budget - used)))
    used += r.used
    return r
  }
  // deps/type-flow skip symbols that live in an edited file (already shown in full)
  const notEdited = (q: string) => {
    const file = q.split("#")[0]
    return file == null || !editFileSet.has(file)
  }
  const fwd = take(forwardOrder.filter(notEdited), 0.5)
  const tflow = take(typeFlowOrder.filter(notEdited), 0.25)
  const rev = take(reverseOrder, 0.1)

  // ---- #1 project map: every file + its top-level symbol names (cheap, complete) ----
  const buildMap = (cap: number) => {
    let out = ""
    for (const sf of sfs) {
      const file = relative(absRoot, sf.getFilePath())
      const names: string[] = []
      for (const fd of sf.getFunctions()) if (fd.getName()) names.push(`${fd.getName()}()`)
      for (const cd of sf.getClasses()) if (cd.getName()) names.push(`class ${cd.getName()}`)
      for (const id of sf.getInterfaces()) names.push(id.getName())
      for (const ta of sf.getTypeAliases()) names.push(ta.getName())
      for (const en of sf.getEnums()) names.push(en.getName())
      for (const vd of sf.getVariableDeclarations()) {
        const init = vd.getInitializer()
        names.push(
          init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
            ? `<${vd.getName()}>`
            : vd.getName()
        )
      }
      if (!names.length) continue
      const block = `${file}: ${names.join(", ")}\n`
      if (out.length + block.length > cap) break
      out += block
    }
    return out
  }
  const mapStr = buildMap(Math.max(1000, budget - used))

  // ---- emit ----
  let out =
    `# CONTEXT — for change to: ${targets.join(", ")}\n` +
    `# The file(s) you will edit are included BELOW IN FULL — no need to read them.\n` +
    `# Everything else is signatures + a project map. Do NOT grep/find/ls to rediscover.\n`

  if (editFiles.length) {
    out += `\n# ━━ FILE(S) TO EDIT — full current source ━━\n`
    for (const e of editFiles) out += `\n## ${e.file}\n${e.text}\n`
  }

  if (importSites.length) {
    out +=
      `\n# ━━ IMPORTED BY — exact import sites referencing the edited file(s); rewire these if you move/split/rename exports ━━\n`
    for (const s of importSites) out += `${s}\n`
  }

  out += `\n# ━━ DIRECTLY RELATED — signatures + types your change depends on ━━\n`
  for (const [f, snips] of fwd.byFile) out += `\n## ${f}\n${snips.join("\n")}\n`

  if (tflow.byFile.size) {
    out += `\n# ━━ TYPE FLOW — producers/consumers of the types your change handles (signatures) ━━\n`
    for (const [f, snips] of tflow.byFile) out += `\n## ${f}\n${snips.join("\n")}\n`
  }

  if (rev.byFile.size) {
    out += `\n# ━━ CALLERS — code that uses your change target; don't break these (signatures) ━━\n`
    for (const [f, snips] of rev.byFile) out += `\n## ${f}\n${snips.join("\n")}\n`
  }

  out += `\n# ━━ PROJECT MAP — every file and its top-level symbols (names; <X> = component) ━━\n${mapStr}`
  return out
}

// CLI: tsx src/context.ts <root> <budget> <targetId...>
const [, , root = "demos/hn-jobs", budgetStr = "40000", ...targets] = process.argv
process.stdout.write(buildArchContext(root, targets, Number(budgetStr) || 40000))
