// Eval harness: given a case (codebase + comment + checks), fork the codebase,
// have an agent address the comment, then run checks and report.
//
//   npx tsx evals/run.ts evals/cases/fuzzy-search.json
//
// The AGENT step is pluggable. By default it shells out to the `claude` CLI in
// headless mode with the appropriate system prompt; you can swap in any runner.
// (In the current demo the agent was driven directly via the Claude Code Agent
// tool; the checks below are what actually grade the result.)
import { execFileSync } from "node:child_process"
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, symlinkSync, copyFileSync } from "node:fs"
import { resolve, dirname, basename, join } from "node:path"

interface Check {
  cwd: string
  cmd: string[]
  oracle?: string
}
interface EvalCase {
  name: string
  codebase: string
  comment: { target: string; text: string }
  agent: "implementation" | "architecture" | "testing"
  checks: Record<string, Check>
}

const SYSTEM_PROMPTS: Record<EvalCase["agent"], string> = {
  // Sees only the architecture-level view (signatures, classes, tests — no bodies).
  architecture:
    "You operate on an ARCHITECTURE-ONLY view (signatures, classes, function/method signatures, tests, props — no implementation bodies). Given a comment on a node, produce the minimal architecture edits to satisfy it. Keep the existing API intact where possible; where it must change, be conservative about names/types. Express new behavior as tests. Never write implementation bodies.",
  testing:
    "You operate on an ARCHITECTURE-ONLY view. Given a comment, write the tests that specify the requested behavior, attached to the most specific node that owns it. Do not write implementations.",
  implementation:
    "You see the ENTIRE codebase. Given a comment, implement it. Keep exported signatures stable unless the change requires otherwise; reuse existing helpers; make it typecheck.\n\n" +
    "VERIFY with the health-check tool, which is the ONE API for running tests — do not invent your own runner or call vitest/jest directly. From the project root run:\n" +
    "    node scripts/healthcheck.mjs\n" +
    "It runs all the important tests and prints a JSON summary { total, passed, failed, failures[] }. After every change, run it and iterate until the tests relevant to your change pass. (Some unrelated tests may already be failing as stubs — don't be blocked by pre-existing failures you didn't cause, but never introduce new ones.)",
}

function runCase(casePath: string) {
  const caseDir = dirname(resolve(casePath))
  const c: EvalCase = JSON.parse(readFileSync(resolve(casePath), "utf8"))
  const codebase = resolve(caseDir, c.codebase)
  const work = resolve(caseDir, "runs", c.name)

  // 1. fork: cheap copy of the codebase (sans node_modules), symlink frontend deps
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  cpSync(codebase, work, {
    recursive: true,
    filter: (s) => !/node_modules|\.workspaces|\.logos_cache|dist|__snapshots__/.test(s),
  })
  const deps = join(codebase, "frontend/node_modules")
  if (existsSync(deps)) {
    symlinkSync(deps, join(work, "frontend/node_modules"))
    // root node_modules too, so the unified health-check runner resolves deps
    symlinkSync(deps, join(work, "node_modules"))
  }

  // 2. agent addresses the comment in the fork (pluggable; see note above)
  console.log(`[${c.name}] agent=${c.agent} system prompt:\n${SYSTEM_PROMPTS[c.agent]}\n`)
  // e.g. execFileSync("claude", ["-p", `${SYSTEM_PROMPTS[c.agent]}\n\nComment on ${c.comment.target}: ${c.comment.text}`], { cwd: work, stdio: "inherit" })

  // 3. run checks
  const results: Record<string, boolean> = {}
  for (const [name, check] of Object.entries(c.checks)) {
    if (check.oracle) copyFileSync(resolve(caseDir, check.oracle), join(work, check.cwd, basename(check.oracle)))
    try {
      execFileSync(check.cmd[0], check.cmd.slice(1), { cwd: join(work, check.cwd), encoding: "utf8" })
      results[name] = true
    } catch {
      results[name] = false
    }
  }
  console.log(`[${c.name}] results:`, results)
  return results
}

const arg = process.argv[2]
if (arg) runCase(arg)
