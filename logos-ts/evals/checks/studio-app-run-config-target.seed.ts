import { readFileSync, writeFileSync } from "node:fs"

const file = "src/detect-project.ts"
const before = readFileSync(file, "utf8")
const after = before
  .replace('LOGOS_PROJECT: "${WORKSPACE_ROOT}/demos/hn-jobs"', 'LOGOS_PROJECT: "${WORKSPACE_ROOT}"')
  .replace('LOGOS_STARTUP_PROJECT: "${WORKSPACE_ROOT}/demos/hn-jobs"', 'LOGOS_STARTUP_PROJECT: "${WORKSPACE_ROOT}"')

if (after === before) {
  throw new Error("seed could not restore recursive Studio default to the old Logos Studio target")
}

writeFileSync(file, after)
