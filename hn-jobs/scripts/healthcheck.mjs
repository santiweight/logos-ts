#!/usr/bin/env node
// One API to run the important tests and report. Run from the project root:
//   node scripts/healthcheck.mjs            # run the whole suite
//   node scripts/healthcheck.mjs job-filters  # only test files matching a path substring
// Prints a JSON summary { total, passed, failed, failures[] } and exits non-zero
// if anything failed. (Streaming/affected-selection come later.)
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const bin = resolve(root, "frontend/node_modules/.bin/vitest")
const out = resolve(root, ".healthcheck.json")
const filters = process.argv.slice(2)

try {
  execFileSync(bin, ["run", "--reporter=json", `--outputFile=${out}`, ...filters], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"],
  })
} catch {
  // vitest exits non-zero when tests fail; we read the report regardless.
}

let report
try {
  report = JSON.parse(readFileSync(out, "utf8"))
} catch {
  console.error("healthcheck: no test report produced")
  process.exit(2)
}
rmSync(out, { force: true })

const failures = []
for (const f of report.testResults ?? [])
  for (const a of f.assertionResults ?? [])
    if (a.status === "failed")
      failures.push({
        test: a.fullName || a.title,
        file: f.name.replace(root + "/", ""),
        message: (a.failureMessages?.[0] || "").split("\n")[0],
      })

const summary = {
  total: report.numTotalTests ?? 0,
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  failures,
}
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.failed > 0 ? 1 : 0)
