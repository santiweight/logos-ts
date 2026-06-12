// Eval harness: given a case (codebase + comment + checks), fork the codebase,
// build architecture context, have an agent address the comment, then run
// checks and report.
//
//   npx tsx evals/run.ts evals/cases/bold-role-element.json
//
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
  comment: { target: string; text: string; label?: string; component?: string; storyId?: string; selector?: string }
  agent: "implementation" | "architecture" | "testing"
  checks: Record<string, Check>
}

const logosTsRoot = resolve(dirname(import.meta.url.replace("file://", "")), "..")
const tsx = resolve(logosTsRoot, "node_modules/.bin/tsx")

function buildContext(work: string, targets: string[]): string {
  try {
    return execFileSync(tsx, [resolve(logosTsRoot, "src/context.ts"), work, "40000", ...targets], {
      cwd: logosTsRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    })
  } catch (e) {
    console.error("context build failed:", e)
    return ""
  }
}

function buildPrompt(c: EvalCase, work: string, context: string): string {
  const elementContext = [
    c.comment.component && `component: ${c.comment.component}`,
    c.comment.storyId && `story: ${c.comment.storyId}`,
    c.comment.selector && `element: ${c.comment.selector}`,
  ].filter(Boolean).join(", ")
  const labelPart = c.comment.label ?? c.comment.target
  const goalLine = `- (${labelPart}${elementContext ? ` [${elementContext}]` : ""}) ${c.comment.text}`

  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

  if (c.agent === "architecture" || c.agent === "testing") {
    return `${context}\n\n${sandbox}` +
      `You are in ARCHITECTURE MODE. The code is shown as pure SIGNATURES using \`declare\` — no bodies, no \`=\`, no values.\n\n` +
      `Change requests:\n${goalLine}\n`
  }

  return `${context}\n\n${sandbox}` +
    `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. Open a file only to read or edit an implementation body you must change.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck.` +
    ` This project has no automated test runner configured. Verify your changes manually.`
}

function runCase(casePath: string) {
  const caseDir = dirname(resolve(casePath))
  const c: EvalCase = JSON.parse(readFileSync(resolve(casePath), "utf8"))
  const codebase = resolve(caseDir, c.codebase)
  const work = resolve(caseDir, "runs", c.name)

  // 1. Fork: cheap copy of the codebase (sans node_modules), symlink deps
  console.log(`[${c.name}] forking codebase…`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  cpSync(codebase, work, {
    recursive: true,
    filter: (s) => !/node_modules|\.workspaces|\.logos_cache|dist|__snapshots__/.test(s),
  })
  const deps = join(codebase, "frontend/node_modules")
  if (existsSync(deps)) {
    symlinkSync(deps, join(work, "frontend/node_modules"))
    symlinkSync(deps, join(work, "node_modules"))
  }

  // 2. Build architecture context (same as workspace-manager)
  console.log(`[${c.name}] building context…`)
  const targets = [c.comment.component ? `component:${c.comment.component}` : c.comment.target]
  const context = buildContext(work, targets)
  console.log(`[${c.name}] context: ${context.length} chars`)

  // 3. Run agent
  const prompt = buildPrompt(c, work, context)
  console.log(`[${c.name}] running agent (${c.agent} mode)…`)
  try {
    execFileSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
      cwd: work, stdio: "inherit", timeout: 120_000,
    })
  } catch (e: any) {
    console.error(`[${c.name}] agent failed:`, e.message)
  }

  // 4. Run checks
  console.log(`[${c.name}] running checks…`)
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
