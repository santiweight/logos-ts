import { loadProject, extractArchitecture, buildDependencyTree, extractStoryMap } from "./index.js"
import { SyntaxKind } from "ts-morph"

const root = process.argv[2] ?? "../hn-jobs"
const project = loadProject(root)
const sfs = project.getSourceFiles().filter((s) => !s.getFilePath().includes("/node_modules/"))

// ---- Architecture per file ----
console.log("=== ARCHITECTURE (per file) ===")
for (const sf of sfs) {
  const rel = sf.getFilePath().replace(process.cwd() + "/../hn-jobs/", "")
  const a = extractArchitecture(sf)
  const names = a.items.map((i) => (i.kind === "class" ? `class ${i.name}` : i.name))
  console.log(`${rel}: ${names.join(", ") || "(none)"}${a.tests.length ? `  tests=${a.tests.length}` : ""}`)
}

// ---- Collision check: bare names declared more than once ----
console.log("\n=== NAME COLLISIONS (tree keys that merge multiple decls) ===")
const counts = new Map<string, number>()
for (const sf of sfs) {
  for (const fd of sf.getFunctions()) if (fd.getName()) counts.set(fd.getName()!, (counts.get(fd.getName()!) ?? 0) + 1)
  for (const cd of sf.getClasses()) if (cd.getName()) counts.set(cd.getName()!, (counts.get(cd.getName()!) ?? 0) + 1)
  for (const id of sf.getInterfaces()) counts.set(id.getName(), (counts.get(id.getName()) ?? 0) + 1)
  for (const ta of sf.getTypeAliases()) counts.set(ta.getName(), (counts.get(ta.getName()) ?? 0) + 1)
  for (const en of sf.getEnums()) counts.set(en.getName(), (counts.get(en.getName()) ?? 0) + 1)
  for (const vd of sf.getVariableDeclarations()) counts.set(vd.getName(), (counts.get(vd.getName()) ?? 0) + 1)
}
const collisions = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
console.log(collisions.map(([n, c]) => `${n}×${c}`).join("  ") || "(none)")

// ---- Full dependency tree (non-empty edges only) ----
console.log("\n=== DEPENDENCY TREE (non-empty) ===")
const tree = buildDependencyTree(sfs, root)
for (const name of [...tree.keys()].sort()) {
  const deps = [...tree.get(name)!].sort()
  if (deps.length) console.log(`${name} -> [${deps.join(", ")}]`)
}

// ---- Stories ----
const stories = extractStoryMap(sfs)
console.log(`\n=== STORIES: ${stories.size} mapped ===`)
const unknown = [...stories].filter(([, c]) => c === "<unknown>")
console.log(`unknown component: ${unknown.length}`)
