import { Node, SyntaxKind, type SourceFile } from "ts-morph"
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadProject } from "./project.js"
import { buildDependencyTree } from "./dependencies.js"
import { detectProject, type RunTargetCaps } from "./detect-project.js"

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

const RUN_CONFIG_CANDIDATES = [
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  ".env.example",
]

const MODULE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]
const MODULE_INDEXES = [
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
  "/index.json",
]

interface RunTargetContext {
  target: RunTargetCaps
  scriptName: string | null
  script: string | null
  files: string[]
}

function readPackage(cwd: string): { scripts?: Record<string, unknown>; name?: unknown } | null {
  try {
    return JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown>; name?: unknown }
  } catch {
    return null
  }
}

function addExistingFile(absRoot: string, files: string[], abs: string): void {
  if (!existsSync(abs)) return
  const rel = relative(absRoot, abs)
  if (!rel.startsWith("..") && rel !== "" && !files.includes(rel)) files.push(rel)
}

function readRawFile(absRoot: string, file: string): string | null {
  try {
    const abs = resolve(absRoot, file)
    if (!existsSync(abs)) return null
    return readFileSync(abs, "utf8")
  } catch {
    return null
  }
}

function targetScriptName(target: RunTargetCaps): string | null {
  const command = basename(target.command)
  if (command !== "npm" && command !== "pnpm" && command !== "yarn") return null
  if (command === "pnpm" && target.args[0] && target.args[0] !== "run" && target.args[0] !== "exec") return target.args[0]
  const runIndex = target.args.findIndex((arg) => arg === "run")
  if (runIndex < 0) return null
  return target.args[runIndex + 1] ?? null
}

function commandTextForTarget(target: RunTargetCaps, script: string | null): string {
  return [target.command, ...target.args, script ?? ""].join(" ")
}

function runConfigCueScore(text: string): number {
  const patterns = [
    /\bdev:mini\b/,
    /\bmini\b/i,
    /\bWORKSPACE_ROOT\b/,
    /demos\/[\w-]+/,
    /\bLOGOS_(?:PROJECT|STARTUP_PROJECT)\b/,
    /\b(?:STARTUP_)?PROJECT\b/,
    /\bprocess\.env\b/,
    /\benv\s*:/,
    /\bcwd\s*:/,
    /\bargs\s*:/,
    /\bcommand\s*:/,
  ]
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}

function runConfigFullSourceScore(file: string, text: string): number {
  if (file.endsWith("package.json")) return 100
  const patterns = [
    /\bLOGOS_(?:PROJECT|STARTUP_PROJECT)\b/,
    /\bdev:mini\b/,
    /\bWORKSPACE_ROOT\b/,
    /demos\/[\w-]+/,
    /\bRunTargetCaps\b/,
    /\brunTargetEnv\b/,
    /\bdetectRuns\b/,
  ]
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}

function resolveLocalModule(fromDir: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null
  const base = isAbsolute(spec) ? spec : resolve(fromDir, spec)
  for (const ext of MODULE_EXTENSIONS) {
    const candidate = `${base}${ext}`
    if (existsSync(candidate)) return candidate
  }
  for (const index of MODULE_INDEXES) {
    const candidate = `${base}${index}`
    if (existsSync(candidate)) return candidate
  }
  return null
}

function moduleSpecs(text: string): string[] {
  const specs: string[] = []
  const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|(?:require|import)\(\s*["']([^"']+)["']\s*\)/g
  for (const match of text.matchAll(importRe)) {
    const spec = match[1] ?? match[2]
    if (spec) specs.push(spec)
  }
  return specs
}

