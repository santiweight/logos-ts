import { Node, SyntaxKind, type SourceFile, type Statement } from "ts-morph"
import { writeFileSync, readFileSync, unlinkSync } from "node:fs"
import { relative, resolve } from "node:path"
import { loadProject } from "./project.js"
import { computeTestAttachments, type TestRef } from "./backend.js"

interface Rec {
  name: string
  text: string
}

interface TestInline {
  name: string
  line: string
  file: string
}

interface ArchRecords {
  declarations: Rec[]
  testFiles: Record<string, string>
  attachments: Record<string, TestInline[]>
}

const isTest = (p: string) => /\.test\.[cm]?tsx?$/.test(p)

const allSources = (project: ReturnType<typeof loadProject>) =>
  project.getSourceFiles().filter(s => !s.getFilePath().includes("/node_modules/"))

const nonTests = (sfs: SourceFile[]) => sfs.filter(s => !isTest(s.getFilePath()))
const onlyTests = (sfs: SourceFile[]) => sfs.filter(s => isTest(s.getFilePath()))

function declQName(stmt: Statement, file: string): string | null {
  if (Node.isFunctionDeclaration(stmt)) {
    const n = stmt.getName()
    return n ? `${file}#${n}` : null
  }
  if (Node.isClassDeclaration(stmt)) {
    const n = stmt.getName()
    return n ? `${file}#${n}` : null
  }
  if (Node.isVariableStatement(stmt)) {
    const decls = stmt.getDeclarations()
    if (decls.length === 1 && Node.isIdentifier(decls[0].getNameNode()))
      return `${file}#${decls[0].getName()}`
  }
  return null
}

function analyzeTestBodies(testSfs: SourceFile[], absRoot: string): Map<string, string | null> {
  const result = new Map<string, string | null>()
  for (const sf of testSfs) {
    const file = relative(absRoot, sf.getFilePath())
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression()
      if (!Node.isIdentifier(expr)) continue
      const fname = expr.getText()
      if (fname !== "test" && fname !== "it") continue
      const args = call.getArguments()
      if (!args[0] || !Node.isStringLiteral(args[0])) continue
      const testName = args[0].getLiteralText()
      const cb = args.length > 1 ? args[args.length - 1] : null
      if (!cb || (!Node.isArrowFunction(cb) && !Node.isFunctionExpression(cb))) {
        result.set(`${file}:${testName}`, null)
        continue
      }
      const body = cb.getBody()
      if (Node.isBlock(body)) {
        const stmts = body.getStatements()
        if (stmts.length === 1 && Node.isExpressionStatement(stmts[0]))
          result.set(`${file}:${testName}`, stmts[0].getExpression().getText())
        else
          result.set(`${file}:${testName}`, null)
      } else {
        result.set(`${file}:${testName}`, body.getText())
      }
    }
  }
  return result
}

function collectTests(
  declKey: string,
  lookupKey: string,
  attachments: Map<string, TestRef[]>,
  bodyAnalysis: Map<string, string | null>,
  injections: Record<string, TestInline[]>,
  claimed: Set<string>,
) {
  const refs = attachments.get(lookupKey)
  if (!refs) return
  if (!injections[declKey]) injections[declKey] = []
  for (const ref of refs) {
    const claimKey = `${ref.file}:${ref.name}`
    if (claimed.has(claimKey)) continue
    claimed.add(claimKey)
    const exprText = bodyAnalysis.get(claimKey)
    const line = exprText
      ? `test(${JSON.stringify(ref.name)}, () => ${exprText})`
      : `test(${JSON.stringify(ref.name)})`
    injections[declKey].push({ name: ref.name, line, file: ref.file })
  }
}

function isTestCall(stmt: Statement): boolean {
  if (!Node.isExpressionStatement(stmt)) return false
  const expr = stmt.getExpression()
  if (!Node.isCallExpression(expr)) return false
  const fn = expr.getExpression()
  return Node.isIdentifier(fn) && (fn.getText() === "test" || fn.getText() === "it")
}

function isDescribeCall(stmt: Statement): boolean {
  if (!Node.isExpressionStatement(stmt)) return false
  const expr = stmt.getExpression()
  if (!Node.isCallExpression(expr)) return false
  const fn = expr.getExpression()
  return Node.isIdentifier(fn) && fn.getText() === "describe"
}

