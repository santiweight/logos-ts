import { Project, ts } from "ts-morph"

// Load a Logos-TS project: add our own .ts/.tsx sources but skip node_modules,
// so symbol resolution sees intra-project declarations without pulling library
// types (faster, and external symbols simply resolve to "untracked").
export function loadProject(root: string): Project {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: false,
      allowJs: false,
      noEmit: true,
    },
  })
  project.addSourceFilesAtPaths([
    `${root}/**/*.ts`,
    `${root}/**/*.tsx`,
    `!${root}/**/node_modules/**`,
    `!${root}/**/dist/**`,
  ])
  return project
}
