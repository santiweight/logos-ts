import {
  Node,
  SyntaxKind,
  type SourceFile,
  type FunctionDeclaration,
  type MethodDeclaration,
} from "ts-morph"
import { relative } from "node:path"
import type { DependencyTree } from "./model.js"

export interface TestRef {
  name: string
  file: string
  description?: string
  code: string
}
export interface BackendFn {
  kind: "function"
  name: string
  signature: string
  code: string
  deps: string[]
  tests: TestRef[]
}
export interface BackendMethod {
  name: string
  signature: string
  code: string
  tests: TestRef[]
}
export interface BackendClass {
  kind: "class"
  name: string
  fields: { name: string; type: string }[]
  methods: BackendMethod[]
  deps: string[]
  tests: TestRef[]
  code: string
}
export interface BackendFile {
  file: string
  code: string
  items: (BackendFn | BackendClass)[]
}

const isTestFile = (p: string) => /\.test\.(t|j)sx?$/.test(p)
const inProject = (p: string) => p.includes("/hn-jobs/") && !p.includes("/node_modules/")

function signatureOf(fn: FunctionDeclaration | MethodDeclaration, name: string): string {
  const ps = fn
    .getParameters()
    .map((p) => `${p.getNameNode().getText()}: ${p.getTypeNode()?.getText() ?? "any"}`)
    .join(", ")
  let ret = fn.getReturnTypeNode()?.getText()
  if (!ret) {
    try {
      ret = fn.getReturnType().getText(fn)
    } catch {
      ret = ""
    }
  }
  return `${name}(${ps})${ret ? `: ${ret}` : ""}`
}

const shortDeps = (tree: DependencyTree, q: string) =>
  [...(tree.get(q) ?? [])].map((d) => d.split("#")[1] ?? d).sort()

// For each it()/test(), resolve referenced symbols and attach to the finest:
// free function -> the function; exactly one method of a class -> that method;
// two or more methods of one class -> the class. (The ambient `new Class` edge
// only attaches to the class when no method of it is referenced.)
export function computeTestAttachments(sfs: SourceFile[], absRoot: string): Map<string, TestRef[]> {
  const out = new Map<string, TestRef[]>()
  const push = (q: string, t: TestRef) => {
    const arr = out.get(q) ?? out.set(q, []).get(q)!
    arr.push(t)
  }
  const qn = (d: Node): string | null => {
    const file = relative(absRoot, d.getSourceFile().getFilePath())
    const k = d.getKindName()
    if (k === "FunctionDeclaration") return `${file}#${(d as FunctionDeclaration).getName() ?? ""}`
    if (k === "ClassDeclaration") return `${file}#${(d as any).getName?.() ?? ""}`
    if (k === "MethodDeclaration") {
      const cls = d.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName()
      return cls ? `${file}#${cls}.${(d as MethodDeclaration).getName()}` : null
    }
    return null
  }

  for (const sf of sfs) {
    if (!isTestFile(sf.getFilePath())) continue
    const file = relative(absRoot, sf.getFilePath())
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression()
      const fname = Node.isIdentifier(expr)
        ? expr.getText()
        : Node.isPropertyAccessExpression(expr)
          ? expr.getExpression().getText()
          : ""
      if (fname !== "it" && fname !== "test") continue
      const args = call.getArguments()
      const nameArg = args[0]
      const testName = Node.isStringLiteral(nameArg) ? nameArg.getLiteralText() : "<dynamic>"
      const cb = args[args.length - 1]
      if (!cb) continue

      const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
      const description =
        (stmt ?? call)
          .getLeadingCommentRanges()
          .map((c) =>
            c
              .getText()
              .replace(/^\/\/+/, "")
              .replace(/^\/\*+/, "")
              .replace(/\*+\/$/, "")
              .replace(/^\s*\*/gm, "")
              .trim()
          )
          .filter(Boolean)
          .join(" ")
          .trim() || undefined

      const funcs = new Set<string>()
      const classes = new Set<string>()
      const methodsByClass = new Map<string, Set<string>>()

      for (const id of cb.getDescendantsOfKind(SyntaxKind.Identifier)) {
        let sym = id.getSymbol()
        if (!sym) continue
        sym = sym.getAliasedSymbol() ?? sym
        for (const d of sym.getDeclarations()) {
          if (!inProject(d.getSourceFile().getFilePath()) || isTestFile(d.getSourceFile().getFilePath()))
            continue
          const k = d.getKindName()
          const q = qn(d)
          if (!q) continue
          if (k === "FunctionDeclaration") funcs.add(q)
          else if (k === "ClassDeclaration") classes.add(q)
          else if (k === "MethodDeclaration") {
            const cls = d.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)?.getName()
            const cf = relative(absRoot, d.getSourceFile().getFilePath())
            const cq = `${cf}#${cls}`
            const set = methodsByClass.get(cq) ?? methodsByClass.set(cq, new Set()).get(cq)!
            set.add(q)
          }
        }
      }

      const ref: TestRef = { name: testName, file, description, code: call.getText() }
      for (const q of funcs) push(q, ref)
      for (const [cq, ms] of methodsByClass) push(ms.size === 1 ? [...ms][0] : cq, ref)
      for (const cq of classes) if (!methodsByClass.has(cq)) push(cq, ref)
    }
  }
  return out
}

export function extractBackend(
  sfs: SourceFile[],
  tree: DependencyTree,
  attachments: Map<string, TestRef[]>,
  absRoot: string
): BackendFile[] {
  const files: BackendFile[] = []
  for (const sf of sfs) {
    const file = relative(absRoot, sf.getFilePath())
    if (!file.startsWith("backend/") || isTestFile(sf.getFilePath())) continue

    const items: (BackendFn | BackendClass)[] = []
    for (const fd of sf.getFunctions()) {
      const name = fd.getName()
      if (!name) continue
      const q = `${file}#${name}`
      items.push({
        kind: "function",
        name,
        signature: signatureOf(fd, name),
        code: fd.getText(),
        deps: shortDeps(tree, q),
        tests: attachments.get(q) ?? [],
      })
    }
    for (const cd of sf.getClasses()) {
      const cname = cd.getName()
      if (!cname) continue
      const cq = `${file}#${cname}`
      const methods: BackendMethod[] = cd.getMethods().map((m) => {
        const mq = `${file}#${cname}.${m.getName()}`
        return {
          name: m.getName(),
          signature: signatureOf(m, m.getName()),
          code: m.getText(),
          tests: attachments.get(mq) ?? [],
        }
      })
      items.push({
        kind: "class",
        name: cname,
        fields: cd.getProperties().map((p) => ({ name: p.getName(), type: p.getTypeNode()?.getText() ?? "any" })),
        methods,
        deps: shortDeps(tree, cq).filter((d) => !methods.some((m) => d === `${cname}.${m.name}` || d === m.name)),
        tests: attachments.get(cq) ?? [],
        code: cd.getText(),
      })
    }
    if (items.length) files.push({ file, code: sf.getFullText(), items })
  }
  files.sort((a, b) => a.file.localeCompare(b.file))
  return files
}