function extractTestsFromDescribe(stmt: Statement): { name: string; hasBody: boolean; bodyText?: string }[] {
  const results: { name: string; hasBody: boolean; bodyText?: string }[] = []
  const expr = (stmt as any).getExpression()
  const args = expr.getArguments()
  const cb = args.length > 1 ? args[args.length - 1] : null
  if (!cb || (!Node.isArrowFunction(cb) && !Node.isFunctionExpression(cb))) return results
  for (const call of cb.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const fn = call.getExpression()
    if (!Node.isIdentifier(fn) || (fn.getText() !== "test" && fn.getText() !== "it")) continue
    const testArgs = call.getArguments()
    if (!testArgs[0] || !Node.isStringLiteral(testArgs[0])) continue
    const testName = testArgs[0].getLiteralText()
    const testCb = testArgs.length > 1 ? testArgs[testArgs.length - 1] : null
    let hasBody = false
    let bodyText: string | undefined
    if (testCb && (Node.isArrowFunction(testCb) || Node.isFunctionExpression(testCb))) {
      hasBody = true
      bodyText = testCb.getText()
    }
    results.push({ name: testName, hasBody, bodyText })
  }
  return results
}

// ---- Strip ----

function strip(dir: string, recFile: string) {
  const project = loadProject(dir)
  const sfs = allSources(project)
  const srcFiles = nonTests(sfs)
  const testSfs = onlyTests(sfs)

  const attachments = computeTestAttachments(sfs, dir)
  const bodyAnalysis = analyzeTestBodies(testSfs, dir)

  const testFileContents: Record<string, string> = {}
  for (const tf of testSfs)
    testFileContents[relative(dir, tf.getFilePath())] = tf.getFullText()

  const injections: Record<string, TestInline[]> = {}
  const claimed = new Set<string>()

  for (const sf of srcFiles) {
    const file = relative(dir, sf.getFilePath())
    for (const fd of sf.getFunctions()) {
      const name = fd.getName()
      if (!name) continue
      collectTests(`${file}#${name}`, `${file}#${name}`, attachments, bodyAnalysis, injections, claimed)
    }
    for (const cd of sf.getClasses()) {
      const cname = cd.getName()
      if (!cname) continue
      const cq = `${file}#${cname}`
      collectTests(cq, cq, attachments, bodyAnalysis, injections, claimed)
      for (const m of cd.getMethods())
        collectTests(cq, `${file}#${cname}.${m.getName()}`, attachments, bodyAnalysis, injections, claimed)
    }
    for (const vs of sf.getVariableStatements()) {
      const decls = vs.getDeclarations()
      if (decls.length !== 1 || !Node.isIdentifier(decls[0].getNameNode())) continue
      const name = decls[0].getName()
      collectTests(`${file}#${name}`, `${file}#${name}`, attachments, bodyAnalysis, injections, claimed)
    }
  }

  // Strip declarations to signatures
  const counts = new Map<string, number>()
  const bump = (n?: string) => n && counts.set(n, (counts.get(n) ?? 0) + 1)
  for (const sf of srcFiles) {
    for (const fd of sf.getFunctions()) bump(fd.getName())
    for (const cd of sf.getClasses()) bump(cd.getName())
    for (const vs of sf.getVariableStatements()) for (const d of vs.getDeclarations()) bump(d.getName())
  }
  const uniq = (n?: string) => !!n && counts.get(n) === 1

  const recs: Rec[] = []
  for (const sf of srcFiles) {
    for (const fd of sf.getFunctions()) {
      if (!uniq(fd.getName()) || !fd.hasBody()) continue
      recs.push({ name: fd.getName()!, text: fd.getText() })
      fd.removeBody()
      fd.setHasDeclareKeyword(true)
    }
    for (const vs of sf.getVariableStatements()) {
      const decls = vs.getDeclarations()
      const name = decls[0]?.getName()
      if (decls.length !== 1 || !decls[0] || !Node.isIdentifier(decls[0].getNameNode())) continue
      if (!uniq(name) || !decls[0].getInitializer()) continue
      recs.push({ name: name!, text: vs.getText() })
      for (const d of decls) if (d.getInitializer()) d.removeInitializer()
      vs.setHasDeclareKeyword(true)
    }
    for (const cd of sf.getClasses()) {
      if (!uniq(cd.getName())) continue
      recs.push({ name: cd.getName()!, text: cd.getText() })
      for (const m of cd.getMethods()) if (m.hasBody()) m.removeBody()
      for (const c of cd.getConstructors()) if (c.hasBody()) c.removeBody()
      for (const p of cd.getProperties()) if (p.getInitializer()) p.removeInitializer()
      cd.setHasDeclareKeyword(true)
    }
  }

  // Inject test lines above declarations (bottom-to-top for stable indices)
  for (const sf of srcFiles) {
    const file = relative(dir, sf.getFilePath())
    const stmts = sf.getStatements()
    for (let i = stmts.length - 1; i >= 0; i--) {
      const qname = declQName(stmts[i], file)
      if (!qname || !injections[qname]?.length) continue
      sf.insertStatements(i, injections[qname].map(t => t.line))
    }
  }

  project.saveSync()
  for (const tf of testSfs) {
    try { unlinkSync(tf.getFilePath()) } catch {}
  }

  const records: ArchRecords = { declarations: recs, testFiles: testFileContents, attachments: injections }
  writeFileSync(recFile, JSON.stringify(records))
  console.log(`stripped ${recs.length} declarations; co-located tests from ${Object.keys(testFileContents).length} test files`)
}

