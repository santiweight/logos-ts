#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const root = process.cwd()
const bin = resolve(root, "frontend/node_modules/.bin/vitest")
const out = resolve(root, ".healthcheck.json")
const filters = process.argv.slice(2)

try {
  execFileSync(bin, ["run", "--exclude", "maintenance.e2e.test.ts", "--reporter=json", `--outputFile=${out}`, ...filters], {
    cwd: resolve(root, "frontend"),
    stdio: ["ignore", "ignore", "ignore"],
  })
} catch {
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
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status === "failed") {
      failures.push({
        test: assertion.fullName || assertion.title,
        file: file.name.replace(root + "/", ""),
        message: (assertion.failureMessages?.[0] || "").split("\n")[0],
      })
    }
  }
}

const summary = {
  total: report.numTotalTests ?? 0,
  passed: report.numPassedTests ?? 0,
  failed: report.numFailedTests ?? 0,
  failures,
}
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.failed > 0 ? 1 : 0)
