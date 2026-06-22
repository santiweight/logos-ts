// Eval harness: fork a subject codebase, build the same context the studio uses,
// have an agent address the case comment, then run hidden checks.
//
//   pnpm exec tsx evals/run.ts
//   pnpm exec tsx evals/run.ts rename-company-header
//   pnpm exec tsx evals/run.ts --tier deterministic --repeat 5
//
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, extname, join, resolve } from "node:path"
import {
  buildArchImplementationPrompt,
  buildArchPrompt,
  buildGoalLine,
  buildStoryGenerationContext,
  buildStoryGenerationSystemPrompt,
  isStoryGenerationRequest,
} from "../src/prompt.js"

interface Check {
  cwd: string
  cmd: string[]
  oracle?: string | string[]
}

interface EvalCase {
  name: string
  codebase: string
  comment: {
    target: string
    targets?: string[]
    text: string
    label?: string
    component?: string
    storyId?: string
    selector?: string
  }
  agent: "implementation" | "architecture" | "testing" | "arch-impl"
  tier?: "deterministic" | "capability"
  repeat?: number
  timeoutMs?: number
  checks: Record<string, Check>
}

interface TrialResult {
  caseName: string
  tier: "deterministic" | "capability"
  trial: number
  results: Record<string, boolean>
  passed: boolean
}

interface Options {
  selectors: string[]
  tier?: "deterministic" | "capability"
  repeat?: number
  concurrency: number
}

const logosTsRoot = resolve(dirname(import.meta.url.replace("file://", "")), "..")
const evalsRoot = resolve(logosTsRoot, "evals")
const casesRoot = resolve(evalsRoot, "cases")
const tsx = resolve(logosTsRoot, "node_modules/.bin/tsx")