// ---- Splice ----

function splice(dir: string, recFile: string) {
  const data: ArchRecords = JSON.parse(readFileSync(recFile, "utf8"))
  const byName = new Map(data.declarations.map(r => [r.name, r.text] as const))

  const project = loadProject(dir)
  const sfs = nonTests(allSources(project))

  // Extract test() calls from source files, associating each with the next declaration below
  const extractedByDecl = new Map<string, { name: string; hasBody: boolean; bodyText?: string }[]>()

  for (const sf of sfs) {
    const file = relative(dir, sf.getFilePath())
    const stmts = sf.getStatements()
    let pending: { name: string; hasBody: boolean; bodyText?: string }[] = []
    let lastDeclKey: string | null = null

    for (const stmt of stmts) {
      if (isTestCall(stmt)) {
        const expr = (stmt as any).getExpression()
        const args = expr.getArguments()
        const nameArg = args[0]
        if (Node.isStringLiteral(nameArg)) {
          const testName = nameArg.getLiteralText()
          const cb = args.length > 1 ? args[1] : null
          let hasBody = false
          let bodyText: string | undefined
          if (cb && (Node.isArrowFunction(cb) || Node.isFunctionExpression(cb))) {
            hasBody = true
            bodyText = cb.getText()
          }
          pending.push({ name: testName, hasBody, bodyText })
        }
        continue
      }

      if (isDescribeCall(stmt)) {
        pending.push(...extractTestsFromDescribe(stmt))
        continue
      }

      const qname = declQName(stmt, file)
      if (qname) {
        if (pending.length > 0) {
          extractedByDecl.set(qname, [...pending])
          pending = []
        }
        lastDeclKey = qname
      }
    }

    if (pending.length > 0) {
      const key = lastDeclKey ?? `${file}#__orphan__`
      const existing = extractedByDecl.get(key) ?? []
      extractedByDecl.set(key, [...existing, ...pending])
    }
  }

  // Remove test()/it()/describe() lines from source files (bottom-to-top)
  for (const sf of sfs) {
    const stmts = sf.getStatements()
    for (let i = stmts.length - 1; i >= 0; i--) {
      if (isTestCall(stmts[i]) || isDescribeCall(stmts[i])) stmts[i].remove()
    }
  }

  // Splice original bodies back
  let n = 0
  for (const sf of nonTests(allSources(project))) {
    for (const [name, text] of byName) {
      const fd = sf.getFunction(name)
      if (fd?.hasDeclareKeyword()) { fd.replaceWithText(text); n++; continue }
      const cd = sf.getClass(name)
      if (cd?.hasDeclareKeyword()) { cd.replaceWithText(text); n++; continue }
      const vs = sf.getVariableDeclaration(name)?.getVariableStatement()
      if (vs?.hasDeclareKeyword()) { vs.replaceWithText(text); n++ }
    }
  }

  // Reconstruct test files
  interface TestFileOp { remove: string[]; add: { name: string; code: string }[] }
  const ops = new Map<string, TestFileOp>()
  const getOps = (f: string) => { if (!ops.has(f)) ops.set(f, { remove: [], add: [] }); return ops.get(f)! }

  for (const [declKey, origTests] of Object.entries(data.attachments)) {
    const currentTests = extractedByDecl.get(declKey) ?? []
    const currentNames = new Set(currentTests.map(t => t.name))
    const origNames = new Set(origTests.map(t => t.name))
    const testFile = origTests[0]?.file
    if (!testFile) continue

    for (const ot of origTests)
      if (!currentNames.has(ot.name)) getOps(testFile).remove.push(ot.name)

    const origLineByName = new Map(origTests.map(t => [t.name, t.line]))
    for (const ct of currentTests) {
      if (!origNames.has(ct.name)) {
        const code = ct.hasBody
          ? `test(${JSON.stringify(ct.name)}, ${ct.bodyText})`
          : `test(${JSON.stringify(ct.name)}, () => { throw new Error("not implemented") })`
        getOps(testFile).add.push({ name: ct.name, code })
      } else if (ct.hasBody) {
        const origLine = origLineByName.get(ct.name) ?? ""
        const newLine = `test(${JSON.stringify(ct.name)}, ${ct.bodyText})`
        if (origLine !== newLine) {
          getOps(testFile).remove.push(ct.name)
          getOps(testFile).add.push({ name: ct.name, code: newLine })
        }
      }
    }
  }

  // Handle tests for new declarations not in original attachments
  for (const [declKey, tests] of extractedByDecl) {
    if (data.attachments[declKey]) continue
    const file = declKey.split("#")[0]
    const testFile = file.replace(/\.(tsx?)$/, ".test.$1")
    for (const ct of tests) {
      const code = ct.hasBody
        ? `test(${JSON.stringify(ct.name)}, ${ct.bodyText})`
        : `test(${JSON.stringify(ct.name)}, () => { throw new Error("not implemented") })`
      getOps(testFile).add.push({ name: ct.name, code })
    }
  }

  // Restore original test files into the project
  for (const [relPath, content] of Object.entries(data.testFiles)) {
    const absPath = resolve(dir, relPath)
    project.createSourceFile(absPath, content, { overwrite: true })
  }

  // Apply removals and additions
  for (const [relPath, fileOps] of ops) {
    const absPath = resolve(dir, relPath)
    let sf = project.getSourceFile(absPath)

    if (!sf) {
      sf = project.createSourceFile(absPath, `import { test, expect } from "vitest"\n\n`, { overwrite: true })
    }

    if (fileOps.remove.length > 0) {
      const removeSet = new Set(fileOps.remove)
      const stmts = sf.getStatements()
      for (let i = stmts.length - 1; i >= 0; i--) {
        const stmt = stmts[i]
        if (!Node.isExpressionStatement(stmt)) continue
        const expr = stmt.getExpression()
        if (!Node.isCallExpression(expr)) continue
        const fn = expr.getExpression()
        if (!Node.isIdentifier(fn) || (fn.getText() !== "test" && fn.getText() !== "it")) continue
        const args = expr.getArguments()
        if (args[0] && Node.isStringLiteral(args[0]) && removeSet.has(args[0].getLiteralText()))
          stmt.remove()
      }
    }

    for (const { code } of fileOps.add)
      sf.addStatements(code)
  }

  // Fix imports on all files and save
  for (const sf of allSources(project)) {
    try { sf.fixMissingImports(); sf.organizeImports() } catch {}
  }
  project.saveSync()
  console.log(`spliced ${n} declarations; updated ${ops.size} test files`)
}

const [, , cmd, dir, recFile] = process.argv
if (cmd === "strip") strip(dir, recFile)
else if (cmd === "splice") splice(dir, recFile)
else console.error("usage: archmode.ts strip|splice <dir> <recFile>")
