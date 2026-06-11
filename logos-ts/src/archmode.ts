// Architecture mode: strip every declaration to its signature using `declare`
// (no bodies, no `=`, no values) — the agent edits this pure "architecture view"
// — then splice the original implementations back and infer imports.
import { Node } from "ts-morph"
import { writeFileSync, readFileSync } from "node:fs"
import { loadProject } from "./project.js"

interface Rec {
  name: string
  text: string // the full original declaration text (signature + body/value)
}

const sourceFiles = (project: any) =>
  project
    .getSourceFiles()
    .filter((s: any) => !s.getFilePath().includes("/node_modules/") && !/\.test\.[cm]?tsx?$/.test(s.getFilePath()))

function strip(dir: string, recFile: string) {
  const project = loadProject(dir)
  const sfs = sourceFiles(project)

  // Only strip uniquely-named declarations, so splice can restore unambiguously
  // (avoids dup names like the stories' `base`/`meta`).
  const counts = new Map<string, number>()
  const bump = (n?: string) => n && counts.set(n, (counts.get(n) ?? 0) + 1)
  for (const sf of sfs) {
    for (const fd of sf.getFunctions()) bump(fd.getName())
    for (const cd of sf.getClasses()) bump(cd.getName())
    for (const vs of sf.getVariableStatements()) for (const d of vs.getDeclarations()) bump(d.getName())
  }
  const uniq = (n?: string) => !!n && counts.get(n) === 1

  const recs: Rec[] = []
  for (const sf of sfs) {
    for (const fd of sf.getFunctions()) {
      if (!uniq(fd.getName()) || !fd.hasBody()) continue
      recs.push({ name: fd.getName()!, text: fd.getText() })
      fd.removeBody()
      fd.setHasDeclareKeyword(true)
    }
    for (const vs of sf.getVariableStatements()) {
      const decls = vs.getDeclarations()
      const name = decls[0]?.getName()
      // skip destructuring (`const { a } = …`) — no simple name to restore by
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

  project.saveSync()
  writeFileSync(recFile, JSON.stringify(recs))
  console.log(`stripped ${recs.length} declarations to signatures`)
}

function splice(dir: string, recFile: string) {
  const recs: Rec[] = JSON.parse(readFileSync(recFile, "utf8"))
  const byName = new Map(recs.map((r) => [r.name, r.text] as const))

  const project = loadProject(dir)
  let n = 0
  for (const sf of sourceFiles(project)) {
    for (const [name, text] of byName) {
      const fd = sf.getFunction(name)
      if (fd?.hasDeclareKeyword()) {
        fd.replaceWithText(text)
        n++
        continue
      }
      const cd = sf.getClass(name)
      if (cd?.hasDeclareKeyword()) {
        cd.replaceWithText(text)
        n++
        continue
      }
      const vs = sf.getVariableDeclaration(name)?.getVariableStatement()
      if (vs?.hasDeclareKeyword()) {
        vs.replaceWithText(text)
        n++
      }
    }
  }
  // imports: add missing, drop now-stale, sort
  for (const sf of sourceFiles(project)) {
    try {
      sf.fixMissingImports()
      sf.organizeImports()
    } catch {
      /* best effort */
    }
  }
  project.saveSync()
  console.log(`spliced ${n} declarations; imports inferred`)
}

const [, , cmd, dir, recFile] = process.argv
if (cmd === "strip") strip(dir, recFile)
else if (cmd === "splice") splice(dir, recFile)
else console.error("usage: archmode.ts strip|splice <dir> <recFile>")
