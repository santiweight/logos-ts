// Eval harness: given a case (codebase + comment + checks), fork the codebase,
// build architecture context, have an agent address the comment, then run
// checks and report.
//
//   npx tsx evals/run.ts evals/cases/bold-role-element.json
//
import { execFileSync } from "node:child_process"
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, symlinkSync, copyFileSync } from "node:fs"
import { resolve, dirname, basename, join } from "node:path"
import {
  buildArchPrompt,
  buildGoalLine,
  buildStoryGenerationContext,
  buildStoryGenerationSystemPrompt,
  isStoryGenerationRequest,
} from "../src/prompt.js"

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
  const goalLine = buildGoalLine({
    label: c.comment.label ?? c.comment.target,
    text: c.comment.text,
    ...(c.comment.component ? { component: c.comment.component } : {}),
    ...(c.comment.storyId ? { storyId: c.comment.storyId } : {}),
    ...(c.comment.selector ? { selector: c.comment.selector } : {}),
  })

  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

  const enrichedContext = isStoryGenerationRequest(c.comment.text)
    ? `${context}\n\n${buildStoryGenerationContext()}`
    : context

  if (c.agent === "architecture" || c.agent === "testing") {
    return buildArchPrompt(enrichedContext, sandbox, goalLine)
  }

  return `${enrichedContext}\n\n${sandbox}` +
    `You are an implementation agent. The ARCHITECTURE CONTEXT above already lists every file and symbol your change touches — do NOT use grep/find/ls to explore the codebase. Open a file only to read or edit an implementation body you must change.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Keep exported signatures stable unless a change requires otherwise; reuse existing helpers; make it typecheck.` +
    ` This project has no automated test runner configured. Verify your changes manually.`
}

function agentArgs(c: EvalCase, prompt: string): string[] {
  const args = ["-p", prompt, "--model", "sonnet", "--dangerously-skip-permissions"]
  if (isStoryGenerationRequest(c.comment.text)) {
    args.push("--append-system-prompt", buildStoryGenerationSystemPrompt())
  }
  return args
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
  for (const rel of ["node_modules", "frontend/node_modules"]) {
    const src = join(codebase, rel)
    if (existsSync(src) && !existsSync(join(work, rel))) symlinkSync(src, join(work, rel))
  }

  // 2. Architecture mode runs the production pipeline: strip → agent → splice.
  const archMode = c.agent === "architecture" || c.agent === "testing"
  const bodiesFile = resolve(caseDir, "runs", `${c.name}.bodies.json`)
  if (archMode) {
    console.log(`[${c.name}] stripping to architecture view…`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "strip", work, bodiesFile], {
      cwd: logosTsRoot, encoding: "utf8",
    })
  }

  // 3. Build architecture context (same as workspace-manager)
  console.log(`[${c.name}] building context…`)
  const targets = [c.comment.component ? `component:${c.comment.component}` : c.comment.target]
  const context = buildContext(work, targets)
  console.log(`[${c.name}] context: ${context.length} chars`)

  // 4. Run agent
  const prompt = buildPrompt(c, work, context)
  console.log(`[${c.name}] running agent (${c.agent} mode)…`)
  try {
    execFileSync("claude", agentArgs(c, prompt), {
      cwd: work, stdio: "inherit", timeout: 300_000,
    })
  } catch (e: any) {
    console.error(`[${c.name}] agent failed:`, e.message)
  }

  // 5. Splice implementations back + infer imports
  if (archMode) {
    console.log(`[${c.name}] splicing implementations + inferring imports…`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "splice", work, bodiesFile], {
      cwd: logosTsRoot, encoding: "utf8",
    })
  }

  // 4. Run checks
  console.log(`[${c.name}] running checks…`)
  const results: Record<string, boolean> = {}
  for (const [name, check] of Object.entries(c.checks)) {
    if (check.oracle) copyFileSync(resolve(caseDir, check.oracle), join(work, check.cwd, basename(check.oracle)))
    const [cmd, ...args] = check.cmd
    if (!cmd) {
      results[name] = false
      continue
    }
    try {
      execFileSync(cmd, args, { cwd: join(work, check.cwd), encoding: "utf8" })
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
