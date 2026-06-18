import {
  loadProject,
  extractArchitecture,
  buildDependencyTree,
  extractStoryMap,
  dependencyTreeToJSON,
  storyMapToJSON,
} from "./index.js"

const root = process.argv[2] ?? "demos/hn-jobs"
const project = loadProject(root)
const sourceFiles = project.getSourceFiles()

console.log(`# logos-ts demo — analyzing ${root}`)
console.log(`# ${sourceFiles.length} source files\n`)

// ---- #1 Architecture: show one representative component ----
const jobRow = sourceFiles.find((sf) => sf.getFilePath().endsWith("JobRow.tsx"))
if (jobRow) {
  console.log("## #1 Architecture — JobRow.tsx")
  const arch = extractArchitecture(jobRow)
  for (const item of arch.items) {
    if (item.kind === "function") {
      const sig = item.args.map((a) => `${a.name}: ${a.type}`).join(", ")
      console.log(`  fn ${item.name}(${sig}): ${item.retTy}  [body ${item.body.length} chars]`)
    } else {
      console.log(`  class ${item.name} — ${item.fields.length} fields, ${item.functions.length} methods`)
    }
  }
  console.log(`  tests: ${arch.tests.length}\n`)
}

// Architecture of the backend store (a class) to show class extraction.
const store = sourceFiles.find((sf) => sf.getFilePath().endsWith("jobStore.ts"))
if (store) {
  console.log("## #1 Architecture — jobStore.ts (class)")
  for (const item of extractArchitecture(store).items) {
    if (item.kind === "class") {
      console.log(`  class ${item.name}`)
      for (const m of item.functions) {
        const sig = m.args.map((a) => `${a.name}: ${a.type}`).join(", ")
        console.log(`    .${m.name}(${sig}): ${m.retTy}`)
      }
    }
  }
  console.log()
}

// ---- #2 Dependency tree ----
console.log("## #2 Dependency tree (qualified name -> referenced names)")
const tree = buildDependencyTree(sourceFiles, root)
const json = dependencyTreeToJSON(tree)
for (const name of ["JobRow", "JobRowProps", "DirectoryView", "JobTable"]) {
  const entry = Object.entries(json).find(([k]) => k.endsWith(`#${name}`))
  if (entry) console.log(`  ${entry[0]} -> [${entry[1].join(", ")}]`)
}
console.log()

// ---- #3 Stories ----
console.log("## #3 Story map (story id -> component)")
const stories = storyMapToJSON(extractStoryMap(sourceFiles))
for (const [id, component] of Object.entries(stories)) {
  console.log(`  ${id} -> ${component}`)
}