function buildContext(work: string, targets: string[]): string {
  try {
    return execFileSync(tsx, [resolve(logosTsRoot, "src/context.ts"), work, "40000", ...targets], {
      cwd: logosTsRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
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

function runAgent(prompt: string, opts: { cwd: string; timeout: number; extraArgs?: string[] }): void {
  const args = ["-p", "-", "--model", "sonnet", "--dangerously-skip-permissions", ...(opts.extraArgs ?? [])]
  const result = spawnSync("claude", args, {
    cwd: opts.cwd,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    timeout: opts.timeout,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`claude exited with code ${result.status}`)
}

function computeDiff(original: string, modified: string): string {
  try {
    return execFileSync("diff", ["-ruN", "--exclude=node_modules", "--exclude=.next", "--exclude=.logos", "--exclude=.storybook", original, modified], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
  } catch (e: any) {
    const raw: string = e.stdout ?? ""
    const lines = raw.split("\n")
    return lines.length > 500 ? lines.slice(0, 500).join("\n") + "\n[diff truncated]" : raw
  }
}

function buildArchImplPrompt(c: EvalCase, work: string, context: string): string {
  const goalLine = buildGoalLine({
    label: c.comment.label ?? c.comment.target,
    text: c.comment.text,
    ...(c.comment.component ? { component: c.comment.component } : {}),
    ...(c.comment.storyId ? { storyId: c.comment.storyId } : {}),
    ...(c.comment.selector ? { selector: c.comment.selector } : {}),
  })
  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`
  return buildArchImplementationPrompt(
    context,
    sandbox,
    goalLine,
    "This eval harness has no live test-runner MCP. Run the relevant project test/typecheck commands yourself and iterate until they pass.",
  )
}

function buildImplPrompt(
  context: string,
  work: string,
  goalLine: string,
  archDiff: string,
  archSummary: string,
): string {
  const sandbox = `IMPORTANT: Your working directory is ${work}. You MUST only read and edit files under this directory using RELATIVE paths. NEVER use absolute paths, NEVER navigate to parent directories, NEVER edit files outside your working directory. All file paths in the context above are relative to your cwd.\n\n`

  return `${context}\n\n` +
    `# ARCHITECTURE CHANGE — what the architect decided\n\n` +
    `${archSummary}\n\n` +
    `## Architecture diff:\n\`\`\`diff\n${archDiff}\n\`\`\`\n\n` +
    `${sandbox}` +
    `You are an implementation agent. The codebase has been partially updated by an architecture agent — it contains \`declare\` stubs where you must write the actual function bodies, and test stubs with \`throw new Error("not implemented")\` where you must write the actual test logic.\n\n` +
    `Address these change requests:\n${goalLine}\n\n` +
    `Fill in all \`declare\` function bodies and test stubs. Wire the new helpers into the existing code as the architecture indicates. Make sure existing tests still pass.`
}

function copyOracles(caseDir: string, check: Check, checkCwd: string): void {
  const oracles = typeof check.oracle === "string" ? [check.oracle] : check.oracle ?? []
  for (const oracle of oracles) {
    copyFileSync(resolve(caseDir, oracle), join(checkCwd, basename(oracle)))
  }
}

function runCase(casePath: string, trial: number): TrialResult {
  const caseDir = dirname(resolve(casePath))
  const c: EvalCase = JSON.parse(readFileSync(resolve(casePath), "utf8"))
  const codebase = resolve(caseDir, c.codebase)
  const runDir = resolve(caseDir, "runs", c.name, `t${trial}`)
  const work = resolve(runDir, "work")
  const tier = c.tier ?? "capability"

  console.log(`[${c.name} t${trial}] forking codebase...`)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  cpSync(codebase, work, {
    recursive: true,
    filter: (s) => !/node_modules|\.workspaces|\.logos_cache|dist|__snapshots__/.test(s),
  })
  for (const rel of ["node_modules", "frontend/node_modules"]) {
    const src = join(codebase, rel)
    if (existsSync(src) && !existsSync(join(work, rel))) symlinkSync(src, join(work, rel))
  }

  const archMode = c.agent === "architecture" || c.agent === "testing" || c.agent === "arch-impl"
  const bodiesFile = resolve(runDir, "bodies.json")
  const originalSnapshot = resolve(runDir, "original")
  if (archMode) {
    cpSync(work, originalSnapshot, {
      recursive: true,
      filter: (s) => !/node_modules/.test(s),
    })
    console.log(`[${c.name} t${trial}] stripping to architecture view...`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "strip", work, bodiesFile], {
      cwd: logosTsRoot,
      encoding: "utf8",
    })
  }

  console.log(`[${c.name} t${trial}] building context...`)
  const targets = c.comment.targets?.length
    ? c.comment.targets
    : [c.comment.component ? `component:${c.comment.component}` : c.comment.target]
  const context = buildContext(work, targets)
  console.log(`[${c.name} t${trial}] context: ${context.length} chars`)

  const prompt = buildPrompt(c, work, context)
  const storyArgs = isStoryGenerationRequest(c.comment.text)
    ? ["--append-system-prompt", buildStoryGenerationSystemPrompt()]
    : []
  console.log(`[${c.name} t${trial}] running agent (${c.agent} mode)...`)
  try {
    runAgent(prompt, {
      cwd: work,
      timeout: c.timeoutMs ?? (archMode ? 600_000 : 300_000),
      extraArgs: storyArgs,
    })
  } catch (e: any) {
    console.error(`[${c.name} t${trial}] agent failed:`, e.message)
  }

  if (archMode) {
    console.log(`[${c.name} t${trial}] splicing implementations + inferring imports...`)
    execFileSync(tsx, [resolve(logosTsRoot, "src/archmode.ts"), "splice", work, bodiesFile], {
      cwd: logosTsRoot,
      encoding: "utf8",
    })
  }

  if (c.agent === "architecture" || c.agent === "testing") {
    console.log(`[${c.name} t${trial}] rebuilding implementation context...`)
    const implContext = buildContext(work, targets)
    const implPrompt = buildArchImplPrompt(c, work, implContext)
    console.log(`[${c.name} t${trial}] running implementation pass after architecture...`)
    try {
      runAgent(implPrompt, {
        cwd: work,
        timeout: c.timeoutMs ?? 600_000,
        extraArgs: isStoryGenerationRequest(c.comment.text)
          ? ["--append-system-prompt", buildStoryGenerationSystemPrompt()]
          : [],
      })
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] implementation pass failed:`, e.message)
    }
  }

  if (c.agent === "arch-impl") {
    const archDiff = computeDiff(originalSnapshot, work)
    console.log(`[${c.name} t${trial}] arch diff: ${archDiff.length} chars`)

    console.log(`[${c.name} t${trial}] rebuilding context for impl agent...`)
    const implContext = buildContext(work, targets)
    console.log(`[${c.name} t${trial}] impl context: ${implContext.length} chars`)

    const goalLine = buildGoalLine({
      label: c.comment.label ?? c.comment.target,
      text: c.comment.text,
      ...(c.comment.component ? { component: c.comment.component } : {}),
    })

    const implPrompt = buildImplPrompt(implContext, work, goalLine, archDiff, c.comment.text)
    console.log(`[${c.name} t${trial}] running impl agent...`)
    try {
      runAgent(implPrompt, { cwd: work, timeout: c.timeoutMs ?? 300_000 })
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] impl agent failed:`, e.message)
    }
  }

  console.log(`[${c.name} t${trial}] running checks...`)
  const results: Record<string, boolean> = {}
  for (const [name, check] of Object.entries(c.checks)) {
    const checkCwd = join(work, check.cwd)
    const [cmd, ...args] = check.cmd
    if (!cmd) {
      results[name] = false
      continue
    }
    try {
      copyOracles(caseDir, check, checkCwd)
      execFileSync(cmd, args, { cwd: checkCwd, encoding: "utf8" })
      results[name] = true
    } catch (e: any) {
      console.error(`[${c.name} t${trial}] check failed (${name}):`, e.message)
      results[name] = false
    }
  }

  const passed = Object.values(results).every(Boolean)
  console.log(`[${c.name} t${trial}] results:`, results)
  return { caseName: c.name, tier, trial, results, passed }
}

function parseArgs(argv: string[]): Options {
  const selectors: string[] = []
  let tier: Options["tier"]
  let repeat: number | undefined
  let concurrency = 1

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--tier") {
      const value = argv[++i]
      if (value !== "deterministic" && value !== "capability") throw new Error(`Invalid --tier: ${value}`)
      tier = value
    } else if (arg === "--repeat") {
      repeat = Number(argv[++i])
      if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer")
    } else if (arg === "--concurrency") {
      concurrency = Number(argv[++i])
      if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer")
    } else if (arg?.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`)
    } else if (arg) {
      selectors.push(arg)
    }
  }

  return {
    selectors,
    concurrency,
    ...(tier ? { tier } : {}),
    ...(repeat ? { repeat } : {}),
  }
}

function collectCasePaths(dir: string, includeSubdirs: boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory() && includeSubdirs) out.push(...collectCasePaths(path, includeSubdirs))
    else if (entry.isFile() && extname(entry.name) === ".json") out.push(path)
  }
  return out.sort()
}

function selectCases(options: Options): string[] {
  const topLevel = collectCasePaths(casesRoot, false)
  const all = collectCasePaths(casesRoot, true)
  const byName = new Map<string, string>()
  for (const path of all) {
    const c: EvalCase = JSON.parse(readFileSync(path, "utf8"))
    byName.set(c.name, path)
  }

  const selected = options.selectors.length === 0
    ? topLevel
    : options.selectors.map((selector) => {
      const direct = resolve(logosTsRoot, selector)
      if (existsSync(direct)) return direct
      const byCaseName = byName.get(selector)
      if (byCaseName) return byCaseName
      throw new Error(`Unknown eval case: ${selector}`)
    })

  return selected.filter((path) => {
    if (!options.tier) return true
    const c: EvalCase = JSON.parse(readFileSync(path, "utf8"))
    return (c.tier ?? "capability") === options.tier
  })
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item) await fn(item)
    }
  })
  await Promise.all(workers)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const casePaths = selectCases(options)
  if (casePaths.length === 0) {
    console.log("No eval cases matched.")
    return
  }

  const trials: Array<{ casePath: string; trial: number }> = []
  for (const casePath of casePaths) {
    const c: EvalCase = JSON.parse(readFileSync(casePath, "utf8"))
    const repeat = options.repeat ?? c.repeat ?? 1
    for (let trial = 1; trial <= repeat; trial += 1) trials.push({ casePath, trial })
  }

  const startedAt = new Date().toISOString()
  const results: TrialResult[] = []
  await runWithConcurrency(trials, options.concurrency, async ({ casePath, trial }) => {
    results.push(runCase(casePath, trial))
  })

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    options,
    results: results.sort((a, b) => a.caseName.localeCompare(b.caseName) || a.trial - b.trial),
  }

  const resultsDir = resolve(evalsRoot, "results")
  mkdirSync(resultsDir, { recursive: true })
  const resultsFile = resolve(resultsDir, `${startedAt.replace(/[:.]/g, "-")}.json`)
  writeFileSync(resultsFile, `${JSON.stringify(summary, null, 2)}\n`)

  console.log("\nEval summary")
  for (const caseName of Array.from(new Set(summary.results.map((r) => r.caseName))).sort()) {
    const caseResults = summary.results.filter((r) => r.caseName === caseName)
    const passed = caseResults.filter((r) => r.passed).length
    console.log(`${caseName}: ${passed}/${caseResults.length}`)
  }
  console.log(`Results written to ${resultsFile}`)

  const failedGate = summary.results.some((result) => result.tier === "deterministic" && !result.passed)
  if (failedGate) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
