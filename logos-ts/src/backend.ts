import {
  Node,
  SyntaxKind,
  type SourceFile,
  type FunctionDeclaration,
  type MethodDeclaration,
} from "ts-morph"
import { relative, resolve, dirname } from "node:path"
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

function signatureOf(fn: FunctionDeclaration | MethodDeclaration, name: string): string {
  const ps = fn
    .getParameters()
    .map((p) => `${p.getNameNode().getText()}: ${p.getTypeNode()?.getText() ?? "any"}`)
    .join(", ")
  const ret = fn.getReturnTypeNode()?.getText() ?? ""
  return `${name}(${ps})${ret ? `: ${ret}` : ""}`
}

const shortDeps = (tree: DependencyTree, q: string) =>
  [...(tree.get(q) ?? [])].map((d) => d.split("#")[1] ?? d).sort()

// Build a lookup of declarations across all non-test source files:
//   name -> { qname, kind: "function" | "class" | "method", classQname? }
interface DeclInfo {
  qname: string
  kind: "function" | "class" | "method"
  classQname?: string
}

function buildDeclLookup(sfs: SourceFile[], absRoot: string): Map<string, Map<string, DeclInfo>> {
  const byFile = new Map<string, Map<string, DeclInfo>>()
  for (const sf of sfs) {
    if (isTestFile(sf.getFilePath())) continue
    const file = relative(absRoot, sf.getFilePath())
    const decls = new Map<string, DeclInfo>()
    for (const fd of sf.getFunctions()) {
      const n = fd.getName()
      if (n) decls.set(n, { qname: `${file}#${n}`, kind: "function" })
    }
    for (const cd of sf.getClasses()) {
      const n = cd.getName()
      if (n) {
        const cq = `${file}#${n}`
        decls.set(n, { qname: cq, kind: "class" })
        for (const m of cd.getMethods()) {
          decls.set(`${n}.${m.getName()}`, { qname: `${file}#${n}.${m.getName()}`, kind: "method", classQname: cq })
        }
      }
    }
    if (decls.size) byFile.set(sf.getFilePath(), decls)
  }
  return byFile
}

function resolveModule(fromFile: string, specifier: string, knownPaths: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined
  const dir = dirname(fromFile)
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const c = resolve(dir, specifier + ext)
    if (knownPaths.has(c)) return c
  }
  return undefined
}

export function computeTestAttachments(sfs: SourceFile[], absRoot: string): Map<string, TestRef[]> {
  const out = new Map<string, TestRef[]>()
  const push = (q: string, t: TestRef) => {
    const arr = out.get(q) ?? out.set(q, []).get(q)!
    arr.push(t)
  }

  const declsByFile = buildDeclLookup(sfs, absRoot)
  const knownPaths = new Set(sfs.map((s) => s.getFilePath()))

  for (const sf of sfs) {
    if (!isTestFile(sf.getFilePath())) continue
    const file = relative(absRoot, sf.getFilePath())

    // Build import map: imported name -> DeclInfo from source file
    const importedDecls = new Map<string, DeclInfo>()
    for (const imp of sf.getImportDeclarations()) {
      const resolved = resolveModule(sf.getFilePath(), imp.getModuleSpecifierValue(), knownPaths)
      if (!resolved) continue
      const sourceDecls = declsByFile.get(resolved)
      if (!sourceDecls) continue

      for (const named of imp.getNamedImports()) {
        const importedName = named.getAliasNode()?.getText() ?? named.getName()
        const sourceName = named.getName()
        const info = sourceDecls.get(sourceName)
        if (info) importedDecls.set(importedName, info)
      }
    }

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

      // Collect all identifiers used in the test callback
      const usedNames = new Set<string>()
      for (const id of cb.getDescendantsOfKind(SyntaxKind.Identifier)) {
        usedNames.add(id.getText())
      }

      // Also check for property access patterns like `instance.method()`
      const methodCalls = new Set<string>()
      for (const pae of cb.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const objText = pae.getExpression().getText()
        const propName = pae.getName()
        // Check if the object was created with `new ClassName()`
        // We track the variable name -> class name mapping
        methodCalls.add(`${objText}.${propName}`)
      }

      const funcs = new Set<string>()
      const classes = new Set<string>()
      const methodsByClass = new Map<string, Set<string>>()

      for (const [importedName, info] of importedDecls) {
        if (!usedNames.has(importedName)) continue
        if (info.kind === "function") funcs.add(info.qname)
        else if (info.kind === "class") {
          classes.add(info.qname)
          // Check if any methods of this class are called via property access
          const sourceFile = [...declsByFile.entries()].find(([, decls]) =>
            [...decls.values()].some((d) => d.qname === info.qname)
          )
          if (sourceFile) {
            for (const [declName, declInfo] of sourceFile[1]) {
              if (declInfo.kind === "method" && declInfo.classQname === info.qname) {
                const methodName = declName.split(".")[1]
                // Check if any variable of this class type has this method called
                for (const mc of methodCalls) {
                  if (mc.endsWith(`.${methodName}`)) {
                    const set = methodsByClass.get(info.qname) ?? methodsByClass.set(info.qname, new Set()).get(info.qname)!
                    set.add(declInfo.qname)
                  }
                }
              }
            }
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
    if (isTestFile(sf.getFilePath()) || /\.stories\.(t|j)sx?$/.test(file)) continue

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