function scriptPathRefs(text: string): string[] {
  const refs: string[] = []
  const pathRe = /(?:^|\s)(["']?)([\w@./-]+\.(?:mjs|cjs|js|jsx|ts|tsx|json))\1(?=\s|$)/g
  for (const match of text.matchAll(pathRe)) {
    const ref = match[2]
    if (!ref) continue
    if (!ref.includes("/") && !ref.startsWith(".")) continue
    refs.push(ref)
  }
  return refs
}

function expandLocalFile(absRoot: string, files: string[], abs: string, seen = new Set<string>()): void {
  const resolved = resolve(abs)
  if (seen.has(resolved)) return
  seen.add(resolved)
  addExistingFile(absRoot, files, resolved)
  const rel = relative(absRoot, resolved)
  if (rel.startsWith("..")) return
  const text = readRawFile(absRoot, rel)
  if (text == null) return
  for (const spec of moduleSpecs(text)) {
    const dep = resolveLocalModule(dirname(resolved), spec)
    if (dep) expandLocalFile(absRoot, files, dep, seen)
  }
}

function addRunConfigCandidate(absRoot: string, files: string[], abs: string): void {
  if (!existsSync(abs)) return
  expandLocalFile(absRoot, files, abs)
}

function runTargetContext(absRoot: string, targetId: string): RunTargetContext | null {
  const target = detectProject(absRoot).runs.find((candidate) => candidate.id === targetId)
  if (!target) return null
  const files: string[] = []
  const pkg = readPackage(target.cwd)
  addExistingFile(absRoot, files, resolve(target.cwd, "package.json"))

  const scriptName = targetScriptName(target)
  const script = scriptName && typeof pkg?.scripts?.[scriptName] === "string" ? pkg.scripts[scriptName] : null
  if (script) {
    for (const ref of scriptPathRefs(script)) expandLocalFile(absRoot, files, resolve(target.cwd, ref))
  }

  const commandText = commandTextForTarget(target, script)
  const configCandidates = RUN_CONFIG_CANDIDATES.filter((candidate) => {
    if (candidate === "package.json") return false
    if (candidate.startsWith("vite.config")) return target.framework === "vite" || /\bvite\b/.test(commandText)
    if (candidate.startsWith("next.config")) return target.framework === "next" || /\bnext\b/.test(commandText)
    return true
  })
  for (const candidate of configCandidates) addRunConfigCandidate(absRoot, files, resolve(target.cwd, candidate))
  return { target, scriptName, script, files }
}

function runTargetSummary(absRoot: string, targetId: string): string | null {
  const context = runTargetContext(absRoot, targetId)
  if (!context) return null
  const cwd = relative(absRoot, context.target.cwd) || "."
  const cueLines: Array<{ score: number; line: string }> = []
  for (const file of context.files) {
    const text = readRawFile(absRoot, file)
    if (!text) continue
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]?.trim()
      if (!line) continue
      const score = runConfigCueScore(line)
      if (score === 0) continue
      cueLines.push({ score, line: `${file}:${i + 1}: ${line}` })
    }
  }
  const lines = [
    `## run:${targetId}`,
    `label: ${context.target.label}`,
    `cwd: ${cwd}`,
    `command: ${[context.target.command, ...context.target.args].join(" ")}`,
  ]
  if (context.target.env && Object.keys(context.target.env).length) {
    lines.push(`env:\n${Object.entries(context.target.env).map(([key, value]) => `- ${key}=${value}`).join("\n")}`)
    const targetLikeEnv = Object.entries(context.target.env).filter(([key]) => /(?:PROJECT|TARGET)/.test(key))
    if (targetLikeEnv.length) {
      lines.push(`target/project env:\n${targetLikeEnv.map(([key, value]) => `- ${key}=${value}`).join("\n")}`)
      lines.push(`selected-run target guidance: this run's project/target is controlled by these env values; update the source of these values while preserving run id ${targetId}.`)
    }
  }
  if (context.scriptName) lines.push(`package script: ${context.scriptName}${context.script ? ` = ${context.script}` : ""}`)
  if (context.files.length) lines.push(`config/provenance files: ${context.files.join(", ")}`)
  const topCueLines = cueLines
    .sort((a, b) => b.score - a.score || a.line.localeCompare(b.line))
    .slice(0, 16)
    .map((cue) => cue.line)
  if (topCueLines.length) lines.push(`run config cues:\n${topCueLines.map((line) => `- ${line}`).join("\n")}`)
  return lines.join("\n")
}

function runTargetFileEntries(absRoot: string, files: string[]): { file: string; text: string }[] {
  return files
    .map((file) => ({ file, text: readRawFile(absRoot, file) }))
    .filter((entry): entry is { file: string; text: string } => entry.text != null)
    .sort((a, b) => {
      if (a.file.endsWith("package.json") && !b.file.endsWith("package.json")) return -1
      if (!a.file.endsWith("package.json") && b.file.endsWith("package.json")) return 1
      const score = runConfigFullSourceScore(b.file, b.text) - runConfigFullSourceScore(a.file, a.text)
      if (score !== 0) return score
      return a.text.length - b.text.length
    })
}

function buildRunTargetOnlyContext(absRoot: string, targets: string[], budget: number): string {
  const targetIds = targets.map((target) => target.slice(4))
  const contexts = targetIds.map((targetId) => runTargetContext(absRoot, targetId)).filter((context): context is RunTargetContext => !!context)
  const summaries = targetIds.map((targetId) => runTargetSummary(absRoot, targetId)).filter((summary): summary is string => !!summary)
  const files = new Set<string>()
  const hasSelectedEnv = contexts.some((context) => context.target.env && Object.keys(context.target.env).length > 0)
  for (const context of contexts) {
    for (const file of context.files) files.add(file)
  }

  let out =
    `# CONTEXT - for change to: ${targets.join(", ")}\n` +
    `# The file(s) you will edit are included BELOW IN FULL - no need to read them.\n` +
    `# This is run-target configuration context: focus on cwd, command, env, package scripts, and config/provenance files.\n`

  if (summaries.length) {
    out +=
      `\n# RUN TARGET - the comment is attached to this runnable workspace target\n` +
      `# Change requests on run targets are usually about the selected target's cwd, command, env, package scripts, or config/provenance files.\n` +
      `# Keep the selected run target selected. The selected target id is explicit; do not solve the request by changing package discovery order, labels, or which run becomes first/default.\n` +
      `# If the selected run has PROJECT or TARGET env vars and the user asks to change its target/project, update the source of those env values. Do not change findPackageDirs or add a different App run.\n` +
      `${summaries.join("\n\n")}\n`
  }

  out += `\n# FILE(S) TO EDIT - full current source\n`
  let used = out.length
  for (const { file, text } of runTargetFileEntries(absRoot, [...files])) {
    if (hasSelectedEnv && runConfigFullSourceScore(file, text) === 0) continue
    if (runConfigFullSourceScore(file, text) < 3 && text.length > 2500) continue
    const block = `\n## ${file}\n${text}\n`
    if (used + block.length > budget) continue
    out += block
    used += block.length
  }
  return out
}

// Recursive descent over a node's dependencies, emitting an architecture-only
// context bundle (grouped by file, with paths) up to `budget` chars.
export function buildArchContext(root: string, targets: string[], budget = 40000): string {
  const absRoot = resolve(root)
  if (targets.length > 0 && targets.every((target) => target.startsWith("run:"))) {
    return buildRunTargetOnlyContext(absRoot, targets, budget)
  }

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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , root = "demos/hn-jobs", budgetStr = "40000", ...targets] = process.argv
  process.stdout.write(buildArchContext(root, targets, Number(budgetStr) || 40000))
}
